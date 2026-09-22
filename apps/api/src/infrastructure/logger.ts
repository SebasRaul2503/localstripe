import pino, { type Logger } from 'pino';
import type { Config } from '../config/config.js';

/** Paths that must never reach the logs, even if a handler logs a raw request body. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'body.card.number',
  'body.card.cvc',
  'card.number',
  'card.cvc',
  'secret',
  '*.secret',
];

export function createLogger(config: Pick<Config, 'log'>): Logger {
  return pino({
    level: config.log.level,
    base: { service: 'localstripe-api' },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(config.log.pretty && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss.l' } },
    }),
  });
}
