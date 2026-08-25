/** Minimal levelled logger. Keeps engine decisions greppable in the console. */
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, scope: string, message: string, meta?: unknown) {
  const stamp = new Date().toISOString()
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  meta === undefined ? fn(line) : fn(line, meta)
}

export function createLogger(scope: string) {
  return {
    info: (message: string, meta?: unknown) => emit('info', scope, message, meta),
    warn: (message: string, meta?: unknown) => emit('warn', scope, message, meta),
    error: (message: string, meta?: unknown) => emit('error', scope, message, meta),
  }
}
