/**
 * Optional GramJS userbot. Used to upload built ZIP archives to a private
 * Telegram channel. Activated only when config.telegramUpload.enabled is
 * true; otherwise the module is a no-op and GramJS is not loaded.
 */

"use strict";

const fs = require("fs");
const config = require("./config");
const logger = require("./logger");

let client = null;
let connecting = null;
let resolvedChannel = null;

function getChannelInputId() {
  // GramJS accepts a numeric chat id directly. -100… channel ids fit fine.
  return Number(config.telegramUpload.channelId);
}

async function ensureConnected() {
  if (!config.telegramUpload.enabled) return null;
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    if (!config.telegramUpload.session) {
      throw new Error(
        "TG_SESSION is empty. Run `node setup.js` once to log in and write the session string to .env."
      );
    }
    const { TelegramClient } = require("telegram");
    const { StringSession } = require("telegram/sessions");

    const c = new TelegramClient(
      new StringSession(config.telegramUpload.session),
      config.telegramUpload.apiId,
      config.telegramUpload.apiHash,
      { connectionRetries: 5, retryDelay: 1000 }
    );
    await c.connect();
    client = c;
    logger.info("Userbot connected (channel upload enabled).");
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

async function resolveChannel() {
  if (resolvedChannel) return resolvedChannel;
  const c = await ensureConnected();
  if (!c) return null;
  try {
    resolvedChannel = await c.getEntity(getChannelInputId());
    return resolvedChannel;
  } catch (err) {
    throw new Error(
      `Cannot resolve channel ${config.telegramUpload.channelId}: ${err.message}. ` +
        `Make sure the userbot account is a member of that channel and the ID is correct.`
    );
  }
}

/**
 * Upload a file to the configured channel.
 * @param {string} filePath  Absolute path to the ZIP on disk.
 * @param {string} caption   Caption (may include HTML when parseMode is set).
 * @param {object} [opts]
 * @param {(uploaded: bigint, total: bigint) => void} [opts.onProgress]
 * @param {string} [opts.parseMode]  e.g. "html"
 */
async function uploadFile(filePath, caption, opts = {}) {
  if (!config.telegramUpload.enabled) {
    throw new Error("Telegram upload is disabled");
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size > config.telegramUpload.maxBytes) {
    const err = new Error(
      `File size ${stat.size} exceeds upload limit ${config.telegramUpload.maxBytes}`
    );
    err.code = "FILE_TOO_LARGE";
    err.size = stat.size;
    err.limit = config.telegramUpload.maxBytes;
    throw err;
  }

  const c = await ensureConnected();
  const channel = await resolveChannel();
  await c.sendFile(channel, {
    file: filePath,
    caption,
    parseMode: opts.parseMode || "html",
    forceDocument: true,
    progressCallback: opts.onProgress,
  });
}

async function disconnect() {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (err) {
    logger.warn("Userbot disconnect error:", err.message);
  }
  client = null;
  resolvedChannel = null;
}

function isEnabled() {
  return !!config.telegramUpload.enabled;
}

module.exports = { ensureConnected, uploadFile, disconnect, isEnabled };
