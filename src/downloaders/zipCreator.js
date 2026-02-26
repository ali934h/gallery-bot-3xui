/**
 * ZIP Creator
 * Creates ZIP archives from downloaded gallery directories
 */

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger');

class ZipCreator {
  static async createZip(sourceDir, archiveName, outputDir) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const zipPath = path.join(outputDir, `${archiveName}.zip`);
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => {
        Logger.info(`ZIP created: ${archiveName}.zip (${archive.pointer()} bytes)`);
        resolve(zipPath);
      });
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

module.exports = ZipCreator;
