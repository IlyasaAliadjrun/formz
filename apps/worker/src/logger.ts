type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function createLogger(scope: string) {
  return {
    info: (message: string) => emit('info', scope, message),
    warn: (message: string) => emit('warn', scope, message),
    error: (message: string) => emit('error', scope, message),
  };
}

export type Logger = ReturnType<typeof createLogger>;
