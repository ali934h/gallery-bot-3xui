/**
 * Strategy engine — loads site-specific scraping rules from JSON, looks up by
 * domain, and provides a fallback search across all known strategies.
 */

const fs = require("fs").promises;
const path = require("path");
const config = require("../config");
const logger = require("../logger");

class StrategyEngine {
  constructor() {
    this.strategies = {};
    this.loaded = false;
  }

  async load() {
    const configPath = path.join(__dirname, "../config/siteStrategies.json");
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    delete parsed._comment;
    delete parsed._structure;
    this.strategies = parsed;
    this.loaded = true;
    logger.info(`Loaded ${Object.keys(this.strategies).length} site strategies`);
  }

  ensureLoaded() {
    if (!this.loaded) throw new Error("Strategies not loaded");
  }

  getDomain(url) {
    return new URL(url).hostname.replace(/^www\./, "");
  }

  get(url) {
    this.ensureLoaded();
    try {
      return this.strategies[this.getDomain(url)] || null;
    } catch {
      return null;
    }
  }

  supportedDomains() {
    this.ensureLoaded();
    return Object.keys(this.strategies);
  }

  /**
   * Try strategies until one returns >= minImages. Capped at config.fallbackStrategyLimit
   * so we don't spend forever testing every strategy on a hostile site.
   */
  async findWorking(url, scraper, minImages = config.fallbackMinImages) {
    this.ensureLoaded();
    const entries = Object.entries(this.strategies).slice(
      0,
      config.fallbackStrategyLimit
    );
    for (const [, strategy] of entries) {
      try {
        const images = await scraper.extractImages(url, strategy);
        if (images && images.length >= minImages) {
          return { strategy, images };
        }
      } catch (err) {
        logger.debug(`Fallback strategy '${strategy.name}' failed: ${err.message}`);
      }
    }
    return null;
  }
}

module.exports = new StrategyEngine();
