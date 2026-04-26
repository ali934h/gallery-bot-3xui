/**
 * ZIP archive creation.
 *
 * Writes to a `.tmp` file in `outputDir` and atomically renames on success so
 * an in-progress zip never sits in the served directory. Refuses to overwrite
 * an existing archive — the caller is expected to pass a unique name.
 */

const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const archiver = require("archiver");
const logger = require("../logger");

async function createZip(sourceDir, archiveName, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  const finalPath = path.join(outputDir, `${archiveName}.zip`);
  const tmpPath = `${finalPath}.tmp`;

  try {
    await fsp.access(finalPath);
    throw new Error(`Archive already exists: ${path.basename(finalPath)}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(tmpPath);
      const archive = archiver("zip", { zlib: { level: 6 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }

  await fsp.rename(tmpPath, finalPath);
  const stats = await fsp.stat(finalPath);
  logger.info(`ZIP created: ${path.basename(finalPath)} (${stats.size} bytes)`);
  return finalPath;
}

module.exports = { createZip };
