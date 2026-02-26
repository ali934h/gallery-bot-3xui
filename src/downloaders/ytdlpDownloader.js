/**
 * yt-dlp Video Downloader
 * Handles YouTube video downloads with quality selection
 */

const { spawn } = require('child_process');
const path = require('path');
const Logger = require('../utils/logger');

class YtdlpDownloader {
  /**
   * Extract video info and available formats
   * @param {string} url - YouTube video URL
   * @returns {Promise<Object>} Video info with formats
   */
  static async getVideoInfo(url) {
    return new Promise((resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-warnings',
        url
      ];

      const proc = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          Logger.error('Failed to get video info', { stderr });
          return reject(new Error('Failed to fetch video information'));
        }

        try {
          const info = JSON.parse(stdout);
          const videoId = info.id;
          const title = info.title;
          const duration = info.duration;
          const thumbnail = info.thumbnail;

          // Filter formats: video+audio, up to 1080p, mp4 preferred
          const formats = (info.formats || [])
            .filter(f => {
              if (!f.vcodec || f.vcodec === 'none') return false; // no video
              if (!f.acodec || f.acodec === 'none') return false; // no audio
              if (!f.height) return false;
              if (f.height > 1080) return false; // max 1080p
              return true;
            })
            .map(f => ({
              format_id: f.format_id,
              quality: `${f.height}p`,
              ext: f.ext || 'mp4',
              filesize: f.filesize || f.filesize_approx || 0,
              height: f.height,
              fps: f.fps || 30
            }))
            .sort((a, b) => b.height - a.height); // highest first

          // Deduplicate by quality (keep first = highest quality for each resolution)
          const seen = new Set();
          const uniqueFormats = [];
          for (const fmt of formats) {
            if (!seen.has(fmt.quality)) {
              seen.add(fmt.quality);
              uniqueFormats.push(fmt);
            }
          }

          if (uniqueFormats.length === 0) {
            return reject(new Error('No suitable formats found (need video+audio up to 1080p)'));
          }

          Logger.info(`Video info extracted: ${title} (${uniqueFormats.length} formats)`);

          resolve({
            videoId,
            title,
            duration,
            thumbnail,
            formats: uniqueFormats
          });
        } catch (error) {
          Logger.error('Failed to parse video info JSON', { error: error.message });
          reject(new Error('Invalid video information received'));
        }
      });
    });
  }

  /**
   * Download video with specific format
   * @param {string} url - YouTube video URL
   * @param {string} formatId - Format ID from getVideoInfo
   * @param {string} outputPath - Full output file path (without extension)
   * @param {Function} onProgress - Progress callback (percent: number)
   * @param {AbortSignal} signal - Abort signal for cancellation
   * @returns {Promise<string>} Final file path
   */
  static async downloadVideo(url, formatId, outputPath, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', formatId,
        '--merge-output-format', 'mp4',
        '--no-warnings',
        '--newline',
        '-o', `${outputPath}.%(ext)s`,
        url
      ];

      Logger.info(`Starting yt-dlp download: format=${formatId}`);

      const proc = spawn('yt-dlp', args);
      let stderr = '';
      let finalPath = null;

      const abortHandler = () => {
        proc.kill('SIGTERM');
        Logger.info('yt-dlp download aborted by user');
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      proc.stdout.on('data', (data) => {
        const line = data.toString().trim();

        // Parse progress: [download]  45.2% of 12.34MiB at 1.23MiB/s ETA 00:05
        const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        if (progressMatch) {
          const percent = parseFloat(progressMatch[1]);
          if (onProgress) onProgress(percent);
        }

        // Detect final filename: [Merger] Merging formats into "file.mp4"
        const mergeMatch = line.match(/\[Merger\].*into "([^"]+)"/);
        if (mergeMatch) {
          finalPath = mergeMatch[1];
        }

        // Or: [download] Destination: file.mp4
        const destMatch = line.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          finalPath = destMatch[1];
        }

        Logger.debug(`yt-dlp: ${line}`);
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        if (signal?.aborted) {
          return reject(new Error('Download cancelled'));
        }

        if (code !== 0) {
          Logger.error('yt-dlp download failed', { code, stderr });
          return reject(new Error('Video download failed'));
        }

        // If we didn't detect filename, assume .mp4
        if (!finalPath) {
          finalPath = `${outputPath}.mp4`;
        }

        Logger.info(`yt-dlp download complete: ${finalPath}`);
        resolve(finalPath);
      });
    });
  }

  /**
   * Format duration from seconds to MM:SS or HH:MM:SS
   */
  static formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = YtdlpDownloader;
