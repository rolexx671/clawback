import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentDefinition, SkillsRegistry, RoutingConfig } from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', '..', 'skills-registry.json');

let _registry: SkillsRegistry | null = null;

/** Загрузить реестр скиллов */
export function loadRegistry(): SkillsRegistry {
  if (_registry) return _registry;
  const raw = readFileSync(REGISTRY_PATH, 'utf-8');
  _registry = JSON.parse(raw) as SkillsRegistry;
  return _registry;
}

/** Перезагрузить реестр (hot reload) */
export function reloadRegistry(): SkillsRegistry {
  _registry = null;
  return loadRegistry();
}

/** Получить все активные агенты */
export function getActiveAgents(): AgentDefinition[] {
  const reg = loadRegistry();
  return reg.agents.filter(a => a.status === 'active');
}

/** Получить агента по ID */
export function getAgent(id: string): AgentDefinition | undefined {
  const reg = loadRegistry();
  return reg.agents.find(a => a.id === id);
}

/** Получить все агенты (включая planned) */
export function getAllAgents(): AgentDefinition[] {
  return loadRegistry().agents;
}

/** Получить конфигурацию роутинга */
export function getRoutingConfig(): RoutingConfig {
  return loadRegistry().routing;
}

/** Проверить, активен ли агент */
export function isAgentActive(id: string): boolean {
  const agent = getAgent(id);
  return agent?.status === 'active';
}

/** Список ID активных агентов */
export function getActiveAgentIds(): string[] {
  return getActiveAgents().map(a => a.id);
}
