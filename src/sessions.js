/**
 * Per-user session store.
 *
 * Sessions are kept in memory (a single bot instance is enough for tg-gallery).
 * Idle sessions older than `sessionIdleTtlMs` are evicted by a periodic timer
 * so the Map can't grow indefinitely.
 */

const config = require("./config");
const logger = require("./logger");

const STATE = Object.freeze({
  IDLE: "idle",
  PROCESSING: "processing",
  WAITING_NAME: "waiting_name",
});

const sessions = new Map();
let cleanupTimer = null;

function newSession() {
  return {
    state: STATE.IDLE,
    pendingJob: null,
    abortController: null,
    lastActivity: Date.now(),
  };
}

function get(userId) {
  let s = sessions.get(userId);
  if (!s) {
    s = newSession();
    sessions.set(userId, s);
  }
  s.lastActivity = Date.now();
  return s;
}

function reset(userId) {
  const s = get(userId);
  s.state = STATE.IDLE;
  s.pendingJob = null;
  s.abortController = null;
  s.lastActivity = Date.now();
  return s;
}

function size() {
  return sessions.size;
}

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let evicted = 0;
    for (const [userId, s] of sessions) {
      if (
        s.state === STATE.IDLE &&
        now - s.lastActivity > config.sessionIdleTtlMs
      ) {
        sessions.delete(userId);
        evicted++;
      }
    }
    if (evicted > 0) logger.info(`Session cleanup evicted ${evicted} idle session(s)`);
  }, config.sessionCleanupIntervalMs);
  cleanupTimer.unref?.();
}

function stopCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

module.exports = { STATE, get, reset, size, startCleanup, stopCleanup };
