#!/usr/bin/env node
/**
 * Clawback — Sub-agent orchestrator for ClaudeClaw
 *
 * Usage:
 *   clawback "спарси цены с ozon.ru/category/laptops"
 *   clawback --agent parser "https://example.com"
 *   clawback --identify "найди всё про AI агентов"
 *   clawback --list
 */

import { Orchestrator } from './orchestrator.js';
import { getAllAgents, getActiveAgents } from './router/registry.js';
import { getLogger } from './shared/logger.js';

const log = getLogger('clawback');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // --list: показать всех агентов
  if (args.includes('--list')) {
    const all = getAllAgents();
    const active = getActiveAgents();
    console.log(`\n🤖 Clawback Agents (${active.length} active / ${all.length} total)\n`);
    for (const agent of all) {
      const status = agent.status === 'active' ? '✅' : agent.status === 'planned' ? '📋' : '⛔';
      console.log(`  ${status} ${agent.emoji} ${agent.name} (${agent.id}) — ${agent.description}`);
    }
    console.log('');
    return;
  }

  const orchestrator = new Orchestrator({
    onProgress: (event) => {
      if (event.type !== 'started') {
        log.info({ agent: event.agentId, type: event.type }, event.message);
      }
    },
  });

  // --identify: только определить агента, не выполнять
  if (args.includes('--identify')) {
    const prompt = args.filter(a => a !== '--identify').join(' ');
    const result = await orchestrator.identifyAgent(prompt);
    if (result) {
      const agent = getAllAgents().find(a => a.id === result.agentId);
      console.log(`\n🎯 Agent: ${agent?.emoji} ${agent?.name} (${result.agentId})`);
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`🔧 Method: ${result.method}`);
      if (result.reasoning) console.log(`💭 Reasoning: ${result.reasoning}`);
    } else {
      console.log('❌ Не удалось определить подходящего агента');
    }
    return;
  }

  // --agent <id>: принудительно указать агента
  let forceAgent: string | undefined;
  const agentIdx = args.indexOf('--agent');
  if (agentIdx !== -1 && args[agentIdx + 1]) {
    forceAgent = args[agentIdx + 1];
    args.splice(agentIdx, 2);
  }

  // Основной режим — выполнить задачу
  const prompt = args.join(' ');
  if (!prompt) {
    console.error('❌ Укажи задачу');
    process.exit(1);
  }

  console.log(`\n⚡ Clawback executing...`);
  const result = await orchestrator.execute(prompt, { forceAgent });

  if (result.success) {
    console.log(`\n✅ ${result.agentId} completed in ${result.durationMs}ms\n`);
    console.log(result.output);
  } else {
    console.error(`\n❌ Error: ${result.error}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
🤖 Clawback — Sub-agent orchestrator

Usage:
  clawback "task description"           Auto-route to best agent
  clawback --agent parser "url"         Force specific agent
  clawback --identify "task"            Identify agent without executing
  clawback --list                       List all agents

Examples:
  clawback "спарси цены с ozon.ru"
  clawback --agent researcher "AI agents 2026"
  clawback --identify "что в этом PDF?"
  `);
}

main().catch((err) => {
  log.error({ err }, 'Fatal error');
  process.exit(1);
});
