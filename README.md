# tg-gallery

Telegram bot that downloads images from gallery web pages, packages them into a
ZIP archive, and serves the archive over HTTPS so you can grab it from any
device.

You send the bot one (or several) gallery URLs; it scrapes the images using a
site-specific strategy, downloads them in parallel, and replies with a private
download link.

```
┌─────────────┐   webhook    ┌──────────────────┐
│ Telegram    │ ───────────▶ │ nginx :443       │
└─────────────┘              │   ↓ proxy_pass   │
                             │ Node :3000       │   scrape + download
                             │   tg-gallery     │ ───────────▶  Internet
                             └──────┬───────────┘                 (optional
                                    │                              SOCKS5 proxy)
                                    ▼
                            /var/lib/tg-gallery/
                            ├─ downloads/  (ZIP archives, served by nginx)
                            └─ temp/       (per-job staging area)
```

## Features

- Multi-gallery batching — paste several URLs, get a single ZIP back.
- Strategy engine — per-domain CSS selectors stored in a JSON config; new sites
  are added without touching the bot code.
- Auto-detection — if the domain isn't explicitly known, the bot tries the
  first few strategies in turn until one returns enough images.
- Optional SOCKS5 proxy — strategies marked `useProxy: true` are routed through
  `PROXY_URL` (e.g. an Xray/V2Ray inbound), so you can scrape sites that block
  datacenter IPs.
- Parallel image downloads with retry + exponential backoff.
- File browser — `/files` lists every saved archive with size, date, source
  URLs, individual delete and bulk delete.
- Cancel mid-download — every job has a "Cancel" button that aborts cleanly.
- Webhook secret — Telegram is verified via the
  `X-Telegram-Bot-Api-Secret-Token` header so unsigned requests are rejected.
- Random suffix on every archive name — generated download URLs are not
  guessable from the input.
- Atomic ZIP writes — temporary `.tmp` file, renamed on completion; nginx
  refuses to serve `.tmp` and `.json` so half-written files and metadata
  sidecars are never exposed.
