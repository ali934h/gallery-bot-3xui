# Gallery Downloader Bot — 3x-ui Edition

Telegram bot for downloading gallery images, integrated with **3x-ui** panel for proxy support.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                       Server                        │
│                                                     │
│  3x-ui panel  (your-vpn-domain.com)                 │
│    └── Xray                                         │
│          ├── Inbound: VLESS/Trojan (any port)       │  ← for VPN users
│          └── Inbound: mixed 127.0.0.1:1080          │  ← for this bot
│                                                     │
│  Gallery Bot  (your-bot-domain.com:443)             │
│    └── PROXY_URL=socks5://user:pass@127.0.0.1:1080  │
└─────────────────────────────────────────────────────┘
```

> ⚠️ **The bot domain MUST be different from the 3x-ui domain.**  
> Both services listen on port 443 — they need separate domains/IPs.

---

## Prerequisites

### Step 1 — Install 3x-ui

Install [3x-ui](https://github.com/MHSanaei/3x-ui) on your server with your preferred settings.

### Step 2 — Create a `mixed` inbound in 3x-ui panel

In the 3x-ui web panel, go to **Inbounds → Add Inbound**:

| Field       | Value           |
|-------------|-----------------|
| Protocol    | `mixed`         |
| Listen IP   | `127.0.0.1`     |
| Port        | `1080`          |
| Password    | Enabled ✅      |
| Username    | (any value)     |
| Password    | (any value)     |

> This inbound is **local only** (127.0.0.1) — not exposed to the internet.  
> Note your username and password — you will need them during installation.

> 💡 **Why `mixed`?** The 3x-ui panel may not show `socks` as a protocol option.  
> The `mixed` protocol supports both SOCKS5 and HTTP proxy on the same port.

### Step 3 — Prepare bot domain & SSL

- Point a **separate domain** to your server IP (e.g. `bot.example.com`)
- Get an SSL certificate for it (e.g. via Certbot)
- Make sure port 443 is available for this domain

---

## Installation

```bash
bash <(curl -Ls https://raw.githubusercontent.com/ali934h/gallery-bot-3xui/main/install.sh)
```

The installer will ask for:
- Telegram Bot Token
- Bot domain (separate from 3x-ui domain!)
- SSL certificate paths
- Proxy username & password (from the mixed inbound you created)
- Allowed user IDs (optional)
- Download concurrency
- Downloads directory

---

## How Proxy Works

Each site strategy in `src/config/siteStrategies.json` has a `useProxy` flag:

```json
"pornpics.com": {
  "useProxy": true,   ← goes through Xray (3x-ui)
  ...
},
"elitebabes.com": {
  "useProxy": false,  ← direct connection
  ...
}
```

When `useProxy: true`, the bot routes traffic through `socks5://user:pass@127.0.0.1:1080` — the `mixed` inbound you created in 3x-ui.

---

## Useful Commands

```bash
pm2 logs gallery-bot       # live logs
pm2 restart gallery-bot    # restart
pm2 stop gallery-bot       # stop
systemctl status x-ui      # check 3x-ui
```
