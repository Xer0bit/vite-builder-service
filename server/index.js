const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');
const archiver = require('archiver');
const Queue = require('bull');
const IORedis = require('ioredis');
const Database = require('better-sqlite3');
const tmp = require('tmp');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
// Load local .env if present (local dev)
try { require('dotenv').config(); } catch (e) {}
const app = express();
app.use(bodyParser.json({ limit: '200mb' }));

// Data and cache directories (persistent in container / project) - overridable by envs
const DATA_DIR = config.DATA_DIR || path.join(process.cwd(), 'data');
const BUILDS_DIR = config.BUILDS_DIR || path.join(DATA_DIR, 'builds');
const CACHE_DIR = config.CACHE_DIR || path.join(DATA_DIR, 'cache');
const BUILDS_META_PATH = path.join(DATA_DIR, 'builds.json');
const CACHE_META_PATH = path.join(DATA_DIR, 'cache.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BUILDS_DIR)) fs.mkdirSync(BUILDS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Wire worker in same process (for simplicity) — load worker and attach events
try { require('./worker'); } catch (e) { console.warn('Worker not started in separate file:', e.message); }

// Create admin key on first run if not configured
const adminFile = path.join(DATA_DIR, 'admin.json');
if (!process.env.ADMIN_KEY && !fs.existsSync(adminFile)) {
  const generated = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(adminFile, JSON.stringify({ key: generated, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log('Generated ADMIN_KEY:', generated);
}

// Load builds metadata and cache metadata
let buildsMeta = [];
let cacheMeta = [];
try {
  if (fs.existsSync(BUILDS_META_PATH)) {
    buildsMeta = JSON.parse(fs.readFileSync(BUILDS_META_PATH, 'utf8')) || [];
  }
} catch (e) { buildsMeta = []; }
try {
  if (fs.existsSync(CACHE_META_PATH)) {
    cacheMeta = JSON.parse(fs.readFileSync(CACHE_META_PATH, 'utf8')) || [];
  }
} catch (e) { cacheMeta = []; }

// Initialize a SQLite database for API keys
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.prepare(`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    meta TEXT,
    createdAt TEXT,
    revoked INTEGER DEFAULT 0
  )`).run();
  // Migrate from existing data/api_keys.json if present and DB empty
  const countRow = db.prepare('SELECT COUNT(1) AS c FROM api_keys').get();
  if (countRow && countRow.c === 0) {
    const apiFile = path.join(DATA_DIR, 'api_keys.json');
    if (fs.existsSync(apiFile)) {
      try {
        const keys = JSON.parse(fs.readFileSync(apiFile, 'utf8')) || [];
        const insert = db.prepare('INSERT OR IGNORE INTO api_keys (id, key, meta, createdAt, revoked) VALUES (?, ?, ?, ?, ?)');
        for (const k of keys) {
          const metaStr = k.meta ? JSON.stringify(k.meta) : JSON.stringify({ createdAt: k.meta && k.meta.createdAt ? k.meta.createdAt : new Date().toISOString() });
          insert.run(k.id || crypto.randomBytes(8).toString('hex'), k.key, metaStr, (k.meta && k.meta.createdAt) || new Date().toISOString(), 0);
        }
      } catch (e) { /* ignore migration errors */ }
    }
  }
} catch (e) {
  console.warn('Failed to init DB', e.message);
}

function saveBuildsMeta() {
  fs.writeFileSync(BUILDS_META_PATH, JSON.stringify(buildsMeta, null, 2), 'utf8');
}
function saveCacheMeta() {
  fs.writeFileSync(CACHE_META_PATH, JSON.stringify(cacheMeta, null, 2), 'utf8');
}

// Cache helpers
function depsHashForProject(root) {
  const lockPath = path.join(root, 'package-lock.json');
  let content;
  if (fs.existsSync(lockPath)) {
    content = fs.readFileSync(lockPath);
  } else {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = pkg.dependencies || {};
      const dev = pkg.devDependencies || {};
      const obj = { deps: deps, dev: dev };
      content = Buffer.from(JSON.stringify(obj));
    } else {
      content = Buffer.from('');
    }
  }
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash;
}

function cacheEntryForHash(hash) {
  return cacheMeta.find(c => c.hash === hash);
}

function computeDirSize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return total;
  const stack = [dirPath];
  while (stack.length) {
    const cur = stack.pop();
    const infos = fs.readdirSync(cur, { withFileTypes: true });
    for (const info of infos) {
      const p = path.join(cur, info.name);
      if (info.isDirectory()) stack.push(p);
      else if (info.isFile()) total += fs.statSync(p).size;
    }
  }
  return total;
}

function addCacheEntry(hash, nodeModulesPath) {
  const dest = path.join(CACHE_DIR, hash);
  if (fs.existsSync(dest)) return;
  // copy node_modules
  fs.cpSync(nodeModulesPath, dest, { recursive: true });
  const size = computeDirSize(dest);
  const entry = { hash, path: dest, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString(), size };
  cacheMeta.push(entry);
  saveCacheMeta();
  enforceCacheLimits();
}

function markCacheUsed(hash) {
  const e = cacheEntryForHash(hash);
  if (e) { e.lastUsed = new Date().toISOString(); saveCacheMeta(); }
}

function removeCacheEntry(hash) {
  const e = cacheEntryForHash(hash);
  if (e) {
    try { fs.rmSync(e.path, { recursive: true, force: true }); } catch (e) {}
    cacheMeta = cacheMeta.filter(c => c.hash !== hash);
    saveCacheMeta();
  }
}

// Simple policy: max 5 cache entries (LRU by lastUsed) and size limit 2GB
function enforceCacheLimits() {
  const cacheConfigFile = path.join(DATA_DIR, 'cache_config.json');
  let config = { maxEntries: 5, maxBytes: 2 * 1024 * 1024 * 1024 };
  if (fs.existsSync(cacheConfigFile)) {
    try { config = JSON.parse(fs.readFileSync(cacheConfigFile, 'utf8')); } catch (e) {}
  }
  const MAX_ENTRIES = config.maxEntries;
  const MAX_TOTAL_BYTES = config.maxBytes;
  // remove by count
  while (cacheMeta.length > MAX_ENTRIES) {
    // find LRU
    cacheMeta.sort((a,b) => new Date(a.lastUsed) - new Date(b.lastUsed));
    const rm = cacheMeta.shift();
    try { fs.rmSync(rm.path, { recursive: true, force: true }); } catch (e) {}
  }
  // remove by size
  let total = cacheMeta.reduce((s,e) => s + (e.size||0), 0);
  if (total > MAX_TOTAL_BYTES) {
    cacheMeta.sort((a,b) => new Date(a.lastUsed) - new Date(b.lastUsed));
    while (total > MAX_TOTAL_BYTES && cacheMeta.length) {
      const rm = cacheMeta.shift();
      try { fs.rmSync(rm.path, { recursive: true, force: true }); } catch (e) {}
      total = cacheMeta.reduce((s,e) => s + (e.size||0), 0);
    }
  }
  saveCacheMeta();
}


// Utility: write file tree from JSON files
function writeFilesToDir(baseDir, files) {
  for (const file of files) {
    // Expect { path: 'index.html', content: '...' }
    const p = path.join(baseDir, file.path);
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    // file: { path, content } or { path, contentBase64 }
    if (typeof file.content === 'string') {
      fs.writeFileSync(p, file.content, 'utf8');
    } else if (typeof file.contentBase64 === 'string') {
      const buf = Buffer.from(file.contentBase64, 'base64');
      fs.writeFileSync(p, buf);
    } else {
      // unsupported - write empty file
      fs.writeFileSync(p, '', 'utf8');
    }
  }
}
    // REDIS_URL will be defined below using env config
// Utility: run a shell command in given cwd
function runCommand(cmd, args, cwd, timeoutMs = 60_000, env = {}) {
  return new Promise((resolve, reject) => {
    const binPath = path.join(cwd || process.cwd(), 'node_modules', '.bin');
    const baseEnv = { ...process.env, ...(env || {}) };
    baseEnv.PATH = `${binPath}:${baseEnv.PATH || process.env.PATH}`;
    const child = spawn(cmd, args, { cwd, shell: false, stdio: 'pipe', env: baseEnv });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Command timed out'));
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const e = new Error('exit ' + code);
        e.code = code; e.stdout = stdout; e.stderr = stderr;
        reject(e);
      }
    });
  });
}

