/**
 * Logger Utility
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function format(level, message, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  return meta && Object.keys(meta).length ? `${base} ${JSON.stringify(meta)}` : base;
}

const Logger = {
  error: (msg, meta) => { if (currentLevel >= 0) console.error(format('error', msg, meta)); },
  warn:  (msg, meta) => { if (currentLevel >= 1) console.warn(format('warn',  msg, meta)); },
  info:  (msg, meta) => { if (currentLevel >= 2) console.log(format('info',  msg, meta)); },
  debug: (msg, meta) => { if (currentLevel >= 3) console.log(format('debug', msg, meta)); }
};

module.exports = Logger;
