/**
 * Telegraf bot wiring: middleware, handler registration, lifecycle.
 */

const { Telegraf } = require("telegraf");
const config = require("./config");
const logger = require("./logger");
const sessions = require("./sessions");
const strategyEngine = require("./scrapers/strategyEngine");
const commands = require("./handlers/commands");
const filesHandler = require("./handlers/files");
const job = require("./handlers/job");

function isAllowed(userId) {
  if (config.allowedUsers.size === 0) return true;
  return config.allowedUsers.has(userId);
}

function build() {
  const bot = new Telegraf(config.botToken, {
    telegram: { apiRoot: "https://api.telegram.org", webhookReply: true },
  });
  // Long timeout for large media operations
  bot.telegram.options = { ...bot.telegram.options, timeout: 300000 };

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!isAllowed(userId)) {
      logger.warn(`Unauthorized access attempt by user: ${userId}`);
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery("⛔ Access denied.").catch(() => {});
      } else {
        await ctx.reply("⛔ You are not authorized to use this bot.").catch(() => {});
      }
      return;
    }
    return next();
  });

  commands.register(bot);
  filesHandler.register(bot);
  job.register(bot);

  bot.catch((err, ctx) => {
    logger.error("Unhandled bot error", {
      error: err.message,
      user: ctx.from?.id,
    });
    ctx
      .reply("An unexpected error occurred. Please try again or send /start to reset.")
      .catch(() => {});
    sessions.reset(ctx.from?.id);
  });

  return bot;
}

async function setBotCommands(bot) {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "help", description: "How to use this bot" },
      { command: "files", description: "View and manage downloaded files" },
      { command: "cancel", description: "Cancel current operation" },
    ]);
    logger.info("Bot commands menu set successfully");
  } catch (err) {
    logger.warn("Failed to set bot commands", { error: err.message });
  }
}

async function initialize(bot) {
  await strategyEngine.load();
  await setBotCommands(bot);
  sessions.startCleanup();
  if (config.allowedUsers.size > 0) {
    logger.info(`Whitelist active: ${[...config.allowedUsers].join(", ")}`);
  } else {
    logger.warn("No ALLOWED_USERS set — bot is open to ALL Telegram users");
  }
}

async function startWebhook(bot) {
  await initialize(bot);
  const url = `${config.webhookDomain}${config.webhookPath}`;
  await bot.telegram.setWebhook(url, {
    secret_token: config.webhookSecret,
  });
  logger.info(`Webhook set: ${url}`);
  return bot;
}

async function startPolling(bot) {
  await initialize(bot);
  await bot.launch();
  logger.info("Bot started with polling");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

module.exports = { build, startWebhook, startPolling };