// POST /build - accepts JSON with top-level `files` array and optional `installDependencies` boolean
// Middleware to check API key for build endpoints
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (!key) return res.status(401).json({ error: 'Missing API key' });
  // validate key in sqlite db
  try {
    const row = db.prepare('SELECT id FROM api_keys WHERE key = ? AND revoked = 0').get(key);
    if (!row) return res.status(403).json({ error: 'Invalid API key' });
  } catch (e) { return res.status(500).json({ error: 'Error validating API key' }); }
  req.apiKey = key;
  next();
}

// Require x-api-key for build endpoint
app.post('/build', requireApiKey, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !Array.isArray(payload.files)) {
      return res.status(400).json({ error: 'Payload must include files array' });
    }

    // Temp directory to create project
    const tmpDir = tmp.dirSync({ prefix: 'vite-build-' });
    const projectRoot = tmpDir.name;
    console.log(`[${new Date().toISOString()}] Received build request -> ${projectRoot}`);

    // Write files
    try {
      writeFilesToDir(projectRoot, payload.files);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to write files', detail: e.message });
    }

    // Default to installing dependencies and building
    const installDep = payload.installDependencies !== false;
    const buildCommand = payload.buildCommand || 'npm run build';

    // If package.json file not provided, create a minimal Vite project
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.log('No package.json found - creating fallback package.json');
      const fallbackPkg = {
        name: 'fallback-vite-app',
        version: '1.0.0',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        },
        dependencies: {},
        devDependencies: { vite: '^5.0.0' }
      };
      fs.writeFileSync(pkgPath, JSON.stringify(fallbackPkg, null, 2), 'utf8');
    }

    // If no index.html, create minimal
    const indexHtmlPath = path.join(projectRoot, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      const indexHtml = `<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Vite App</title>\n  </head>\n  <body>\n    <div id="app">Hello Vite</div>\n    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>`;
      fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
    }

    // If src/main.js missing, add one
    const mainPath = path.join(projectRoot, 'src', 'main.js');
    if (!fs.existsSync(mainPath)) {
      fs.mkdirSync(path.dirname(mainPath), { recursive: true });
      fs.writeFileSync(mainPath, `import './style.css';\ndocument.getElementById('app').innerText = 'Built with Vite!';\n`, 'utf8');
    }

    // Compute deps hash for caching
    const depsHash = depsHashForProject(projectRoot);

    // Record build metadata
    const buildId = uuidv4();
    const buildMeta = {
      id: buildId,
      createdAt: new Date().toISOString(),
      status: 'queued',
      buildCommand,
      installDep,
      depsHash,
      logs: ''
    };
    buildsMeta.unshift(buildMeta);
    if (buildsMeta.length > 100) buildsMeta.pop();
    saveBuildsMeta();

    // Try to reuse cached node_modules
    const cacheEntry = cacheEntryForHash(depsHash);
    if (installDep && cacheEntry && fs.existsSync(cacheEntry.path)) {
      // restore to projectRoot/node_modules
      const nodeModulesDest = path.join(projectRoot, 'node_modules');
      try {
        fs.mkdirSync(nodeModulesDest, { recursive: true });
        fs.cpSync(cacheEntry.path, nodeModulesDest, { recursive: true });
        markCacheUsed(depsHash);
        buildMeta.logs += '[cache] Restored node_modules from cache\n';
      } catch (e) {
        buildMeta.logs += `[cache] Failed to restore cache: ${e.message}\n`;
      }
    }

    // Update status
    buildMeta.status = 'installing';
    saveBuildsMeta();

    // Instead of running build synchronously, enqueue a job and return build id
    const wait = payload.waitForCompletion === true;
    const job = await buildQueue.add({ project: { files: payload.files }, buildMeta }, { jobId: buildId });
    // respond with build id and artifact location
    const responseBody = { id: buildId, status: buildMeta.status, artifact: null };
    if (!wait) {
      res.status(202).json(responseBody);
    }
    // else await completion
    if (wait) {
      const completed = await job.finished();
      // Refresh buildMeta
      const refreshed = buildsMeta.find(b => b.id === buildId);
      if (refreshed && refreshed.artifact) {
        // stream artifact
        return res.download(path.join(BUILDS_DIR, `${buildId}.zip`));
      } else {
        return res.status(202).json({ id: buildId, status: refreshed ? refreshed.status : 'unknown' });
      }
    }
    return; // exit early for async queue

    // Cleanup is left to OS or manual; tmp will clean up on process exit.
  } catch (err) {
    console.error('Unexpected error', err);
    res.status(500).json({ error: 'Unexpected server error', detail: err.message });
  }
});

