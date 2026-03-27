import { Router } from './router/router.js';
import { getAgent, getRoutingConfig } from './router/registry.js';
import { HandoffManager } from './shared/handoff.js';
import { generateTaskId, now, formatDuration } from './shared/utils.js';
import type { AgentResult, RouteResult, ProgressEvent } from './shared/types.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger } from './shared/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = getLogger('orchestrator');

export interface OrchestratorOptions {
  /** Callback для отправки прогресса (например в Telegram) */
  onProgress?: (event: ProgressEvent) => void;
  /** Путь к claude executable */
  claudePath?: string;
  /** Рабочая директория для агентов */
  workDir?: string;
}

/**
 * Оркестратор — мозг системы
 *
 * 1. Принимает задачу от юзера
 * 2. Роутит к нужному агенту (keyword → LLM)
 * 3. Запускает агента (Claude Code субпроцесс)
 * 4. Собирает результат
 * 5. Если задача сложная — декомпозирует на подзадачи
 */
export class Orchestrator {
  private router: Router;
  private handoff: HandoffManager;
  private options: OrchestratorOptions;
  private runningAgents = 0;

  constructor(options: OrchestratorOptions = {}) {
    this.router = new Router();
    this.handoff = new HandoffManager();
    this.options = {
      claudePath: options.claudePath || '/root/.nvm/versions/node/v20.20.1/bin/claude',
      workDir: options.workDir || '/root/clawback',
      ...options,
    };

    // Подписка на прогресс
    if (options.onProgress) {
      this.handoff.on('progress', options.onProgress);
    }
  }

  /**
   * Главный метод — выполнить задачу
   */
  async execute(prompt: string, options?: {
    context?: string;
    files?: string[];
    chatId?: string;
    threadId?: string;
    forceAgent?: string;
  }): Promise<AgentResult> {
    const startTime = now();
    const taskId = generateTaskId();

    try {
      // 1. Определяем агента
      let routeResult: RouteResult | null;

      if (options?.forceAgent) {
        routeResult = {
          agentId: options.forceAgent,
          confidence: 1.0,
          method: 'explicit',
        };
      } else {
        routeResult = await this.router.route(prompt, options?.context);
      }

      if (!routeResult) {
        return {
          taskId,
          agentId: 'none',
          success: false,
          output: '',
          error: 'Не удалось определить подходящего агента для этой задачи',
          durationMs: now() - startTime,
        };
      }

      const agentDef = getAgent(routeResult.agentId);
      if (!agentDef) {
        return {
          taskId,
          agentId: routeResult.agentId,
          success: false,
          output: '',
          error: `Агент "${routeResult.agentId}" не найден в реестре`,
          durationMs: now() - startTime,
        };
      }

      if (agentDef.status !== 'active') {
        return {
          taskId,
          agentId: routeResult.agentId,
          success: false,
          output: '',
          error: `Агент "${agentDef.name}" ещё не реализован (статус: ${agentDef.status})`,
          durationMs: now() - startTime,
        };
      }

      // 2. Проверяем лимит параллельных агентов
      const config = getRoutingConfig();
      if (this.runningAgents >= config.maxConcurrentAgents) {
        log.warn({ running: this.runningAgents, max: config.maxConcurrentAgents }, 'Agent limit reached, queuing');
        // Ждём освобождения слота
        await this.waitForSlot();
      }

      // 3. Запускаем агента
      log.info({ taskId, agent: agentDef.id, confidence: routeResult.confidence }, 'Executing agent');

      this.runningAgents++;
      try {
        const result = await this.runAgent(taskId, agentDef.id, prompt, options);
        return result;
      } finally {
        this.runningAgents--;
      }

    } catch (err) {
      log.error({ err, taskId }, 'Orchestrator error');
      return {
        taskId,
        agentId: 'error',
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: now() - startTime,
      };
    }
  }

  /**
   * Запуск Claude Code агента с нужным системным промптом
   */
  private async runAgent(
    taskId: string,
    agentId: string,
    prompt: string,
    options?: { context?: string; files?: string[]; chatId?: string }
  ): Promise<AgentResult> {
    const startTime = now();
    const agentDef = getAgent(agentId)!;

    // Загружаем SOUL.md агента
    const soulPath = join(__dirname, 'agents', agentId, 'SOUL.md');
    let soulPrompt = '';
    try {
      soulPrompt = readFileSync(soulPath, 'utf-8');
    } catch {
      log.warn({ agentId }, 'No SOUL.md found, using default');
      soulPrompt = `You are a specialized ${agentDef.name} agent. ${agentDef.description}`;
    }

    // Формируем полный промпт
    const fullPrompt = [
      `[Agent: ${agentDef.emoji} ${agentDef.name}]`,
      soulPrompt,
      '',
      '---',
      '',
      `Task: ${prompt}`,
      options?.context ? `\nContext: ${options.context}` : '',
      options?.files?.length ? `\nFiles: ${options.files.join(', ')}` : '',
    ].join('\n');

    try {
      // Используем Claude Agent SDK
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      let output = '';
      let tokenUsage = { input: 0, output: 0, cost: 0 };

      const agentOptions: Record<string, unknown> = {
        cwd: this.options.workDir,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'acceptEdits',
        allowedTools: agentDef.tools,
        systemPrompt: soulPrompt,
        maxTurns: 30,
      };

      for await (const event of query({ prompt: fullPrompt, options: agentOptions as any })) {
        if (event.type === 'assistant' && event.message) {
          // Собираем текстовый ответ
          for (const block of (event.message as any).content || []) {
            if (block.type === 'text') {
              output += block.text;
            }
          }
        }

        if (event.type === 'result') {
          const r = event as any;
          tokenUsage = {
            input: r.input_tokens || 0,
            output: r.output_tokens || 0,
            cost: r.total_cost || 0,
          };
        }
      }

      return {
        taskId,
        agentId,
        success: true,
        output: output.trim(),
        durationMs: now() - startTime,
        tokenUsage,
      };

    } catch (err) {
      log.error({ err, agentId, taskId }, 'Agent execution failed');
      return {
        taskId,
        agentId,
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: now() - startTime,
      };
    }
  }

  /**
   * Определить агента без выполнения (для preview)
   */
  async identifyAgent(prompt: string): Promise<RouteResult | null> {
    return this.router.route(prompt);
  }

  /**
   * Ожидание свободного слота
   */
  private waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const config = getRoutingConfig();
        if (this.runningAgents < config.maxConcurrentAgents) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      };
      setTimeout(check, 500);
    });
  }

  /** Количество запущенных агентов */
  get activeAgentCount(): number {
    return this.runningAgents;
  }
}
