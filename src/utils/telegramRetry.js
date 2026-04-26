/**
 * Retry helper for Telegram Bot API calls that may hit a 429.
 */

const logger = require("../logger");

async function retryWithBackoff(fn, maxRetries = 5, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err && err.message) || "";
      const isRateLimit =
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("retry after");
      if (!isRateLimit || attempt === maxRetries) throw err;
      let delay = baseDelay * Math.pow(2, attempt);
      const m = msg.match(/retry after (\d+)/);
      if (m) delay = Math.max(delay, parseInt(m[1], 10) * 1000);
      logger.warn(
        `Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { retryWithBackoff };
