/**
 * Filesystem helpers: directories, temp dirs, size formatting.
 */

const fs = require("fs").promises;
const path = require("path");
const logger = require("./logger");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to delete file: ${filePath}`, { error: err.message });
    }
  }
}

async function deleteDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to delete directory: ${dirPath}`, {
        error: err.message,
      });
    }
  }
}

async function createTempDir(rootTempDir, prefix = "temp") {
  const dirName = `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 10)}`;
  const dirPath = path.join(rootTempDir, dirName);
  await ensureDir(dirPath);
  logger.debug(`Temporary directory created: ${dirName}`);
  return dirPath;
}

async function cleanupOldTempDirs(rootTempDir, maxAgeMs) {
  try {
    await ensureDir(rootTempDir);
    const entries = await fs.readdir(rootTempDir, { withFileTypes: true });
    const now = Date.now();
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(rootTempDir, entry.name);
      try {
        const stats = await fs.stat(dirPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await deleteDir(dirPath);
          removed++;
        }
      } catch (_) {
        // ignore single-directory failures
      }
    }
    if (removed > 0) logger.info(`Temp cleanup removed ${removed} dir(s)`);
  } catch (err) {
    logger.warn("Failed to cleanup old temp directories", {
      error: err.message,
    });
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k))
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

module.exports = {
  ensureDir,
  deleteFile,
  deleteDir,
  createTempDir,
  cleanupOldTempDirs,
  formatBytes,
};