- **Optional channel upload** — if you want every archive mirrored into a
  private Telegram channel (up to 2 GB, or 4 GB on Premium), the installer
  can log in a userbot via [GramJS](https://gram.js.org) and push each ZIP
  there in addition to giving you the direct link.

## Requirements

- Linux server (tested on Ubuntu 22.04+).
- Node.js 20+ (the installer installs it if missing).
- nginx (the installer installs it if missing).
- A bot token from [@BotFather](https://t.me/BotFather).
- A public HTTPS domain pointed at the server, with a TLS certificate.
  Telegram only delivers webhooks over HTTPS.
- A **Cloudflare Origin Certificate** is the recommended setup (matches the
  sister repos): save the `.pem` and `.key` somewhere readable (e.g.
  `/root/certs/`). Let's Encrypt also works — just point the installer at
  whatever `fullchain.pem` / `privkey.pem` paths you have.
- (Optional) A SOCKS5 proxy listening on `127.0.0.1` if you want to route some
  scraping traffic through it. The installer asks for it interactively.

## Installation

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ali934h/tg-gallery/main/install.sh)
```

The installer:

1. Installs Node.js 20, PM2, nginx, and `pm2-logrotate` if missing.
2. Asks for the bot token, public domain, SSL certificate paths, internal
   port, allowed user IDs, and download/temp directories.
3. Generates a random `WEBHOOK_SECRET` automatically.
4. Asks (optionally) for a SOCKS5 proxy host/port and credentials.
5. Asks (optionally) whether to enable the [channel upload](#optional-channel-upload)
   feature; if yes, prompts for `TG_API_ID`, `TG_API_HASH`, your phone, and the
   target channel ID, then runs `node setup.js` to obtain a session string.
6. Clones the repo to `/root/tg-gallery`, runs `npm install`, writes
   `/root/tg-gallery/.env` with `chmod 600`, drops an nginx vhost in
   `/etc/nginx/conf.d/tg-gallery.conf`, and starts the bot under PM2.
7. Calls `setWebhook` so Telegram knows where to send updates.

After the script finishes, hit `https://<your-domain>/health` to confirm the
bot is up.

## Configuration

The installer writes a `.env` from these knobs (all are also documented in
[`.env.example`](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `BOT_TOKEN` | *required* | Bot token from @BotFather. |
| `WEBHOOK_DOMAIN` | *required (prod)* | Public HTTPS origin (e.g. `https://bot.example.com`). |
| `WEBHOOK_PATH` | `/webhook` | Path nginx forwards to Node. |
| `WEBHOOK_SECRET` | generated | Random string Telegram echoes back in the `X-Telegram-Bot-Api-Secret-Token` header. |
| `PORT` | `3000` | Internal HTTP port the bot listens on (nginx proxies to it). |
| `NODE_ENV` | `production` | `development` enables long polling + skips webhook secret. |
| `DOWNLOADS_DIR` | `/var/lib/tg-gallery/downloads` | Where ZIP archives live. nginx serves this directly. |
| `DOWNLOAD_BASE_URL` | from `WEBHOOK_DOMAIN` | Public URL prefix for downloads. |
| `TEMP_DIR` | `/var/lib/tg-gallery/temp` | Per-job staging area. Cleaned up automatically. |
| `ALLOWED_USERS` | empty | Comma-separated Telegram user IDs. Empty = open. |
| `DOWNLOAD_CONCURRENCY` | `5` | Parallel image downloads per gallery. |
| `DOWNLOAD_TIMEOUT_MS` | `60000` | Per-image HTTP timeout. |
| `DOWNLOAD_RETRIES` | `3` | Per-image retry count. |
| `SCRAPE_TIMEOUT_MS` | `30000` | HTML fetch timeout. |
| `SCRAPE_RETRIES` | `3` | HTML fetch retries. |
| `FALLBACK_STRATEGY_LIMIT` | `5` | When a domain isn't known, try at most this many strategies. |
| `FALLBACK_MIN_IMAGES` | `5` | A fallback strategy is considered "working" if it extracts at least this many images. |
| `PROXY_URL` | empty | `socks5://[user:pass@]host:port`. Used only by strategies that opt in via `useProxy: true`. |
| `SESSION_IDLE_TTL_MS` | `86400000` | Idle session GC threshold. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug`. |
| `TELEGRAM_UPLOAD_ENABLED` | `false` | Set to `true` to also push every ZIP to a private Telegram channel. |
| `TG_API_ID` / `TG_API_HASH` | empty | Userbot credentials from <https://my.telegram.org/apps>. Required when channel upload is enabled. |
| `PHONE` | empty | Phone number used by `setup.js` to log in. Not used at runtime. |
| `TG_SESSION` | empty | Userbot session string written by `setup.js` after a successful login. |
| `UPLOAD_CHANNEL_ID` | empty | Numeric ID of the destination channel (e.g. `-1001234567890`). |
| `TELEGRAM_UPLOAD_MAX_BYTES` | `2147483648` | Max archive size to upload. Anything bigger gets the link only. Bump to `4294967296` if your account has Telegram Premium. |

After editing `.env`, run `pm2 restart tg-gallery --update-env`.

## Bot commands

- `/start` — welcome message and quick reference.
- `/help` — full usage notes.
- `/files` — manage downloaded archives (view, delete, bulk delete).
- `/cancel` — reset the current flow (does not abort an in-progress download;
  use the on-screen "Cancel Download" button for that).

The default flow is:

1. Send one or more gallery URLs (one per line).
2. The bot replies with a summary and three buttons: **Start Download**,
   **Rename**, **Cancel**.
3. After the download finishes you receive a download link plus a job summary.
4. Use `/files` later to find or delete past archives.

The archive name must start with a letter or digit and may only contain
letters, digits, `-`, `_`, and `.`. `..` and path separators are rejected, and
names that would create a hidden file (e.g. `.env`) are not accepted. A short
random suffix is appended to every accepted name to keep download URLs
unguessable.

## Optional channel upload

The bot is webhook-based, so it can only send files up to the Bot API's 50 MB
limit. To handle larger archives, the bot can attach to a userbot session
(your own Telegram account) via GramJS and forward each finished ZIP into a
private channel that your account is a member of.

The direct download link is always sent regardless. The channel upload is
additional.

1. During installation, answer `y` to *Enable channel upload?*. The installer
   will ask for your `TG_API_ID`, `TG_API_HASH` (from <https://my.telegram.org/apps>),
   phone number, and the numeric channel ID.
2. The installer runs `node setup.js`, which sends an OTP to your Telegram
   account. Enter the code (and 2FA password if you have one). The session
   string is written to `.env` with mode `600`.
3. The bot starts; the userbot connects on launch and waits for jobs.

Finding the channel ID:

- Easiest: forward any post from the channel to [@userinfobot](https://t.me/userinfobot) — it replies with the numeric ID.
- Or open the channel in Telegram Web, look at the URL `…#-100123456789…`.

If the archive is bigger than `TELEGRAM_UPLOAD_MAX_BYTES`, the bot tells you
in chat and skips the upload but still sends the direct link.

To re-login (e.g. after a Telegram session expiry):

```bash
cd /root/tg-gallery && node setup.js
pm2 restart tg-gallery
```

To disable the channel upload after the fact, edit `.env`, set
`TELEGRAM_UPLOAD_ENABLED=false`, and `pm2 restart tg-gallery --update-env`.

## Adding a site strategy

Edit [`src/config/siteStrategies.json`](src/config/siteStrategies.json) and add
an entry keyed on the site's domain (without `www.`):

```json
{
  "example.com": {
    "name": "Example",
    "useProxy": false,
    "headers": { "Referer": "https://example.com/" },
    "images": {
      "selector": "a.image-link",
      "attr": "href",
      "filterPatterns": ["thumb", "preview"]
    }
  }
}
```

- `selector` — any CSS selector that matches the elements pointing to the
  full-resolution image.
- `attr` — the attribute on those elements that holds the image URL (often
  `href` for `<a>` or `data-src` for lazy-loaded `<img>`).
- `filterPatterns` — substrings used to drop thumbnail/preview URLs.
- `useProxy` — set to `true` to route requests through `PROXY_URL`.
- `headers` — extra HTTP headers to send (e.g. a `Referer`).

After editing the file, run `pm2 restart tg-gallery`.

If you'd rather not configure a strategy, the bot will still try the first
`FALLBACK_STRATEGY_LIMIT` strategies it has and pick the first one that
returns at least `FALLBACK_MIN_IMAGES` images.

## Operations

```bash
# logs
pm2 logs tg-gallery

# restart after editing .env
pm2 restart tg-gallery --update-env

# pull the latest version
bash /root/tg-gallery/update.sh

# remove everything
bash /root/tg-gallery/uninstall.sh

# check nginx config
nginx -t

# health check
curl https://<your-domain>/health
```

PM2 is configured with `pm2-logrotate` (10 MB, 7 files retained).

## Security notes

- **Webhook secret**: Telegram sends `X-Telegram-Bot-Api-Secret-Token` on every
  webhook delivery. The Express middleware verifies it before handing the
  update to Telegraf, so even if someone learns your domain + bot path they
  cannot inject fake updates.
- **Whitelist**: leave `ALLOWED_USERS` empty only on a temporary testing bot.
  In production it should be a comma-separated list of allowed Telegram user
  IDs. Send `/start` to [@userinfobot](https://t.me/userinfobot) to look up
  yours.
- **Public download URLs**: every archive name gets a random 6-character hex
  suffix, and nginx denies `.json` / `.tmp` / dotfile lookups, so links are
  not guessable. Anyone you share a link with can still download it — treat
  the link itself as a secret.
- **/root permissions**: the installer keeps `DOWNLOADS_DIR` outside `/root`
  by default so we never have to relax `/root` to `755`. If you override the
  default into `/root/...` the installer warns you and asks before
  proceeding.
- **`.env` mode 600**: only the bot user reads it; treat the bot token like a
  password.

## Project layout

```
src/
├── config.js              env parsing + validation
├── logger.js              timestamped logger w/ LOG_LEVEL
├── fileManager.js         async fs helpers + temp cleanup
├── archiveName.js         archive-name validation + random suffix
├── files.js               list/read/save/delete .zip + sidecar metadata
├── htmlEscape.js          HTML escape for parse_mode=HTML
├── sessions.js            per-user state machine + idle GC
├── server.js              Express (health + webhook callback)
├── bot.js                 Telegraf wiring + auth middleware
├── index.js               entry point
├── userbot.js             optional GramJS uploader (channel upload)
├── handlers/
│   ├── commands.js        /start, /help, /cancel, /files, text + rename
│   ├── files.js           inline-keyboard browser
│   └── job.js             gallery extract → download → zip pipeline
├── scrapers/
│   ├── jsdomScraper.js    HTTP + JSDOM extraction
│   └── strategyEngine.js  domain → strategy lookup + fallback search
├── downloaders/
│   ├── imageDownloader.js parallel streaming downloader (proxy-aware)
│   └── zipCreator.js      atomic ZIP writer (.tmp + rename)
├── utils/
│   └── telegramRetry.js   429 / rate-limit retry helper
└── config/
    └── siteStrategies.json
```

## License

MIT
