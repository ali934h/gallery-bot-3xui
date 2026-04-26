/**
 * Application entry point.
 *  - Production: Telegraf webhook callback served from Express; SSL is
 *    terminated by nginx upstream.
 *  - Development: long polling via `bot.launch()`; Express serves only /health.
 */

const config = require("./config");
const logger = require("./logger");
const fileManager = require("./fileManager");
const sessions = require("./sessions");
const botModule = require("./bot");
const server = require("./server");
const userbot = require("./userbot");

async function main() {
  await fileManager.ensureDir(config.downloadsDir);
  await fileManager.ensureDir(config.tempDir);

  if (userbot.isEnabled()) {
    try {
      await userbot.ensureConnected();
    } catch (err) {
      logger.error("Userbot failed to connect; channel upload disabled.", {
        error: err.message,
      });
    }
  }

  const bot = botModule.build();
  const app = server.build(bot);

  if (config.isProduction) {
    await botModule.startWebhook(bot);
  } else {
    await botModule.startPolling(bot);
  }

  await server.listen(app);

  setInterval(
    () => fileManager.cleanupOldTempDirs(config.tempDir, config.tempMaxAgeMs),
    config.tempCleanupIntervalMs
  ).unref?.();

  logger.info(
    `tg-gallery is running (env=${config.nodeEnv}, downloadsDir=${config.downloadsDir})`
  );
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  sessions.stopCleanup();
  try {
    await userbot.disconnect();
  } catch (_e) {
    // already logged
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
});

main().catch((err) => {
  logger.error("Failed to start tg-gallery", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
