/**
 * Strategy Engine
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/logger');

class StrategyEngine {
  constructor() {
    this.strategies = {};
    this.loaded = false;
  }

  async loadStrategies() {
    try {
      const configPath = path.join(__dirname, '../config/siteStrategies.json');
      const data = await fs.readFile(configPath, 'utf8');
      this.strategies = JSON.parse(data);
      delete this.strategies._comment;
      delete this.strategies._structure;
      this.loaded = true;
      Logger.info(`Loaded ${Object.keys(this.strategies).length} site strategies`);
    } catch (error) {
      Logger.error('Failed to load site strategies', { error: error.message });
      throw new Error('Could not load site strategies configuration');
    }
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  getStrategy(url) {
    if (!this.loaded) throw new Error('Strategies not loaded.');
    const domain = this.extractDomain(url);
    const strategy = this.strategies[domain];
    if (!strategy) { Logger.warn(`No strategy found for domain: ${domain}`); return null; }
    return strategy;
  }

  getAllStrategies() {
    if (!this.loaded) throw new Error('Strategies not loaded.');
    return this.strategies;
  }

  getSupportedDomains() {
    if (!this.loaded) throw new Error('Strategies not loaded.');
    return Object.keys(this.strategies);
  }

  isSupported(url) {
    try {
      const domain = this.extractDomain(url);
      return domain in this.strategies;
    } catch (error) {
      return false;
    }
  }

  async findWorkingStrategy(url, JsdomScraper, minImages = 5) {
    if (!this.loaded) throw new Error('Strategies not loaded.');
    const domain = this.extractDomain(url);
    Logger.info(`Testing strategies for unsupported domain: ${domain}`);
    const strategyEntries = Object.entries(this.strategies);
    for (const [, strategy] of strategyEntries) {
      try {
        Logger.debug(`Testing ${strategy.name} strategy on ${domain}...`);
        const images = await JsdomScraper.extractImages(url, strategy);
        if (images && images.length >= minImages) {
          Logger.info(`Strategy '${strategy.name}' found ${images.length} images for ${domain}`);
          return { strategy, images };
        }
      } catch (error) {
        Logger.debug(`Strategy '${strategy.name}' failed: ${error.message}`);
      }
    }
    Logger.warn(`No working strategy found for ${domain}`);
    return null;
  }
}

module.exports = new StrategyEngine();
