// ============================================
// Clawback — типы данных
// ============================================

/** Описание агента из реестра скиллов */
export interface AgentDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  triggers: string[];
  inputTypes: ('text' | 'url' | 'file' | 'json')[];
  outputTypes: ('text' | 'json' | 'table' | 'chart' | 'file')[];
  tools: string[];
  priority: number;
  status: 'active' | 'planned' | 'disabled';
}

/** Конфигурация роутинга */
export interface RoutingConfig {
  defaultAgent: string | null;
  fallbackToLLM: boolean;
  confidenceThreshold: number;
  maxConcurrentAgents: number;
  timeoutMs: number;
}

/** Реестр скиллов */
export interface SkillsRegistry {
  agents: AgentDefinition[];
  routing: RoutingConfig;
}

/** Результат роутинга — какой агент выбран */
export interface RouteResult {
  agentId: string;
  confidence: number;
  method: 'keyword' | 'llm' | 'explicit';
  reasoning?: string;
  params?: Record<string, unknown>;
}

/** Задача для агента */
export interface AgentTask {
  id: string;
  agentId: string;
  prompt: string;
  context?: string;
  files?: string[];
  urls?: string[];
  chatId?: string;
  threadId?: string;
  createdAt: number;
}

/** Результат работы агента */
export interface AgentResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  files?: string[];
  error?: string;
  durationMs: number;
  tokenUsage?: {
    input: number;
    output: number;
    cost: number;
  };
}

/** Structured handoff между агентами */
export interface Handoff {
  from: string;
  to: string;
  taskId: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  summary: string;
  context: Record<string, unknown>;
  deadline?: string;
  doneWhen: string[];
}

/** Статус агента */
export interface AgentStatus {
  id: string;
  busy: boolean;
  currentTask?: string;
  lastUsed?: number;
  totalTasks: number;
  avgDurationMs: number;
}

/** Событие прогресса */
export interface ProgressEvent {
  taskId: string;
  agentId: string;
  type: 'started' | 'progress' | 'tool_use' | 'completed' | 'error';
  message: string;
  timestamp: number;
}
