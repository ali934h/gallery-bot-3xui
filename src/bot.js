/**
 * Telegram Bot Logic
 */

const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const Logger = require('./utils/logger');
const FileManager = require('./utils/fileManager');
const strategyEngine = require('./scrapers/strategyEngine');
const JsdomScraper = require('./scrapers/jsdomScraper');
const ImageDownloader = require('./downloaders/imageDownloader');
const ZipCreator = require('./downloaders/zipCreator');
const YouTubeHandler = require('./handlers/youtubeHandler');

const STATE = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  WAITING_NAME: 'waiting_name',
  WAITING_YOUTUBE_QUALITY: 'waiting_youtube_quality',
  DOWNLOADING_YOUTUBE: 'downloading_youtube',
  WAITING_COOKIE_FILE: 'waiting_cookie_file'
};

const UPDATE_INTERVAL_MS = 5000;
const VALID_NAME_REGEX = /^[a-zA-Z0-9\-._]+$/;

const userSessions = new Map();

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(process.cwd(), 'downloads');
const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_BASE_URL || 'http://localhost:3000/downloads';
const DOWNLOAD_CONCURRENCY = parseInt(process.env.DOWNLOAD_CONCURRENCY) || 5;
const COOKIE_PATH = path.join(process.cwd(), 'cookies.txt');

