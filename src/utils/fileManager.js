/**
 * File Manager Utility
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

class FileManager {
  static async ensureDir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      Logger.error(`Failed to create directory: ${dirPath}`, { error: error.message });
      throw error;
    }
  }

  static async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') Logger.error(`Failed to delete file: ${filePath}`, { error: error.message });
    }
  }

  static async deleteDir(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') Logger.error(`Failed to delete directory: ${dirPath}`, { error: error.message });
    }
  }

  static async createTempDir(prefix = 'temp') {
    const dirName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const dirPath = path.join(process.cwd(), 'temp', dirName);
    await this.ensureDir(dirPath);
    Logger.info(`Temporary directory created: ${dirName}`);
    return dirPath;
  }

  static async cleanupOldTempDirs() {
    const tempDir = path.join(process.cwd(), 'temp');
    try {
      await this.ensureDir(tempDir);
      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(tempDir, entry.name);
          const stats = await fs.stat(dirPath);
          if (now - stats.mtimeMs > oneHour) {
            await this.deleteDir(dirPath);
            Logger.info(`Cleaned up old temp directory: ${entry.name}`);
          }
        }
      }
    } catch (error) {
      Logger.error('Failed to cleanup old temp directories', { error: error.message });
    }
  }

  static async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = FileManager;
