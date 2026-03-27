/**
 * HTTP API для интеграции с внешними ботами
 *
 * POST /route   — определить агента для задачи
 * POST /execute — выполнить задачу
 * GET  /agents  — список агентов
 * GET  /status  — статус системы
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Orchestrator } from '../orchestrator.js';
import { getAllAgents, getActiveAgents } from '../router/registry.js';
import { getLogger } from '../shared/logger.js';

const log = getLogger('api');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function startApiServer(port = 3848) {
  const orchestrator = new Orchestrator();

  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    try {
      // GET /agents — список агентов
      if (method === 'GET' && url === '/agents') {
        sendJson(res, 200, {
          agents: getAllAgents(),
          activeCount: getActiveAgents().length,
        });
        return;
      }

      // GET /status — статус системы
      if (method === 'GET' && url === '/status') {
        sendJson(res, 200, {
          status: 'running',
          activeAgents: orchestrator.activeAgentCount,
          timestamp: Date.now(),
        });
        return;
      }

      // POST /route — определить агента
      if (method === 'POST' && url === '/route') {
        const body = JSON.parse(await readBody(req));
        const result = await orchestrator.identifyAgent(body.task);
        sendJson(res, 200, { route: result });
        return;
      }

      // POST /execute — выполнить задачу
      if (method === 'POST' && url === '/execute') {
        const body = JSON.parse(await readBody(req));
        const result = await orchestrator.execute(body.task, {
          context: body.context,
          files: body.files,
          forceAgent: body.agent,
          chatId: body.chatId,
          threadId: body.threadId,
        });
        sendJson(res, 200, { result });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error({ err, url, method }, 'API error');
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    }
  });

  server.listen(port, () => {
    log.info({ port }, 'Clawback API server started');
  });

  return server;
}
