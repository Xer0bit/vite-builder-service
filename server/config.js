const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const BUILDS_DIR = process.env.BUILDS_DIR || path.join(DATA_DIR, 'builds');
const CACHE_DIR = process.env.CACHE_DIR || path.join(DATA_DIR, 'cache');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db.sqlite');
const ADMIN_KEY = process.env.ADMIN_KEY || null;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const PORT = parseInt(process.env.PORT || '3000', 10);
const CACHE_MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || '5', 10);
const CACHE_MAX_BYTES = parseInt(process.env.CACHE_MAX_BYTES || (2 * 1024 * 1024 * 1024), 10);
const BUILD_TIMEOUT_MS = parseInt(process.env.BUILD_TIMEOUT_MS || '120000', 10);
const INSTALL_TIMEOUT_MS = parseInt(process.env.INSTALL_TIMEOUT_MS || '120000', 10);

module.exports = {
  DATA_DIR,
  BUILDS_DIR,
  CACHE_DIR,
  DB_PATH,
  ADMIN_KEY,
  REDIS_URL,
  PORT,
  CACHE_MAX_ENTRIES,
  CACHE_MAX_BYTES,
  BUILD_TIMEOUT_MS,
  INSTALL_TIMEOUT_MS
};
