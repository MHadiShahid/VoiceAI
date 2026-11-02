// Minimal structured (JSON-lines) logger. Vercel captures stdout/stderr, so
// one JSON object per line is searchable in the Vercel log viewer without
// pulling in a logging dependency.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({ level = 'info', base = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { level: lvl, time: new Date().toISOString(), msg, ...base, ...serialize(fields) };
    const line = JSON.stringify(entry);
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (extra) => createLogger({ level, base: { ...base, ...extra } }),
  };
}

function serialize(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, code: value.code, stack: value.stack } : value;
  }
  return out;
}
