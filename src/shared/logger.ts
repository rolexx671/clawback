import pino from 'pino';

const createLogger = pino as unknown as (opts: object) => pino.Logger;

export function getLogger(name: string): pino.Logger {
  return createLogger({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
}