// Simple health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Simple version
app.get('/version', (req, res) => {
  res.json({ name: 'vite-json-builder', node: process.version });
});
// Admin endpoints
// Admin key middleware
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey || config.ADMIN_KEY;
  if (!key) return res.status(401).json({ error: 'Missing admin key' });
  // validate against stored adminKey (env or data file)
  const adminFile = path.join(DATA_DIR, 'admin.json');
  let adminDef = null;
  if (fs.existsSync(adminFile)) adminDef = JSON.parse(fs.readFileSync(adminFile, 'utf8')) || null;
  const configured = config.ADMIN_KEY || (adminDef && adminDef.key);
  if (!configured) return res.status(403).json({ error: 'Admin key not configured' });
  if (key !== configured) return res.status(403).json({ error: 'Invalid admin key' });
  next();
}

app.get('/admin/builds', requireAdminKey, (req, res) => {
  res.json(buildsMeta);
});
app.get('/admin/builds/:id', requireAdminKey, (req, res) => {
  const b = buildsMeta.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});
// SSE endpoint for per-build log streaming
app.get('/admin/builds/:id/stream', (req, res) => {
  const id = req.params.id;
  const key = req.headers['x-admin-key'] || req.query.adminKey || config.ADMIN_KEY;
  if (!key) return res.status(401).json({ error: 'Missing admin key' });
  const adminFile = path.join(DATA_DIR, 'admin.json');
  let adminDef = null; if (fs.existsSync(adminFile)) adminDef = JSON.parse(fs.readFileSync(adminFile, 'utf8')) || null;
  const configured = config.ADMIN_KEY || (adminDef && adminDef.key);
  if (!configured || key !== configured) return res.status(403).json({ error: 'Invalid admin key' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  if (!sseClients.has(id)) sseClients.set(id, []);
  sseClients.get(id).push(res);
  const build = buildsMeta.find(b => b.id === id);
  if (build && build.logs) res.write(`data: ${JSON.stringify({ logs: build.logs })}\n\n`);
  req.on('close', () => {
    const arr = sseClients.get(id) || [];
    sseClients.set(id, arr.filter(r => r !== res));
  });
});
app.get('/builds/:id.zip', requireApiKey, (req, res) => {
  const p = path.join(BUILDS_DIR, `${req.params.id}.zip`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });
  const zipBuffer = fs.readFileSync(p);
  const base64 = zipBuffer.toString('base64');
  fs.unlinkSync(p); // remove the file after returning
  res.json({ zip: base64 });
});

// User API to get build logs
app.get('/api/builds/:id/logs', requireApiKey, (req, res) => {
  const logPath = path.join(DATA_DIR, 'builds', `${req.params.id}.log`);
  if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Logs not found' });
  const logs = fs.readFileSync(logPath, 'utf8');
  res.json({ logs });
});
app.get('/admin/cache', requireAdminKey, (req, res) => {
  res.json({ cacheMeta, settings: { maxEntries: 5, maxBytes: 2 * 1024 * 1024 * 1024 } });
});
app.post('/admin/cache/clear', requireAdminKey, (req, res) => {
  // remove all cache directories and reset index
  for (const c of cacheMeta) {
    try { fs.rmSync(c.path, { recursive: true, force: true }); } catch (e) {}
  }
  cacheMeta = [];
  saveCacheMeta();
  res.json({ status: 'ok' });
});
// Admin endpoint to change cache settings
app.post('/admin/cache/settings', requireAdminKey, (req, res) => {
  const { maxEntries, maxBytes } = req.body || {};
  const cacheConfigFile = path.join(DATA_DIR, 'cache_config.json');
  const current = fs.existsSync(cacheConfigFile) ? JSON.parse(fs.readFileSync(cacheConfigFile, 'utf8')) : {};
  const newConfig = { maxEntries: maxEntries || current.maxEntries || 5, maxBytes: maxBytes || current.maxBytes || (2 * 1024 * 1024 * 1024) };
  fs.writeFileSync(cacheConfigFile, JSON.stringify(newConfig, null, 2), 'utf8');
  res.json({ status: 'ok', settings: newConfig });
});

app.get('/admin/metrics', requireAdminKey, async (req, res) => {
  const jobCounts = await buildQueue.getJobCounts();
  const totalBuilds = buildsMeta.length;
  const totalCacheBytes = cacheMeta.reduce((s, c) => s + (c.size || 0), 0);
  res.json({ jobCounts, totalBuilds, cacheEntries: cacheMeta.length, totalCacheBytes });
});
app.get('/admin/config', requireAdminKey, (req, res) => {
  try {
    const cfg = {
      DATA_DIR,
      BUILDS_DIR,
      CACHE_DIR,
      REDIS_URL,
      PORT: typeof config.PORT !== 'undefined' ? config.PORT : process.env.PORT || 3000,
      DB_PATH: config.DB_PATH || path.join(DATA_DIR, 'db.sqlite'),
      CACHE_MAX_ENTRIES: config.CACHE_MAX_ENTRIES,
      CACHE_MAX_BYTES: config.CACHE_MAX_BYTES,
      BUILD_TIMEOUT_MS: config.BUILD_TIMEOUT_MS,
      INSTALL_TIMEOUT_MS: config.INSTALL_TIMEOUT_MS,
      ADMIN_KEY_SET: !!config.ADMIN_KEY
    };
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: 'Failed to read config' }); }
});
app.post('/admin/cache/remove/:hash', requireAdminKey, (req, res) => {
  removeCacheEntry(req.params.hash);
  res.json({ status: 'ok' });
});

