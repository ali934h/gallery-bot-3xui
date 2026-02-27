/**
 * YouTube Download Handler
 * Manages YouTube video download flow in Telegram bot
 */

const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const Logger = require('../utils/logger');
const FileManager = require('../utils/fileManager');
const YtdlpDownloader = require('../downloaders/ytdlpDownloader');

const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const UPDATE_INTERVAL_MS = 5000; // 5 seconds - same as gallery downloads

class YouTubeHandler {
  /**
   * Check if URL is a YouTube video
   */
  static isYouTubeUrl(url) {
    return YOUTUBE_REGEX.test(url);
  }

  /**
   * Handle YouTube URL
   */
  static async handleYouTubeUrl(ctx, url, session, downloadsDir, downloadBaseUrl, retryFn) {
    const statusMsg = await ctx.reply('⏳ Fetching video info from YouTube...');
    const msgId = statusMsg.message_id;

    try {
      // Get video info
      const videoInfo = await YtdlpDownloader.getVideoInfo(url);

      // Save to session
      session.pendingYoutubeJob = {
        url,
        videoId: videoInfo.videoId,
        title: videoInfo.title,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnail,
        formats: videoInfo.formats
      };
      session.state = 'WAITING_YOUTUBE_QUALITY';

      // Build quality selection message using HTML
      const durationStr = YtdlpDownloader.formatDuration(videoInfo.duration);
      const msg = [
        '🎬 <b>YouTube Video</b>',
        '',
        `<b>Title:</b> ${this.escapeHtml(videoInfo.title)}`,
        `<b>Duration:</b> ${durationStr}`,
        '',
        'Select quality:'
      ].join('\n');

      const buttons = videoInfo.formats.map(fmt => {
        let label = `🎬 ${fmt.quality} (${fmt.ext.toUpperCase()})`;
        if (fmt.filesize > 0) {
          const sizeStr = FileManager.formatBytes(fmt.filesize);
          label += ` - ${sizeStr}`;
        }
        return [Markup.button.callback(label, `yt:fmt:${fmt.format_id}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'yt:cancel')]);

      await retryFn(() =>
        ctx.telegram.editMessageText(
          ctx.chat.id,
          msgId,
          null,
          msg,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          }
        )
      );

      Logger.info(`YouTube quality selection shown for: ${videoInfo.videoId}`);
    } catch (error) {
      Logger.error('Failed to fetch YouTube video info', { error: error.message, url });
      await retryFn(() =>
        ctx.telegram.editMessageText(
          ctx.chat.id,
          msgId,
          null,
          `❌ Failed to fetch video info:\n\n${error.message}\n\nMake sure the URL is correct and the video is accessible.`
        )
      );
      session.state = 'IDLE';
      session.pendingYoutubeJob = null;
    }
  }

  /**
   * Handle quality selection callback
   */
  static async handleQualitySelection(ctx, formatId, session, downloadsDir, downloadBaseUrl, retryFn) {
    await ctx.answerCbQuery();

    if (!session.pendingYoutubeJob) {
      await ctx.editMessageText('❌ Session expired. Please send the YouTube URL again.');
      session.state = 'IDLE';
      return;
    }

    const job = session.pendingYoutubeJob;
    const selectedFormat = job.formats.find(f => f.format_id === formatId);

    if (!selectedFormat) {
      await ctx.editMessageText('❌ Invalid format selected. Please try again.');
      return;
    }

    session.state = 'DOWNLOADING_YOUTUBE';
    const abortController = new AbortController();
    session.abortController = abortController;

    // Update message to show download progress
    await ctx.editMessageText(
      `⬇️ Downloading: ${this.escapeHtml(job.title)}\n\nQuality: ${selectedFormat.quality}\nProgress: 0%`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel Download', 'yt:cancel_dl')]
        ])
      }
    );

    const msgId = ctx.callbackQuery.message.message_id;
    let lastUpdateTime = 0;
    let currentProgress = 0;

    try {
      // Generate output filename
      const timestamp = Date.now();
      const sanitizedTitle = job.title.replace(/[^a-zA-Z0-9-_.]/g, '_').substring(0, 50);
      const outputName = `yt_${job.videoId}_${timestamp}`;
      const outputPath = path.join(downloadsDir, outputName);

      // Download video
      const finalPath = await YtdlpDownloader.downloadVideo(
        job.url,
        formatId,
        outputPath,
        (percent) => {
          currentProgress = Math.floor(percent);
          const now = Date.now();
          
          // Update every 5 seconds, regardless of progress percentage
          if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
            lastUpdateTime = now;
            
            retryFn(() =>
              ctx.telegram.editMessageText(
                ctx.chat.id,
                msgId,
                null,
                `⬇️ Downloading: ${this.escapeHtml(job.title)}\n\nQuality: ${selectedFormat.quality}\nProgress: ${currentProgress}%`,
                {
                  parse_mode: 'HTML',
                  ...Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Cancel Download', 'yt:cancel_dl')]
                  ])
                }
              )
            ).catch(() => {});
          }
        },
        abortController.signal
      );

      // Get file stats
      const stats = fs.statSync(finalPath);
      const fileSize = FileManager.formatBytes(stats.size);
      const fileName = path.basename(finalPath);
      const downloadUrl = `${downloadBaseUrl}/${fileName}`;

      // Save metadata (title) for YouTube video
      this.saveMetadata(fileName, job.title, downloadsDir);

      // Send success message using HTML to preserve underscores
      const successMsg = [
        '✅ <b>Download Complete!</b>',
        '',
        `📹 ${this.escapeHtml(job.title)}`,
        `📊 Quality: ${selectedFormat.quality} (${selectedFormat.ext.toUpperCase()})`,
        `💾 Size: ${fileSize}`,
        '',
        '<b>Link:</b>',
        `<code>${this.escapeHtml(downloadUrl)}</code>`
      ].join('\n');

      await retryFn(() => ctx.reply(successMsg, { parse_mode: 'HTML', disable_web_page_preview: true }));
      await retryFn(() => ctx.telegram.deleteMessage(ctx.chat.id, msgId)).catch(() => {});

      Logger.info(`YouTube download complete: ${fileName}`);
    } catch (error) {
      if (error.message === 'Download cancelled') {
        await retryFn(() =>
          ctx.telegram.editMessageText(
            ctx.chat.id,
            msgId,
            null,
            '⚠️ Download cancelled by user.'
          )
        );
      } else {
        Logger.error('YouTube download failed', { error: error.message, videoId: job.videoId });
        await retryFn(() =>
          ctx.telegram.editMessageText(
            ctx.chat.id,
            msgId,
            null,
            `❌ Download failed:\n\n${error.message}`
          )
        );
      }
    } finally {
      session.state = 'IDLE';
      session.pendingYoutubeJob = null;
      session.abortController = null;
    }
  }

  /**
   * Save metadata for YouTube video
   */
  static saveMetadata(fileName, title, downloadsDir) {
    const metaPath = path.join(downloadsDir, fileName.replace(/\.mp4$/, '.json'));
    try {
      fs.writeFileSync(metaPath, JSON.stringify({ title }, null, 2), 'utf8');
      Logger.info(`Metadata saved for: ${fileName}`);
    } catch (err) {
      Logger.warn(`Failed to save metadata for ${fileName}`, { error: err.message });
    }
  }

  /**
   * Escape markdown special characters
   */
  static escapeMarkdown(text) {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  /**
   * Escape HTML special characters
   */
  static escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

module.exports = YouTubeHandler;
