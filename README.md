# Gallery Downloader Bot — 3x-ui Edition

Telegram bot for downloading gallery images, integrated with **3x-ui** panel for proxy support.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                            Server                                │
│                                                                  │
│  3x-ui panel  (your-vpn-domain.com)                              │
│    └── Xray                                                      │
│          ├── Inbound: VLESS/Trojan (any port)   ← for VPN users  │
│          └── Inbound: mixed 127.0.0.1:1080      ← for this bot   │
│                                                                  │
│  Gallery Bot  (your-bot-domain.com:443)                          │
│    └── PROXY_URL=socks5://user:pass@127.0.0.1:1080               │
└──────────────────────────────────────────────────────────────────┘
```

> ⚠️ **The bot domain MUST be different from the 3x-ui domain.**  
> Both services listen on port 443 — they need separate domains/IPs.

---

## Prerequisites

### Step 1 — Install 3x-ui

Install [3x-ui](https://github.com/MHSanaei/3x-ui) on your server with your preferred settings.

### Step 2 — Create a `mixed` inbound in 3x-ui panel

In the 3x-ui web panel, go to **Inbounds → Add Inbound**:

| Field      | Value           |
|------------|-----------------|
| Protocol   | `mixed`         |
| Listen IP  | `127.0.0.1`     |
| Port       | `1080`          |
| Password   | Enabled ✅      |
| Username   | (any value)     |
| Password   | (any value)     |

> This inbound is **local only** (127.0.0.1) — not exposed to the internet.  
> Note your username and password — you will need them during installation.

> 💡 **Why `mixed`?** The 3x-ui panel may not show `socks` as a protocol option.  
> The `mixed` protocol supports both SOCKS5 and HTTP proxy on the same port.

### Step 3 — Prepare bot domain & SSL

You have **two options** for SSL:

#### Option A — Let's Encrypt (Certbot) ✅ Recommended

Simplest option. No Cloudflare proxy needed.

```bash
# Stop the bot first (it uses port 443)
pm2 stop gallery-bot

# Get certificate
certbot certonly --standalone -d your-bot-domain.com

# Restart bot after
pm2 restart gallery-bot --update-env
```

Then use these paths in the installer:
```
SSL_CERT = /etc/letsencrypt/live/your-bot-domain.com/fullchain.pem
SSL_KEY  = /etc/letsencrypt/live/your-bot-domain.com/privkey.pem
```

**Cloudflare DNS:** leave proxy **disabled** (grey cloud ☁️)

---

#### Option B — Cloudflare Origin Certificate

If you use a **Cloudflare Origin Certificate** (generated from Cloudflare dashboard → SSL/TLS → Origin Server), you **must** follow these settings exactly:

**1. Cloudflare DNS settings:**

| Setting | Value |
|---------|-------|
| DNS Proxy | 🟠 **Enabled (orange cloud)** |

> ⚠️ If you turn the proxy OFF, Telegram will connect directly to your server and the Origin Certificate will fail verification (`SSL error: certificate verify failed`). The Origin Certificate is only trusted by Cloudflare, not by public CAs.

**2. Cloudflare SSL/TLS mode:**

Go to your Cloudflare dashboard → **SSL/TLS → Overview** and set:

| Mode | Description | Use? |
|------|-------------|------|
| Off | No HTTPS | ❌ |
| Flexible | HTTPS to Cloudflare only, HTTP to server | ❌ |
| Full | HTTPS to server, no cert verification | ⚠️ Works but not secure |
| **Full (strict)** | HTTPS to server, verifies Origin Cert | ✅ **Required** |

Set it to **Full (strict)**.

**3. How traffic flows with this option:**

```
Telegram → Cloudflare (public cert ✅) → Your Server (Origin Cert ✅)
```

Telegram only talks to Cloudflare, which has a trusted public certificate. Cloudflare then connects to your server using the Origin Certificate.

**4. SSL cert paths** (use the files you downloaded from Cloudflare Origin Server page):
```
SSL_CERT = /path/to/cert.pem   (or .crt — the certificate file)
SSL_KEY  = /path/to/key.pem    (or .key — the private key file)
```

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
{
  "example-site.com": {
    "useProxy": true,    ← routes through Xray (3x-ui)
    ...
  },
  "another-site.com": {
    "useProxy": false,   ← direct connection
    ...
  }
}
```

When `useProxy: true`, the bot routes traffic through `socks5://user:pass@127.0.0.1:1080` — the `mixed` inbound you created in 3x-ui.

---

## Troubleshooting

### Check webhook status
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

| `last_error_message` | Cause | Fix |
|----------------------|-------|-----|
| `SSL error: certificate verify failed` | Using Origin Cert with proxy OFF | Enable Cloudflare proxy (orange cloud) |
| `Wrong response: 521` | Cloudflare can't reach your server | Check that bot is running: `pm2 status` |
| `Connection refused` | Bot not running or wrong port | `pm2 restart gallery-bot --update-env` |
| *(empty)* | ✅ Everything working | — |

### View live logs
```bash
pm2 logs gallery-bot
```

---

## Useful Commands

```bash
pm2 logs gallery-bot           # live logs
pm2 restart gallery-bot        # restart
pm2 stop gallery-bot           # stop
pm2 restart gallery-bot \      # restart with new env vars
  --update-env
systemctl status x-ui          # check 3x-ui status
```
