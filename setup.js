/**
 * One-time helper: log in to Telegram and write the userbot session string
 * to .env. Only needed when TELEGRAM_UPLOAD_ENABLED=true.
 *
 * Reads TG_API_ID, TG_API_HASH, PHONE from .env, prompts for OTP and 2FA,
 * and writes TG_SESSION back to .env (preserving other keys).
 *
 *   node setup.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dotenv = require("dotenv");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const ENV_PATH = path.resolve(__dirname, ".env");

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(
      `Missing ${ENV_PATH}. Copy .env.example and fill in TG_API_ID/TG_API_HASH first.`
    );
    process.exit(1);
  }
  return dotenv.parse(fs.readFileSync(ENV_PATH));
}

function writeEnv(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v ?? ""}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const env = loadEnv();
  const apiId = Number(env.TG_API_ID);
  const apiHash = env.TG_API_HASH;
  const phone = env.PHONE;
  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    console.error("TG_API_ID and TG_API_HASH must be set in .env first.");
    process.exit(1);
  }

  console.log("\n=== Telegram userbot login ===\n");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => phone || ask("Phone number (e.g. +989123456789): "),
    password:    () => ask("2FA password (leave blank if none): "),
    phoneCode:   () => ask("OTP code from Telegram: "),
    onError:     (err) => console.error(err.message || err),
  });

  const session = client.session.save();
  await client.disconnect();

  env.TG_SESSION = session;
  writeEnv(env);

  console.log("\nSession saved to .env (chmod 600).");
  console.log("You can now start the bot with PM2.");
}

main().catch((err) => {
  console.error("Setup failed:", err && err.message ? err.message : err);
  process.exit(1);
});
