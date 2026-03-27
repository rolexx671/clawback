import { getActiveAgents, getRoutingConfig } from './registry.js';
import { normalizeText, extractUrls } from '../shared/utils.js';
import type { AgentDefinition, RouteResult } from '../shared/types.js';
import { getLogger } from '../shared/logger.js';

const log = getLogger('router');

/**
 * 2-уровневый роутер:
 * 1. Keyword matching (быстро, бесплатно)
 * 2. LLM classification (умнее, если keywords не сработали)
 */
export class Router {

  /**
   * Главный метод — определить какой агент нужен
   */
  async route(task: string, context?: string): Promise<RouteResult | null> {
    // Уровень 1: Explicit command (если юзер прямо указал агента)
    const explicit = this.matchExplicit(task);
    if (explicit) {
      log.info({ agent: explicit.agentId, method: 'explicit' }, 'Explicit match');
      return explicit;
    }

    // Уровень 2: Keyword matching
    const keywordMatch = this.matchByKeywords(task);
    const config = getRoutingConfig();

    if (keywordMatch && keywordMatch.confidence >= config.confidenceThreshold) {
      log.info({ agent: keywordMatch.agentId, confidence: keywordMatch.confidence, method: 'keyword' }, 'Keyword match');
      return keywordMatch;
    }

    // Уровень 3: LLM fallback
    if (config.fallbackToLLM) {
      const llmMatch = await this.matchByLLM(task, context);
      if (llmMatch) {
        log.info({ agent: llmMatch.agentId, confidence: llmMatch.confidence, method: 'llm' }, 'LLM match');
        return llmMatch;
      }
    }

    // Ничего не подошло
    log.info('No agent matched');
    return null;
  }

  /**
   * Уровень 1: Прямое указание агента через команду
   * /parse, /research, /extract и т.д.
   */
  private matchExplicit(task: string): RouteResult | null {
    const commandMap: Record<string, string> = {
      '/parse': 'parser',
      '/парс': 'parser',
      '/research': 'researcher',
      '/ресёрч': 'researcher',
      '/ресерч': 'researcher',
      '/extract': 'extractor',
      '/экстракт': 'extractor',
      '/analyze': 'analyst',
      '/анализ': 'analyst',
      '/copy': 'copywriter',
      '/текст': 'copywriter',
      '/finance': 'finance',
      '/курс': 'finance',
      '/shop': 'shopper',
      '/купить': 'shopper',
      '/plan': 'planner',
      '/план': 'planner',
      '/security': 'security',
      '/безопасность': 'security',
      '/tutor': 'tutor',
      '/учёба': 'tutor',
      '/translate': 'translator',
      '/переведи': 'translator',
      '/letter': 'networker',
      '/письмо': 'networker',
      '/image': 'visual',
      '/картинка': 'visual',
    };

    const normalized = normalizeText(task);
    for (const [cmd, agentId] of Object.entries(commandMap)) {
      if (normalized.startsWith(cmd)) {
        return {
          agentId,
          confidence: 1.0,
          method: 'explicit',
          params: { query: task.slice(cmd.length).trim() },
        };
      }
    }
    return null;
  }

  /**
   * Уровень 2: Keyword matching с подсчётом score
   */
  private matchByKeywords(task: string): RouteResult | null {
    const normalized = normalizeText(task);
    const agents = getActiveAgents();
    const urls = extractUrls(task);

    const scores: { agent: AgentDefinition; score: number }[] = [];

    for (const agent of agents) {
      let score = 0;
      let matchCount = 0;

      // Проверяем triggers
      for (const trigger of agent.triggers) {
        const triggerLower = trigger.toLowerCase();
        if (normalized.includes(triggerLower)) {
          score += 0.3;
          matchCount++;
        }
      }

      // Бонус за URL если агент работает с URL
      if (urls.length > 0 && agent.inputTypes.includes('url')) {
        score += 0.2;
      }

      // Бонус за множественные совпадения
      if (matchCount > 1) {
        score += 0.1 * (matchCount - 1);
      }

      // Лимит confidence до 0.95 (для keywords)
      score = Math.min(score, 0.95);

      if (score > 0) {
        scores.push({ agent, score });
      }
    }

    if (scores.length === 0) return null;

    // Сортируем по score, потом по priority
    scores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.agent.priority - b.agent.priority;
    });

    const best = scores[0];
    return {
      agentId: best.agent.id,
      confidence: best.score,
      method: 'keyword',
      reasoning: `Matched triggers in "${best.agent.name}" agent`,
    };
  }

  /**
   * Уровень 3: LLM классификация (fallback)
   * Используем Claude для определения нужного агента
   */
  private async matchByLLM(task: string, context?: string): Promise<RouteResult | null> {
    const agents = getActiveAgents();

    const agentDescriptions = agents
      .map(a => `- ${a.id}: ${a.description}`)
      .join('\n');

    const prompt = `You are a task router. Given a user task, select the best agent from the list below.
Return ONLY a JSON object: {"agentId": "...", "confidence": 0.0-1.0, "reasoning": "..."}

Available agents:
${agentDescriptions}

User task: "${task}"
${context ? `Context: ${context}` : ''}

If no agent fits well, return {"agentId": null, "confidence": 0, "reasoning": "no match"}`;

    try {
      // Используем Anthropic SDK напрямую для роутинга (дешевле чем полный агент)
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic();

      const response = await client.messages.create({
        model: 'claude-haiku-4-20250414',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      if (!result.agentId || result.confidence < 0.3) return null;

      return {
        agentId: result.agentId,
        confidence: result.confidence,
        method: 'llm',
        reasoning: result.reasoning,
      };
    } catch (err) {
      log.error({ err }, 'LLM routing failed');
      return null;
    }
  }
}
