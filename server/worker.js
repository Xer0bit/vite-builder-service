const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const archiver = require('archiver');
const tmp = require('tmp');
const crypto = require('crypto');
const Queue = require('bull');
const IORedis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const REDIS_URL = config.REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const DATA_DIR = config.DATA_DIR || path.join(process.cwd(), 'data');
const BUILDS_DIR = config.BUILDS_DIR || path.join(DATA_DIR, 'builds');
const CACHE_DIR = config.CACHE_DIR || path.join(DATA_DIR, 'cache');

function runCommand(cmd, args, cwd, timeoutMs=120000, env={}) {
  return new Promise((resolve,reject) => {
    const binPath = path.join(cwd || process.cwd(), 'node_modules', '.bin');
    const baseEnv = { ...process.env, ...(env || {}) };
    baseEnv.PATH = `${binPath}:${baseEnv.PATH || process.env.PATH}`;
    const opts = { cwd, shell: false, stdio: 'pipe', env: baseEnv };
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    const to = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out')) }, timeoutMs);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => {
      clearTimeout(to);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const e = new Error('exit '+code);
        e.stdout = stdout; e.stderr = stderr; e.code = code;
        reject(e);
      }
    });
  });
}

function depsHashForProject(root) {
  const lockPath = path.join(root, 'package-lock.json');
  let content;
  if (fs.existsSync(lockPath)) content = fs.readFileSync(lockPath);
  else {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      content = Buffer.from(JSON.stringify({deps: pkg.dependencies||{}, dev: pkg.devDependencies||{}}));
    } else content = Buffer.from('');
  }
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function processJob(job) {
  const bmeta = job.data.buildMeta;
  const project = job.data.project;
  bmeta.status = 'installing';
  await appendBuildLog(bmeta.id, '[status] installing\n');
  await publishLog(bmeta.id, '[status] installing');
  // write files to temp
  const tmpDir = tmp.dirSync({ prefix: 'worker-' });
  const root = tmpDir.name;
  for (const f of project.files) {
    const p = path.join(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (typeof f.content === 'string') fs.writeFileSync(p, f.content, 'utf8');
    else if (typeof f.contentBase64 === 'string') fs.writeFileSync(p, Buffer.from(f.contentBase64, 'base64'));
    else fs.writeFileSync(p, '', 'utf8');
  }
  // package manager detection
  let pkgManager = 'npm';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) pkgManager = 'pnpm';
  else if (fs.existsSync(path.join(root, 'yarn.lock'))) pkgManager = 'yarn';
  try {
    // try to restore from cache if present
    const hash = depsHashForProject(root);
    const cachePath = path.join(CACHE_DIR, hash);
    const nodeModulesDest = path.join(root, 'node_modules');
    if (fs.existsSync(cachePath)) {
      try {
        fs.mkdirSync(nodeModulesDest, { recursive: true });
        fs.cpSync(cachePath, nodeModulesDest, { recursive: true });
        await appendBuildLog(bmeta.id, '[cache] Restored node_modules from cache\n');
        await publishLog(bmeta.id, '[cache] Restored node_modules from cache');
      } catch (e) { await appendBuildLog(bmeta.id, `[cache] restore failed ${e.message}\n`); await publishLog(bmeta.id, `[cache] restore failed`); }
    }
    if (pkgManager === 'npm') {
      const lockPath = path.join(root, 'package-lock.json');
      let installOut;
      if (fs.existsSync(lockPath)) {
        installOut = await runCommand('npm', ['ci', '--include=dev'], root, config.INSTALL_TIMEOUT_MS, { NODE_ENV: 'development', npm_config_production: 'false' });
      } else {
        installOut = await runCommand('npm', ['install'], root, config.INSTALL_TIMEOUT_MS, { NODE_ENV: 'development', npm_config_production: 'false' });
      }
      await appendBuildLog(bmeta.id, `[install] npm stdout:\n${installOut.stdout}\n[install] npm stderr:\n${installOut.stderr}\n`);
      await publishLog(bmeta.id, '[install] npm install done');
    }
    if (pkgManager === 'yarn') {
      const yarnOut = await runCommand('yarn', ['install'], root, config.INSTALL_TIMEOUT_MS, { NODE_ENV: 'development' });
      await appendBuildLog(bmeta.id, `[install] yarn stdout:\n${yarnOut.stdout}\n[install] yarn stderr:\n${yarnOut.stderr}\n`);
      await publishLog(bmeta.id, '[install] yarn install done');
    }
    if (pkgManager === 'pnpm') {
      const pnpmOut = await runCommand('pnpm', ['install'], root, config.INSTALL_TIMEOUT_MS, { NODE_ENV: 'development' });
      await appendBuildLog(bmeta.id, `[install] pnpm stdout:\n${pnpmOut.stdout}\n[install] pnpm stderr:\n${pnpmOut.stderr}\n`);
      await publishLog(bmeta.id, '[install] pnpm install done');
    }
  } catch (e) {
    bmeta.status = 'failed';
    bmeta.logs = (bmeta.logs || '') + `[install] failed ${e.message}\n`;
    await appendBuildLog(bmeta.id, `[install] failed ${e.message}\n`);
    await updateBuildMeta(bmeta);
    await publishLog(bmeta.id, `[install] failed ${e.message}`);
    return Promise.reject(e);
  }
  bmeta.status = 'building';
  await appendBuildLog(bmeta.id, '[status] building\n');
  await publishLog(bmeta.id, '[status] building');
  try {
    const buildCommand = bmeta.buildCommand || 'npm run build';
    const [cmd, ...args] = buildCommand.split(' ');
    const out = await runCommand(cmd, args, root, config.BUILD_TIMEOUT_MS);
    bmeta.logs = (bmeta.logs || '') + `[build] stdout:\n${out.stdout}\n[build] stderr:\n${out.stderr}\n`;
    await appendBuildLog(bmeta.id, `[build] stdout:\n${out.stdout}\n[build] stderr:\n${out.stderr}\n`);
    await publishLog(bmeta.id, `[build] stdout line`);
  } catch (e) {
    bmeta.status = 'failed';
    bmeta.logs = (bmeta.logs || '') + `[build] failed ${e.stderr || e.message}\n`;
    await appendBuildLog(bmeta.id, `[build] failed ${e.stderr || e.message}\n`);
    await updateBuildMeta(bmeta);
    await publishLog(bmeta.id, `[build] failed ${e.stderr || e.message}`);
    return Promise.reject(e);
  }
  const distPath = path.join(root, 'dist');
  if (!fs.existsSync(distPath)) { bmeta.status = 'failed'; bmeta.logs += '[error] dist not found\n'; await appendBuildLog(bmeta.id, '[error] dist not found\n'); await updateBuildMeta(bmeta); await publishLog(bmeta.id, '[error] dist not found'); return Promise.reject(new Error('dist not found')); }
  const zipPath = path.join(BUILDS_DIR, `${bmeta.id}.zip`);
  const out = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(distPath, false);
  archive.pipe(out);
  await new Promise((resolve,reject)=>{ out.on('close', resolve); out.on('error', reject); archive.finalize(); });
  bmeta.status = 'completed';
  bmeta.artifact = `/builds/${bmeta.id}.zip`;
  bmeta.completedAt = new Date().toISOString();
  // Save node_modules to cache if not present
  try {
    const hash = depsHashForProject(root);
    const cachePath = path.join(CACHE_DIR, hash);
    if (!fs.existsSync(cachePath)) {
      const nmPath = path.join(root, 'node_modules');
      await appendBuildLog(bmeta.id, `[cache] nmPath check: ${nmPath} exists=${fs.existsSync(nmPath)}\n`);
      if (fs.existsSync(nmPath)) {
        fs.mkdirSync(cachePath, { recursive: true });
        fs.cpSync(nmPath, cachePath, { recursive: true });
        await appendBuildLog(bmeta.id, `[cache] node_modules cached: ${hash}\n`);
        await publishLog(bmeta.id, `[cache] cached ${hash}`);
      }
    }
  } catch (e) { /* ignore caching errors */ }
  await appendBuildLog(bmeta.id, `[complete] build completed at ${bmeta.completedAt}\n`);
  await updateBuildMeta(bmeta);
  await publishLog(bmeta.id, `[complete] build completed`);
  return bmeta;
}

// Setup queue and process
const queue = new Queue('builds', REDIS_URL);
queue.process(async (job) => {
  return await processJob(job);
});

queue.on('completed', (job, result) => {
  // could signal back via a simple file update; the web server watches data/builds.json
});

console.log('Worker started for builds queue');

// Helper functions: append to build log, persist builds.json, publish via redis
const publisher = new IORedis(REDIS_URL);
async function publishLog(buildId, text) {
  try { await publisher.publish(`build:logs:${buildId}`, text); } catch (e) { console.error('publish fail', e.message); }
}
async function appendBuildLog(buildId, text) {
  try { fs.appendFileSync(path.join(DATA_DIR, 'builds', `${buildId}.log`), `${new Date().toISOString()} ${text}`); } catch (e) { console.error('append log fail', e.message); }
}
async function updateBuildMeta(meta) {
  const metaFile = path.join(DATA_DIR, 'builds.json');
  let data = [];
  if (fs.existsSync(metaFile)) data = JSON.parse(fs.readFileSync(metaFile, 'utf8')) || [];
  const idx = data.findIndex(x => x.id === meta.id);
  if (idx >= 0) data[idx] = meta; else data.unshift(meta);
  fs.writeFileSync(metaFile, JSON.stringify(data, null, 2));
}
