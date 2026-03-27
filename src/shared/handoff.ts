import type { Handoff, AgentTask, AgentResult, ProgressEvent } from './types.js';
import { generateTaskId, now } from './utils.js';
import { EventEmitter } from 'node:events';

/**
 * Менеджер передачи задач между агентами (structured handoff)
 */
export class HandoffManager extends EventEmitter {
  private activeTasks = new Map<string, AgentTask>();
  private results = new Map<string, AgentResult>();

  /** Создать задачу для агента */
  createTask(agentId: string, prompt: string, options?: {
    context?: string;
    files?: string[];
    urls?: string[];
    chatId?: string;
    threadId?: string;
  }): AgentTask {
    const task: AgentTask = {
      id: generateTaskId(),
      agentId,
      prompt,
      context: options?.context,
      files: options?.files,
      urls: options?.urls,
      chatId: options?.chatId,
      threadId: options?.threadId,
      createdAt: now(),
    };

    this.activeTasks.set(task.id, task);
    this.emitProgress(task.id, agentId, 'started', `Задача создана для ${agentId}`);
    return task;
  }

  /** Записать результат выполнения */
  completeTask(taskId: string, result: Omit<AgentResult, 'taskId'>): void {
    const fullResult: AgentResult = { taskId, ...result };
    this.results.set(taskId, fullResult);
    this.activeTasks.delete(taskId);
    this.emitProgress(taskId, result.agentId, 'completed',
      result.success ? 'Задача выполнена' : `Ошибка: ${result.error}`);
  }

  /** Создать handoff — передача задачи от одного агента другому */
  createHandoff(from: string, to: string, summary: string, context: Record<string, unknown>): Handoff {
    return {
      from,
      to,
      taskId: generateTaskId(),
      priority: 'normal',
      summary,
      context,
      doneWhen: [],
    };
  }

  /** Получить активные задачи */
  getActiveTasks(): AgentTask[] {
    return Array.from(this.activeTasks.values());
  }

  /** Получить результат задачи */
  getResult(taskId: string): AgentResult | undefined {
    return this.results.get(taskId);
  }

  /** Emit progress event */
  private emitProgress(taskId: string, agentId: string, type: ProgressEvent['type'], message: string): void {
    const event: ProgressEvent = {
      taskId, agentId, type, message,
      timestamp: now(),
    };
    this.emit('progress', event);
  }
}
