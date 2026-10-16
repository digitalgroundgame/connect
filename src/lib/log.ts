/**
 * One JSON line per event on stdout, which Coolify keeps. Never put message
 * text or codes in a log: only who, what and how it went.
 */
type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', fields: Fields, msg: string): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export interface Logger {
  info(fields: Fields, msg: string): void
  warn(fields: Fields, msg: string): void
  error(fields: Fields, msg: string): void
}

export const log: Logger = {
  info: (fields, msg) => write('info', fields, msg),
  warn: (fields, msg) => write('warn', fields, msg),
  error: (fields, msg) => write('error', fields, msg),
}
