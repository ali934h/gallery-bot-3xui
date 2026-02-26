/**
 * Image Downloader
 * Downloads images in parallel with configurable concurrency
 * Supports SOCKS5 proxy via socks-proxy-agent
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');
const Logger = require('../utils/logger');

class ImageDownloader {
  static getProxyAgent() {
    const proxyUrl = process.env.PROXY_URL;
    if (!proxyUrl) return null;
    try {
      if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks5://')) {
        return new SocksProxyAgent(proxyUrl);
      }
      return null;
    } catch (error) {
      Logger.warn(`Invalid PROXY_URL: ${proxyUrl}`);
      return null;
    }
  }

  static async downloadImage(url, destPath, useProxy = false, retries = 3) {
    const proxyAgent = useProxy ? this.getProxyAgent() : null;
    const axiosConfig = {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    };
    if (proxyAgent) {
      axiosConfig.httpAgent = proxyAgent;
      axiosConfig.httpsAgent = proxyAgent;
    }
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, axiosConfig);
        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(destPath);
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        return true;
      } catch (error) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        Logger.warn(`Failed to download image: ${url}`, { error: error.message });
        return false;
      }
    }
    return false;
  }

  static async downloadGallery(gallery, destDir, onProgress, signal, concurrency = 5) {
    const { name, urls, useProxy } = gallery;
    const galleryDir = path.join(destDir, name);
    if (!fs.existsSync(galleryDir)) fs.mkdirSync(galleryDir, { recursive: true });

    let completed = 0;
    let success = 0;
    const total = urls.length;
    const queue = [...urls.entries()];

    const worker = async () => {
      while (queue.length > 0) {
        if (signal?.aborted) break;
        const [idx, url] = queue.shift();
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const filename = `${String(idx + 1).padStart(4, '0')}${ext}`;
        const destPath = path.join(galleryDir, filename);
        const ok = await this.downloadImage(url, destPath, useProxy);
        if (ok) success++;
        completed++;
        onProgress?.({ current: completed, total });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, urls.length || 1) }, () => worker());
    await Promise.all(workers);
    return { success, total };
  }

  static async downloadMultipleGalleries(galleries, destDir, onProgress, signal, concurrency = 5) {
    let totalSuccess = 0;
    let completedGalleries = 0;
    const totalGalleries = galleries.length;

    for (const gallery of galleries) {
      if (signal?.aborted) break;
      Logger.info(`Downloading gallery: ${gallery.name} (${gallery.urls.length} images)`);
      const result = await this.downloadGallery(
        gallery,
        destDir,
        (progress) => onProgress?.({ completedGalleries, totalGalleries, galleryName: gallery.name, galleryProgress: progress }),
        signal,
        concurrency
      );
      totalSuccess += result.success;
      completedGalleries++;
      Logger.info(`Gallery done: ${gallery.name} — ${result.success}/${result.total} images`);
    }
    return { successImages: totalSuccess, totalGalleries };
  }
}

module.exports = ImageDownloader;