// Admin API keys management
app.get('/admin/api/keys', requireAdminKey, (req, res) => {
  try {
    const showRevoked = req.query.showRevoked === '1' || req.query.showRevoked === 'true';
    const rows = db.prepare(`SELECT id, key, meta, createdAt, revoked FROM api_keys ${showRevoked ? '' : 'WHERE revoked = 0'} ORDER BY createdAt DESC`).all();
    const keys = rows.map(r => ({ id: r.id, meta: r.meta ? JSON.parse(r.meta) : { createdAt: r.createdAt }, key: r.key, revoked: !!r.revoked }));
    res.json(keys.map(k => ({ id: k.id, meta: k.meta, revoked: k.revoked })));
  } catch (e) { res.status(500).json({ error: 'Failed to read API keys' }); }
});
app.post('/admin/api/keys', requireAdminKey, (req, res) => {
  try {
    const newId = uuidv4();
    const newKey = crypto.randomBytes(20).toString('hex');
    const meta = { createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO api_keys (id, key, meta, createdAt, revoked) VALUES (?, ?, ?, ?, 0)').run(newId, newKey, JSON.stringify(meta), meta.createdAt);
    res.json({ id: newId, key: newKey });
  } catch (e) { res.status(500).json({ error: 'Failed to create API key' }); }
});
app.delete('/admin/api/keys/:id', requireAdminKey, (req, res) => {
  try {
    const r = db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(req.params.id);
    res.json({ status: 'ok', changed: r.changes });
  } catch (e) { res.status(500).json({ error: 'Failed to revoke API key' }); }
});

app.get('/admin/api/keys/:id', requireAdminKey, (req, res) => {
  try {
    const row = db.prepare('SELECT id, key, meta, createdAt, revoked FROM api_keys WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const response = { id: row.id, key: row.key, meta: row.meta ? JSON.parse(row.meta) : {}, revoked: !!row.revoked, createdAt: row.createdAt };
    res.json(response);
  } catch (e) { res.status(500).json({ error: 'Failed to read API key' }); }
});

// Serve admin static UI
app.use('/admin', express.static(path.join(__dirname, 'admin')));
// Serve saved builds for direct download
app.use('/builds', express.static(BUILDS_DIR));
// ----- Redis queue setup
const REDIS_URL = config.REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisOptions = { lazyConnect: true };
const redisClient = new IORedis(REDIS_URL, redisOptions);
// Subscribe to build logs pub/sub
const subClient = new IORedis(REDIS_URL);
subClient.psubscribe('build:logs:*').then(() => console.log('Subscribed to build:logs'));
subClient.on('pmessage', (pattern, channel, message) => {
  const parts = channel.split(':');
  const buildId = parts[2];
  // Write to SSE clients if any
  sseSend(buildId, 'log', message);
  // Also attempt to update buildsMeta from disk to reflect changes
  try {
    const metaPath = path.join(DATA_DIR, 'builds.json');
    if (fs.existsSync(metaPath)) buildsMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || buildsMeta;
  } catch (e) { }
});
const buildQueue = new Queue('builds', { redis: REDIS_URL });

// SSE clients mapping buildId -> [res, ...]
const sseClients = new Map();
function sseSend(buildId, event, data) {
  const clients = sseClients.get(buildId);
  if (!clients) return;
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const pkg = JSON.stringify({ logs: payload });
  for (const res of clients) {
    res.write(`data: ${pkg}\n\n`);
  }
}

// Start HTTP server
const PORT = config.PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vite JSON build service listening on ${PORT}`);
});