const ALLOWED_USERS = new Set(
  (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

const isAllowed = (userId) => ALLOWED_USERS.size === 0 || ALLOWED_USERS.has(userId);

function e(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function readMeta(fileName) {
  const metaPath = path.join(DOWNLOADS_DIR, fileName.replace(/\.(zip|mp4)$/, '.json'));
  try {
    if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {}
  return null;
}

function saveMeta(zipName, urls) {
  const metaPath = path.join(DOWNLOADS_DIR, zipName.replace(/\.zip$/, '.json'));
  try {
    fs.writeFileSync(metaPath, JSON.stringify({ urls }, null, 2), 'utf8');
  } catch (err) {
    Logger.warn(`Failed to save metadata for ${zipName}`, { error: err.message });
  }
}

function deleteMeta(fileName) {
  const metaPath = path.join(DOWNLOADS_DIR, fileName.replace(/\.(zip|mp4)$/, '.json'));
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
}

class TelegramBot {
  constructor(token) {
    this.bot = new Telegraf(token, {
      telegram: { apiRoot: 'https://api.telegram.org', webhookReply: true }
    });
    this.bot.telegram.options = { ...this.bot.telegram.options, timeout: 300000 };
    this.ensureDownloadsDir();
    this.setupHandlers();
  }

  ensureDownloadsDir() {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      Logger.info(`Downloads directory created: ${DOWNLOADS_DIR}`);
    }
  }

  getUserSession(userId) {
    if (!userSessions.has(userId)) userSessions.set(userId, { state: STATE.IDLE });
    return userSessions.get(userId);
  }

  async retryWithBackoff(fn, maxRetries = 5, baseDelay = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimit = error.message && (
          error.message.includes('429') ||
          error.message.includes('Too Many Requests') ||
          error.message.includes('retry after')
        );
        if (!isRateLimit || attempt === maxRetries) throw error;
        let delay = baseDelay * Math.pow(2, attempt);
        const match = error.message.match(/retry after (\d+)/);
        if (match) delay = Math.max(delay, parseInt(match[1]) * 1000);
        Logger.warn(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async updateStatus(ctx, messageId, text, keyboard = null) {
    const opts = keyboard ? keyboard : {};
    await this.retryWithBackoff(() =>
      ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text, opts)
    ).catch(() => {});
  }

  getDownloadedFiles() {
    if (!fs.existsSync(DOWNLOADS_DIR)) return [];
    return fs.readdirSync(DOWNLOADS_DIR)
      .filter(f => f.endsWith('.zip') || f.endsWith('.mp4'))
      .map(name => {
        const filePath = path.join(DOWNLOADS_DIR, name);
        const stats = fs.statSync(filePath);
        return { name, size: stats.size, date: stats.mtime };
      })
      .sort((a, b) => b.date - a.date);
  }

  buildFilesListMessage() {
    const files = this.getDownloadedFiles();
    if (files.length === 0) return { text: 'No downloaded files found.', keyboard: null };
    const totalSize = FileManager.formatBytes(files.reduce((sum, f) => sum + f.size, 0));
    const msg = `\u{1F5C2} Downloaded files: ${files.length} total (${totalSize})`;
    const buttons = files.map((f, i) => {
      const meta = readMeta(f.name);
      let displayName = f.name;
      
      // Show title instead of filename if metadata exists
      if (meta && meta.title) {
        displayName = meta.title.substring(0, 40);
      } else if (meta && meta.urls) {
        // Gallery: keep original behavior
        displayName = f.name.substring(0, 40);
      } else {
        displayName = f.name.substring(0, 40);
      }
      
      const icon = f.name.endsWith('.zip') ? '\u{1F4C2}' : '\u{1F3AC}';
      return [Markup.button.callback(`${icon} ${i + 1}. ${displayName}`, `fi:${i}`)];
    });
    buttons.push([Markup.button.callback('\u2699\uFE0F Manage All Files', 'manage_all')]);
    return { text: msg, keyboard: Markup.inlineKeyboard(buttons) };
  }

  buildDefaultName(urls) {
    const slug = JsdomScraper.extractGalleryName(urls[0]).substring(0, 30);
    return `${slug}_${Date.now()}`;
  }

  async sendNamePrompt(ctx, session) {
    const defaultName = session.pendingJob.archiveName;
    const msg =
      `\u{1F4DD} Archive name:\n\n` +
      `Default: ${defaultName}\n\n` +
      `Tap "Start Download" to use it, or "Rename" to choose a custom name.\n\n` +
      `Allowed characters: letters, numbers, - _ .`;
    await ctx.reply(msg, Markup.inlineKeyboard([
      [Markup.button.callback('\u2705 Start Download', 'start_download')],
      [Markup.button.callback('\u270F\uFE0F Rename', 'rename_archive')]
    ]));
  }

  async setBotCommands() {
    try {
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'How to use this bot' },
        { command: 'files', description: 'View and manage downloaded files' },
        { command: 'setcookie', description: 'Upload YouTube cookies for authentication' },
        { command: 'removecookie', description: 'Remove stored YouTube cookies' },
        { command: 'cancel', description: 'Cancel current operation' }
      ]);
      Logger.info('Bot commands menu set successfully');
    } catch (error) {
      Logger.warn('Failed to set bot commands', { error: error.message });
    }
  }

  setupHandlers() {
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;
      if (!isAllowed(userId)) {
        Logger.warn(`Unauthorized access attempt by user: ${userId}`);
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('\u26D4 Access denied.').catch(() => {});
        } else {
          await ctx.reply('\u26D4 You are not authorized to use this bot.').catch(() => {});
        }
        return;
      }
      return next();
    });

    this.bot.start((ctx) => {
      const session = this.getUserSession(ctx.from.id);
      session.state = STATE.IDLE;
      Logger.info(`User started bot: ${ctx.from.id}`);
      
      const cookieStatus = fs.existsSync(COOKIE_PATH) ? '\u2705 Cookie active' : '\u274c No cookie';
      
      ctx.reply(
        'Welcome to Gallery Downloader Bot!\n\n' +
        '\ud83d\uddbc Gallery Downloader:\n' +
        'Send me one or more gallery URLs (one per line) and I will extract all images, download them, and create a ZIP file.\n\n' +
        '\ud83c\udfac YouTube Downloader:\n' +
        'Send me a YouTube video URL and choose your preferred quality (up to 1080p).\n\n' +
        `\ud83c\udf6a Cookie status: ${cookieStatus}\n\n` +
        'Commands:\n' +
        '  /files - Manage downloaded files\n' +
        '  /setcookie - Upload YouTube cookies\n' +
        '  /removecookie - Remove cookies\n' +
        '  /help  - How to use\n\n' +
        'Supported gallery sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n') + '\n\n' +
        '\u26a1 Auto-detection: I can also try to extract images from similar sites automatically!'
      );
    });

    this.bot.command('help', (ctx) => {
      ctx.reply(
        'How to use:\n\n' +
        '\ud83d\uddbc *Gallery Downloader:*\n' +
        '1. Send one or more gallery URLs (one per line)\n' +
        '2. Choose a name for the ZIP archive\n' +
        '3. Tap "Start Download" and wait\n' +
        '4. Receive your download link\n\n' +
        '\ud83c\udfac *YouTube Downloader:*\n' +
        '1. Send a YouTube video URL\n' +
        '2. Choose quality (up to 1080p)\n' +
        '3. Wait for download\n' +
        '4. Receive your download link\n\n' +
        '\ud83c\udf6a *Cookie Setup (if YouTube blocks):*\n' +
        '1. Send /setcookie command\n' +
        '2. Upload cookies.txt file as Document\n' +
        '3. Try downloading again\n\n' +
        '*How to get cookies.txt:*\n' +
        '\u2022 Chrome: Install "Get cookies.txt LOCALLY"\n' +
        '\u2022 Firefox: Install "cookies.txt" extension\n' +
        '\u2022 Visit youtube.com and login\n' +
        '\u2022 Click extension and export cookies\n\n' +
        'Commands:\n' +
        '  /files  - View and manage files\n' +
        '  /setcookie - Upload cookies\n' +
        '  /removecookie - Remove cookies\n' +
        '  /cancel - Cancel current operation\n\n' +
        'Supported gallery sites:\n' +
        strategyEngine.getSupportedDomains().map(d => `  - ${d}`).join('\n') + '\n\n' +
        '\u26a1 Auto-detection enabled for similar sites!',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('setcookie', (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      session.state = STATE.WAITING_COOKIE_FILE;
      
      ctx.reply(
        '\ud83c\udf6a Please send the cookies.txt file as a *Document*.\n\n' +
        '\ud83d\udcd6 How to get cookies:\n\n' +
        '*Chrome/Edge/Brave:*\n' +
        '1\u20e3 Install extension: "Get cookies.txt LOCALLY"\n' +
        '2\u20e3 Go to youtube.com and login\n' +
        '3\u20e3 Click extension icon\n' +
        '4\u20e3 Click "Export" and download file\n' +
        '5\u20e3 Send it here as Document\n\n' +
        '*Firefox:*\n' +
        '1\u20e3 Install extension: "cookies.txt"\n' +
        '2\u20e3 Go to youtube.com and login\n' +
        '3\u20e3 Click extension icon\n' +
        '4\u20e3 Save cookies.txt file\n' +
        '5\u20e3 Send it here as Document',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('removecookie', (ctx) => {
      if (fs.existsSync(COOKIE_PATH)) {
        fs.unlinkSync(COOKIE_PATH);
        Logger.info(`Cookie removed by user: ${ctx.from.id}`);
        ctx.reply('\u2705 Cookie removed successfully.');
      } else {
        ctx.reply('\u274c No cookie found.');
      }
    });

    this.bot.command('cancel', (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      if (session.state === STATE.PROCESSING || session.state === STATE.DOWNLOADING_YOUTUBE) {
        ctx.reply('A job is currently running. Please wait for it to finish.');
      } else {
        session.state = STATE.IDLE;
        session.pendingJob = null;
        session.pendingYoutubeJob = null;
        ctx.reply('Cancelled. Ready for new URLs.');
      }
    });

    this.bot.command('files', (ctx) => {
      const { text, keyboard } = this.buildFilesListMessage();
      keyboard ? ctx.reply(text, keyboard) : ctx.reply(text);
    });

    // Handle document uploads (cookies)
    this.bot.on('document', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      
      if (session.state !== STATE.WAITING_COOKIE_FILE) {
        return;
      }
      
      const document = ctx.message.document;
      
      if (!document.file_name.endsWith('.txt')) {
        await ctx.reply('\u274c Please send only .txt files.');
        return;
      }
      
      try {
        const file = await ctx.telegram.getFile(document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${ctx.telegram.token}/${file.file_path}`;
        
        const response = await fetch(fileUrl);
        const content = await response.text();
        
        if (!content.includes('youtube.com') && !content.includes('google.com')) {
          await ctx.reply('\u274c Invalid cookie file. Must contain YouTube/Google cookies.');
          session.state = STATE.IDLE;
          return;
        }
        
        fs.writeFileSync(COOKIE_PATH, content, 'utf8');
        Logger.info(`Cookie uploaded by user: ${ctx.from.id}`);
        
        await ctx.reply(
          '\u2705 Cookie saved successfully!\n\n' +
          'You can now send YouTube URLs to download videos.\n\n' +
          'To remove cookies later, use /removecookie'
        );
        
        session.state = STATE.IDLE;
        
      } catch (error) {
        Logger.error('Cookie upload error', { error: error.message, user: ctx.from.id });
        await ctx.reply(`\u274c Error saving cookie: ${error.message}`);
        session.state = STATE.IDLE;
      }
    });

    // YouTube handlers
    this.bot.action(/^yt:fmt:(.+)$/, async (ctx) => {
      const formatId = ctx.match[1];
      const session = this.getUserSession(ctx.from.id);
      await YouTubeHandler.handleQualitySelection(
        ctx,
        formatId,
        session,
        DOWNLOADS_DIR,
        DOWNLOAD_BASE_URL,
        this.retryWithBackoff.bind(this)
      );
    });

    this.bot.action('yt:cancel', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      await ctx.answerCbQuery('Cancelled');
      session.state = STATE.IDLE;
      session.pendingYoutubeJob = null;
      await ctx.editMessageText('\u274c Cancelled. Ready for new URLs.');
    });

    this.bot.action('yt:cancel_dl', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      await ctx.answerCbQuery('Cancelling...');
      if (session.abortController) {
        session.abortController.abort();
        Logger.info(`User ${ctx.from.id} cancelled YouTube download`);
      }
    });

    // Gallery handlers
    this.bot.action('rename_archive', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      await ctx.answerCbQuery();
      session.state = STATE.WAITING_NAME;
      await ctx.editMessageText(
        '\u270F\uFE0F Type your custom archive name:\n\nAllowed: letters, numbers, - _ .\nExample: my-gallery_2026'
      );
    });

    this.bot.action('start_download', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      await ctx.answerCbQuery();
      if (!session.pendingJob) {
        await ctx.editMessageText('Session expired. Please send the URLs again.');
        return;
      }
      await ctx.deleteMessage().catch(() => {});
      const { urls, archiveName } = session.pendingJob;
      session.pendingJob = null;
      await this.processGalleries(ctx, urls, archiveName);
    });

    this.bot.action('cancel_download', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      await ctx.answerCbQuery('Cancelling...');
      if (session.abortController) {
        session.abortController.abort();
        Logger.info(`User ${ctx.from.id} cancelled gallery download`);
      }
    });

    this.bot.action(/^fi:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1]);
      const files = this.getDownloadedFiles();
      if (idx < 0 || idx >= files.length) {
        await ctx.answerCbQuery('File not found.');
        const { text, keyboard } = this.buildFilesListMessage();
        await ctx.editMessageText(text, keyboard || undefined);
        return;
      }
      const f = files[idx];
      const size = FileManager.formatBytes(f.size);
      const date = f.date.toISOString().slice(0, 16).replace('T', ' ');
      const downloadUrl = `${DOWNLOAD_BASE_URL}/${f.name}`;
      const meta = readMeta(f.name);
      const icon = f.name.endsWith('.zip') ? '\u{1F4C2}' : '\u{1F3AC}';
      
      // Display title if available (YouTube), otherwise filename
      let displayName = f.name;
      if (meta && meta.title) {
        displayName = meta.title;
      }
      
      const msg = [
        `${icon} *File Details*`, '',
        `Name: \`${e(displayName)}\``,
        `Size: ${e(size)}`,
        `Date: ${e(date)}`, '',
        'Link:', '```', e(downloadUrl), '```'
      ].join('\n');
      const rows = [
        [Markup.button.callback('\u{1F5D1} Delete This File', `cd:${idx}`)],
        [Markup.button.callback('\u2B05\uFE0F Back to List', 'back_to_list')]
      ];
      if (meta && meta.urls && meta.urls.length > 0) {
        rows.unshift([Markup.button.callback('\u{1F517} Gallery Sources', `src:${idx}`)]);
      }
      await ctx.answerCbQuery();
      await ctx.editMessageText(msg, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard(rows)
      });
    });

    this.bot.action(/^src:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1]);
      const files = this.getDownloadedFiles();
      if (idx < 0 || idx >= files.length) { await ctx.answerCbQuery('File not found.'); return; }
      const f = files[idx];
      const meta = readMeta(f.name);
      if (!meta || !meta.urls || meta.urls.length === 0) { await ctx.answerCbQuery('No source URLs found.'); return; }
      const msg = [
        '\u{1F517} *Gallery Sources*', `${e(f.name)}`, '', '```',
        meta.urls.map(u => e(u)).join('\n'), '```'
      ].join('\n');
      await ctx.answerCbQuery();
      await ctx.editMessageText(msg, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([[Markup.button.callback('\u2B05\uFE0F Back', `fi:${idx}`)]])
      });
    });

    this.bot.action(/^cd:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1]);
      const files = this.getDownloadedFiles();
      if (idx < 0 || idx >= files.length) { await ctx.answerCbQuery('File not found.'); return; }
      const fileName = files[idx].name;
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `\u26A0\uFE0F Are you sure you want to delete:\n\n${fileName}?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('\u2705 Yes, Delete', `dd:${idx}`)],
          [Markup.button.callback('\u274C Cancel', `fi:${idx}`)]
        ])
      );
    });

    this.bot.action(/^dd:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match[1]);
      const files = this.getDownloadedFiles();
      if (idx < 0 || idx >= files.length) { await ctx.answerCbQuery('File not found.'); return; }
      const fileName = files[idx].name;
      try {
        await FileManager.deleteFile(path.join(DOWNLOADS_DIR, fileName));
        deleteMeta(fileName);
        Logger.info(`File deleted: ${fileName}`);
        await ctx.answerCbQuery('File deleted.');
        const remaining = this.getDownloadedFiles();
        if (remaining.length === 0) {
          await ctx.editMessageText('\u2705 File deleted. No more files.');
        } else {
          const { text, keyboard } = this.buildFilesListMessage();
          await ctx.editMessageText(text, keyboard);
        }
      } catch (error) {
        Logger.error(`Failed to delete file: ${fileName}`, { error: error.message });
        await ctx.answerCbQuery('Failed to delete file.');
      }
    });

    this.bot.action('back_to_list', async (ctx) => {
      await ctx.answerCbQuery();
      const { text, keyboard } = this.buildFilesListMessage();
      keyboard ? await ctx.editMessageText(text, keyboard) : await ctx.editMessageText(text);
    });

    this.bot.action('manage_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      const totalSize = FileManager.formatBytes(files.reduce((sum, f) => sum + f.size, 0));
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `\u2699\uFE0F Manage All Files\n\nTotal: ${files.length} file(s), ${totalSize}\n\nThis will permanently delete all downloaded files.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('\u{1F5D1} Delete ALL Files', 'confirm_del_all')],
          [Markup.button.callback('\u2B05\uFE0F Back to List', 'back_to_list')]
        ])
      );
    });

    this.bot.action('confirm_del_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `\u26A0\uFE0F Are you sure you want to delete ALL ${files.length} file(s)?\n\nThis cannot be undone.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('\u2705 Yes, Delete All', 'do_del_all')],
          [Markup.button.callback('\u274C Cancel', 'manage_all')]
        ])
      );
    });

    this.bot.action('do_del_all', async (ctx) => {
      const files = this.getDownloadedFiles();
      let deleted = 0;
      for (const f of files) {
        try {
          await FileManager.deleteFile(path.join(DOWNLOADS_DIR, f.name));
          deleteMeta(f.name);
          deleted++;
        } catch (error) {
          Logger.error(`Failed to delete: ${f.name}`, { error: error.message });
        }
      }
      Logger.info(`Bulk delete: ${deleted}/${files.length} files removed`);
      await ctx.answerCbQuery(`Deleted ${deleted} file(s).`);
      await ctx.editMessageText(`\u2705 Done. ${deleted} file(s) deleted.`);
    });

    this.bot.on('text', async (ctx) => {
      const session = this.getUserSession(ctx.from.id);
      const text = ctx.message.text.trim();

      // Handle WAITING_NAME state
      if (session.state === STATE.WAITING_NAME) {
        const input = text;
        if (!VALID_NAME_REGEX.test(input)) {
          ctx.reply('\u274C Invalid name. Only letters, numbers, - _ . are allowed.\n\nPlease type a valid name:');
          return;
        }
        if (input.length < 2 || input.length > 80) {
          ctx.reply('\u274C Name must be between 2 and 80 characters. Try again:');
          return;
        }
        session.pendingJob.archiveName = input;
        session.state = STATE.IDLE;
        await ctx.reply(
          `\u2705 Name set to: ${input}\n\nReady to download.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('\u2705 Start Download', 'start_download')],
            [Markup.button.callback('\u270F\uFE0F Rename Again', 'rename_archive')]
          ])
        );
        return;
      }

      // Prevent new requests if processing
      if (session.state === STATE.PROCESSING || session.state === STATE.DOWNLOADING_YOUTUBE) {
        ctx.reply('Already processing a job. Please wait until it finishes.');
        return;
      }

      // Check if YouTube URL
      if (YouTubeHandler.isYouTubeUrl(text)) {
        await YouTubeHandler.handleYouTubeUrl(
          ctx,
          text,
          session,
          DOWNLOADS_DIR,
          DOWNLOAD_BASE_URL,
          this.retryWithBackoff.bind(this)
        );
        return;
      }

      // Otherwise treat as gallery URLs
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('http'));
      if (lines.length === 0) {
        ctx.reply('No valid URLs found.\n\nPlease send:\n  - Gallery URLs (one per line)\n  - YouTube video URL');
        return;
      }
      const defaultName = this.buildDefaultName(lines);
      session.pendingJob = { urls: lines, archiveName: defaultName };
      session.state = STATE.IDLE;
      await this.sendNamePrompt(ctx, session);
    });

    this.bot.catch((err, ctx) => {
      Logger.error('Unhandled bot error', { error: err.message, user: ctx.from?.id });
      ctx.reply('An unexpected error occurred. Please try again or send /start to reset.').catch(() => {});
      const session = this.getUserSession(ctx.from?.id);
      if (session) {
        session.state = STATE.IDLE;
        session.pendingJob = null;
        session.pendingYoutubeJob = null;
        session.abortController = null;
      }
    });
  }

  async processGalleries(ctx, urls, archiveName) {
    const session = this.getUserSession(ctx.from.id);
    session.state = STATE.PROCESSING;
    const abortController = new AbortController();
    session.abortController = abortController;
    const { signal } = abortController;
    const cancelKeyboard = Markup.inlineKeyboard([[Markup.button.callback('\u274C Cancel Download', 'cancel_download')]]);
    const statusMsg = await ctx.reply('Starting... please wait.', cancelKeyboard);
    const msgId = statusMsg.message_id;
    let tempDir = null;
    try {
      await this.updateStatus(ctx, msgId,
        `Extracting images from ${urls.length} ${urls.length === 1 ? 'gallery' : 'galleries'}...`,
        cancelKeyboard
      );
      const galleries = [];
      const unsupportedUrls = [];
      for (let i = 0; i < urls.length; i++) {
        if (signal.aborted) break;
        const url = urls[i];
        let strategy = strategyEngine.getStrategy(url);
        const galleryName = JsdomScraper.extractGalleryName(url);
        try {
          let imageUrls = [];
          if (strategy) {
            imageUrls = await JsdomScraper.extractImages(url, strategy);
          }
          if (!strategy || imageUrls.length === 0) {
            Logger.info(`Trying fallback strategies for: ${url}`);
            await this.updateStatus(ctx, msgId,
              `Testing extraction methods for gallery ${i + 1}/${urls.length}...\n(This may take a moment)`,
              cancelKeyboard
            );
            const result = await strategyEngine.findWorkingStrategy(url, JsdomScraper, 5);
            if (result) {
              strategy = result.strategy;
              imageUrls = result.images;
            } else {
              unsupportedUrls.push(url);
              galleries.push({ name: galleryName, urls: [], useProxy: false });
              continue;
            }
          }
          galleries.push({ name: galleryName, urls: imageUrls, useProxy: strategy.useProxy || false });
          Logger.info(`Gallery ${i + 1}/${urls.length} extracted: ${galleryName} (${imageUrls.length} images)`);
        } catch (err) {
          Logger.warn(`Failed to extract gallery: ${url}`, { error: err.message });
          unsupportedUrls.push(url);
          galleries.push({ name: galleryName, urls: [], useProxy: false });
        }
        await this.updateStatus(ctx, msgId,
          `Extracting images... (${i + 1}/${urls.length} galleries done)`,
          cancelKeyboard
        );
      }
      if (unsupportedUrls.length > 0) {
        await ctx.reply(`\u26a0\ufe0f Could not extract images from ${unsupportedUrls.length} URL(s).\nContinuing with successful galleries...`).catch(() => {});
      }
      const totalImages = galleries.reduce((sum, g) => sum + g.urls.length, 0);
      if (totalImages === 0) throw new Error('No images found in any of the provided galleries.');
      await this.updateStatus(ctx, msgId,
        `Found ${totalImages} images across ${galleries.filter(g => g.urls.length > 0).length} galleries.\nDownloading...`,
        cancelKeyboard
      );
      tempDir = await FileManager.createTempDir('galleries');
      let lastUpdateTime = 0;
      const downloadResult = await ImageDownloader.downloadMultipleGalleries(
        galleries.filter(g => g.urls.length > 0),
        tempDir,
        (progress) => {
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
            lastUpdateTime = now;
            this.updateStatus(ctx, msgId,
              `Downloading gallery ${progress.completedGalleries + 1}/${progress.totalGalleries}\n` +
              `Current: ${progress.galleryName}\n` +
              `Progress: ${progress.galleryProgress.current}/${progress.galleryProgress.total} images`,
              cancelKeyboard
            ).catch(() => {});
          }
        },
        signal,
        DOWNLOAD_CONCURRENCY
      );
      if (downloadResult.successImages === 0) {
        await this.updateStatus(ctx, msgId,
          signal.aborted ? 'Cancelled. No images were downloaded yet.' : 'Failed to download any images.'
        );
        return;
      }
      await this.updateStatus(ctx, msgId, signal.aborted ? `Cancelled. Packaging ${downloadResult.successImages} images...` : 'Creating ZIP archive...');
      const zipPath = await ZipCreator.createZip(tempDir, archiveName, DOWNLOADS_DIR);
      const zipFileName = path.basename(zipPath);
      saveMeta(zipFileName, urls);
      const downloadUrl = `${DOWNLOAD_BASE_URL}/${zipFileName}`;
      const stats = fs.statSync(zipPath);
      const fileSize = FileManager.formatBytes(stats.size);
      const prefix = signal.aborted ? '\u26A0\uFE0F Partial' : '\u2705 Done';
      const finalMsg = [`${prefix} ${e(String(downloadResult.successImages))} images, ${e(fileSize)}`, '', '```', e(downloadUrl), '```'].join('\n');
      await this.retryWithBackoff(() => ctx.reply(finalMsg, { parse_mode: 'MarkdownV2', disable_web_page_preview: true }));
      await this.retryWithBackoff(() => ctx.telegram.deleteMessage(ctx.chat.id, msgId)).catch(() => {});
      Logger.info(`Job complete for user ${ctx.from.id}: ${zipFileName}`);
    } catch (error) {
      Logger.error('Gallery processing failed', { error: error.message, user: ctx.from.id });
      await this.updateStatus(ctx, msgId, `Error: ${error.message}\n\nPlease check your URLs and try again.`);
    } finally {
      if (tempDir) await FileManager.deleteDir(tempDir).catch(() => {});
      session.state = STATE.IDLE;
      session.abortController = null;
    }
  }

  async initialize() {
    await strategyEngine.loadStrategies();
    await this.setBotCommands();
    Logger.info('Bot initialized successfully');
    if (ALLOWED_USERS.size > 0) {
      Logger.info(`Whitelist active: ${[...ALLOWED_USERS].join(', ')}`);
    }
    if (fs.existsSync(COOKIE_PATH)) {
      Logger.info('YouTube cookies loaded from cookies.txt');
    }
  }

  async startWebhook(webhookDomain, webhookPath) {
    await this.initialize();
    await this.bot.telegram.setWebhook(`${webhookDomain}${webhookPath}`);
    Logger.info(`Webhook set: ${webhookDomain}${webhookPath}`);
    return this.bot;
  }

  async startPolling() {
    await this.initialize();
    await this.bot.launch();
    Logger.info('Bot started with polling');
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }
}

module.exports = TelegramBot;
