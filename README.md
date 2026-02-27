# Gallery Downloader Bot — 3x-ui Edition

Telegram bot for downloading gallery images **and YouTube videos**, integrated with **3x-ui** panel for proxy support.

## Features

🖼 **Gallery Downloader**
- Extract images from multiple gallery sites
- Automatic site detection with fallback strategies
- Download images in parallel
- Package into ZIP files with direct download links

🎬 **YouTube Downloader**
- Download YouTube videos up to 1080p
- Quality selection with file size preview
- Cookie authentication for blocked content
- Direct download links (no compression)
- Video + audio merged automatically

---

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

The installer will:
- Install Node.js, PM2, yt-dlp, ffmpeg
- Clone the bot repository
- Configure environment variables
- Start the bot with PM2

You'll be asked for:
- Telegram Bot Token
- Bot domain (separate from 3x-ui domain!)
- SSL certificate paths
- Proxy username & password (from the mixed inbound you created)
- Allowed user IDs (optional)
- Download concurrency
- Downloads directory

---

## Usage

### Gallery Downloader

1. Send one or more gallery URLs (one per line)
2. Choose a name for the ZIP archive
3. Tap "Start Download" and wait
4. Receive your download link

**Officially supported sites:**
- See `src/config/siteStrategies.json` for full list
- Auto-detection works for similar gallery sites

### YouTube Downloader

1. Send a YouTube video URL
   - `https://www.youtube.com/watch?v=...`
   - `https://youtu.be/...`
2. Choose quality (360p, 480p, 720p, or 1080p)
3. Wait for download (progress updates every 5 seconds)
4. Receive your download link

**Note:** Videos include both video and audio tracks merged into MP4 format.

#### YouTube Cookie Setup (Optional)

If YouTube blocks downloads with "Sign in to confirm you're not a bot", set up cookies:

**1. Get cookies.txt from browser:**

**Chrome/Edge/Brave:**
1. Install extension: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Go to youtube.com and login
3. Click extension icon
4. Click "Export" → save `cookies.txt`

**Firefox:**
1. Install extension: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Go to youtube.com and login
3. Click extension icon
4. Save `cookies.txt`

**2. Upload to bot:**

1. Send `/setcookie` command to bot
2. Upload `cookies.txt` file as **Document** (not as photo)
3. Bot confirms: "Cookie saved successfully!"

**3. Test:**

Send a YouTube URL and check if download works.

**Remove cookies:** Use `/removecookie` command

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

**YouTube downloads:** Currently use direct connection (no proxy). You can modify `src/downloaders/ytdlpDownloader.js` to add proxy support if needed.

---

## Troubleshooting

### YouTube: "Sign in to confirm you're not a bot"

**Solution:** Upload cookies using `/setcookie` command (see YouTube Cookie Setup section above)

### YouTube: "No suitable formats found"

**Cause:** Video requires authentication or age verification

**Solution:** Upload cookies using `/setcookie` command

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

### Check yt-dlp
```bash
yt-dlp --version
yt-dlp --update  # update to latest version
```

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and see features |
| `/help` | Show detailed usage instructions |
| `/files` | View and manage downloaded files |
| `/setcookie` | Upload YouTube cookies.txt |
| `/removecookie` | Remove stored cookies |
| `/cancel` | Cancel current operation |

---

## File Management

Use `/files` command in Telegram to:
- View all downloaded files (ZIP + MP4)
- See video titles (not just filenames)
- Download individual files
- Delete files
- Bulk delete all files

Files are stored in the directory you specified during installation (default: `/root/gallery-downloads`).

---

## Useful Commands

```bash
pm2 logs gallery-bot           # live logs
pm2 restart gallery-bot        # restart
pm2 stop gallery-bot           # stop
pm2 restart gallery-bot \      # restart with new env vars
  --update-env
systemctl status x-ui          # check 3x-ui status
yt-dlp --version               # check yt-dlp version
yt-dlp --update                # update yt-dlp
```

---

## Requirements

- Ubuntu 20.04+ or Debian 11+ (tested)
- Node.js 18+ (auto-installed)
- yt-dlp (auto-installed)
- ffmpeg (auto-installed)
- 3x-ui panel with mixed inbound
- Valid SSL certificate
