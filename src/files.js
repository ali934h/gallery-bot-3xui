/**
 * Listing, metadata, and deletion for archived ZIP files.
 *
 * Each ZIP `<name>.zip` may have a sidecar `<name>.json` storing the source
 * gallery URLs the user originally submitted. Sidecars and the served alias
 * are separate concerns: nginx denies dotfiles so the JSON is invisible to
 * end users.
 */

const fsp = require("fs").promises;
const path = require("path");
const config = require("./config");
const logger = require("./logger");

function metaPathFor(zipPath) {
  return zipPath.replace(/\.zip$/, ".json");
}

async function listFiles() {
  let entries;
  try {
    entries = await fsp.readdir(config.downloadsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const zips = entries.filter((e) => e.isFile() && e.name.endsWith(".zip"));
  const files = await Promise.all(
    zips.map(async (e) => {
      const filePath = path.join(config.downloadsDir, e.name);
      try {
        const stats = await fsp.stat(filePath);
        return { name: e.name, size: stats.size, date: stats.mtime };
      } catch (_) {
        return null;
      }
    })
  );
  return files
    .filter(Boolean)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

async function readMeta(fileName) {
  const metaPath = metaPathFor(path.join(config.downloadsDir, fileName));
  try {
    const raw = await fsp.readFile(metaPath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function saveMeta(zipName, urls) {
  const metaPath = metaPathFor(path.join(config.downloadsDir, zipName));
  try {
    await fsp.writeFile(metaPath, JSON.stringify({ urls }, null, 2), "utf8");
  } catch (err) {
    logger.warn(`Failed to save metadata for ${zipName}`, {
      error: err.message,
    });
  }
}

async function deleteMeta(fileName) {
  const metaPath = metaPathFor(path.join(config.downloadsDir, fileName));
  try {
    await fsp.unlink(metaPath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Failed to delete metadata: ${metaPath}`, {
        error: err.message,
      });
    }
  }
}

async function deleteZip(fileName) {
  const filePath = path.join(config.downloadsDir, fileName);
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await deleteMeta(fileName);
}

async function totalSize() {
  const files = await listFiles();
  return files.reduce((sum, f) => sum + f.size, 0);
}

module.exports = { listFiles, readMeta, saveMeta, deleteMeta, deleteZip, totalSize };
