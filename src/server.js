/**
 * HTTP server: exposes a /health endpoint and (in production) the webhook
 * callback. Static download serving is handled by nginx, NOT by Express.
 */

const express = require("express");
const http = require("http");
const config = require("./config");
const logger = require("./logger");

function build(bot) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
    });
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      service: "tg-gallery",
      status: "running",
    });
  });

  if (config.isProduction) {
    // Telegraf validates the X-Telegram-Bot-Api-Secret-Token header against
    // the secretToken we pass here. Requests without a matching token are
    // rejected with 403.
    app.use(
      bot.webhookCallback(config.webhookPath, {
        secretToken: config.webhookSecret,
      })
    );
  }

  return app;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      logger.info(`HTTP server listening on 127.0.0.1:${config.port}`);
      resolve(server);
    });
  });
}

module.exports = { build, listen };
