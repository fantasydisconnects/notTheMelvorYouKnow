import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, lstat, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, sep, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon'
};
const junk = new Set(['.DS_Store', 'Thumbs.db', 'Desktop.ini']);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const cacheControl = config => `public, max-age=${config.cache_seconds}`;

export function safePath(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') ||
      name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Expected a relative path with forward slashes: ${name}`);
  }
  const file = resolve(root, name);
  if (!file.startsWith(`${resolve(root)}${sep}`)) throw new Error(`Path escapes the repository: ${name}`);
  return file;
}

export async function filesIn(root, folder) {
  const result = [];
  async function walk(name) {
    const file = safePath(root, name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Use a real file or folder, not a symlink: ${name}`);
    if (stat.isDirectory()) {
      const entries = await readdir(file);
      for (const entry of entries.sort()) {
        if (!junk.has(entry) && !entry.startsWith('.')) await walk(`${name}/${entry}`);
      }
    } else if (stat.isFile()) result.push(name);
    else throw new Error(`Unsupported file type: ${name}`);
  }
  await walk(folder);
  return result;
}

export async function readRegularFile(root, name) {
  const file = safePath(root, name);
  // Check every component, including parent folders, to prevent symlink traversal.
  let current = resolve(root);
  for (const component of name.split('/')) {
    current = resolve(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink in path: ${name}`);
  }
  if (!(await lstat(file)).isFile()) throw new Error(`Expected a file: ${name}`);
  return readFile(file);
}

export async function readJson(root, name) {
  try { return JSON.parse(await readRegularFile(root, name)); }
  catch (error) { throw new Error(`Cannot read ${name}: ${error.message}`, { cause: error }); }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function knownKeys(value, allowed, label) {
  if (!object(value)) throw new Error(`${label} must be a JSON object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} setting: ${key}`);
  }
}

export async function loadConfig(root = repoRoot, overrideFile) {
  const defaults = await readJson(root, 'asset-hosting.json');
  let local = {};
  const filename = overrideFile || 'asset-hosting.local.json';
  try { local = await readJson(root, filename); }
  catch (error) { if (overrideFile || error.cause?.code !== 'ENOENT') throw error; }
  for (const value of [defaults, local]) {
    knownKeys(value, ['base_url', 'cache_seconds', 'upload_concurrency', 'r2'], 'asset configuration');
    if (value.r2 !== undefined) knownKeys(value.r2, ['account_id', 'bucket', 'jurisdiction'], 'R2');
  }
  const config = { ...defaults, ...local, r2: { ...defaults.r2, ...local.r2 } };
  config.upload_concurrency ??= 3;
  if (!Number.isInteger(config.upload_concurrency) || config.upload_concurrency < 1 || config.upload_concurrency > 4) {
    throw new Error('upload_concurrency must be a whole number between 1 and 4.');
  }
  if (typeof config.base_url !== 'string') throw new Error('base_url must be a string.');
  if (config.base_url) {
    let url;
    try { url = new URL(config.base_url); }
    catch { throw new Error('base_url must be a public HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('base_url must use HTTPS, without credentials, query parameters, or a fragment.');
    }
    config.base_url = config.base_url.replace(/\/+$/, '');
  }
  if (!Number.isSafeInteger(config.cache_seconds) || config.cache_seconds < 0 || config.cache_seconds > 31536000) {
    throw new Error('cache_seconds must be a whole number between 0 and 31536000.');
  }
  if (!['default', 'eu', 'fedramp'].includes(config.r2.jurisdiction)) throw new Error('Invalid R2 jurisdiction.');
  if (typeof config.r2.account_id !== 'string' || typeof config.r2.bucket !== 'string') {
    throw new Error('R2 account_id and bucket must be strings.');
  }
  return config;
}

export function requireRemote(config, upload = false) {
  if (!config.base_url) throw new Error('Set base_url in asset-hosting.local.json first. Bundled builds need no R2 settings.');
  if (upload && (!/^[a-f0-9]{32}$/i.test(config.r2.account_id) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.r2.bucket))) {
    throw new Error('Set your R2 account_id and bucket in asset-hosting.local.json before uploading.');
  }
}

export function assetUrl(config, key) {
  return config.base_url ? `${config.base_url}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}

export async function inventory(root = repoRoot, config = { base_url: '' }) {
  const entries = [];
  const names = new Map();
  for (const key of await filesIn(root, 'assets')) {
    const lower = key.toLowerCase();
    if (names.has(lower)) throw new Error(`Asset filenames differ only by case: ${names.get(lower)} and ${key}`);
    names.set(lower, key);
    const contentType = types[extname(key).toLowerCase()];
    if (!contentType) throw new Error(`Unsupported asset format: ${key}`);
    const bytes = await readRegularFile(root, key);
    entries.push({ key, file: safePath(root, key), size: bytes.length, sha256: digest(bytes), contentType,
      url: assetUrl(config, key) });
  }
  return entries;
}

export function assetReferences(value) {
  const refs = new Set();
  function visit(entry) {
    if (typeof entry === 'string' && entry.startsWith('assets/')) refs.add(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (object(entry)) Object.values(entry).forEach(visit);
  }
  visit(value);
  return refs;
}

export function rewriteAssets(value, urls) {
  if (typeof value === 'string') return urls.get(value) ?? value;
  if (Array.isArray(value)) return value.map(entry => rewriteAssets(entry, urls));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteAssets(entry, urls)]));
  return value;
}

export async function inspectMod(root, entries) {
  const manifest = await readJson(root, 'manifest.json');
  if (!Array.isArray(manifest.load) || typeof manifest.setup !== 'string' || typeof manifest.icon !== 'string') {
    throw new Error('Expected manifest.json to declare load, setup, and icon.');
  }
  const json = new Map();
  const references = assetReferences(manifest);
  for (const name of manifest.load) {
    safePath(root, name);
    if (extname(name) !== '.json') throw new Error(`Unsupported manifest load entry: ${name}`);
    const data = await readJson(root, name);
    json.set(name, data);
    for (const ref of assetReferences(data)) references.add(ref);
  }
  // Keep JavaScript assets local: rewriting code would change runtime semantics.
  const modules = (await filesIn(root, 'src')).filter(name => ['.mjs', '.js'].includes(extname(name)));
  if (!modules.includes(manifest.setup)) throw new Error('The manifest setup module is missing from src/.');
  const runtimeAssets = new Set(assetReferences(manifest));
  for (const name of modules) {
    const source = (await readRegularFile(root, name)).toString('utf8');
    for (const match of source.matchAll(/["'`]((?:assets\/)[^"'`\r\n]+)["'`]/g)) {
      if (match[1].includes('${')) throw new Error(`Dynamic asset path in ${name}; use an explicit asset path.`);
      runtimeAssets.add(match[1]);
      references.add(match[1]);
    }
  }
  const exact = new Set(entries.map(entry => entry.key));
  const lower = new Map(entries.map(entry => [entry.key.toLowerCase(), entry.key]));
  const errors = [...references].filter(ref => !exact.has(ref)).map(ref =>
    `${ref}${lower.has(ref.toLowerCase()) ? ` (actual case: ${lower.get(ref.toLowerCase())})` : ' (file missing)'}`);
  if (errors.length) throw new Error(`Fix these asset references before building or uploading:\n${errors.join('\n')}`);
  return { manifest, json, modules, references, runtimeAssets };
}

export async function verifyObject(entry, { fetchObject = fetch, bustCache = false, cache } = {}) {
  const url = new URL(entry.url);
  if (bustCache) url.searchParams.set('sae-verify', randomUUID());
  const response = await fetchObject(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${entry.url}`);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== entry.contentType) throw new Error(`Wrong Content-Type for ${entry.key}: ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) {
    throw new Error(`Hosted bytes differ for ${entry.key}. Upload the current file; if already uploaded, wait for the cache or purge it.`);
  }
  if (cache !== undefined && response.headers.get('cache-control') !== cache) {
    throw new Error(`Hosted Cache-Control differs for ${entry.key}; re-upload it or check cache rules.`);
  }
}

export async function verifyAll(entries, options = {}) {
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (!failure && next < entries.length) {
      try { await verifyObject(entries[next++], options); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}

export function wranglerPutArgs(config, entry) {
  return ['r2', 'object', 'put', `${config.r2.bucket}/${entry.key}`, '--file', entry.file,
    '--remote', ...(config.r2.jurisdiction === 'default' ? [] : ['--jurisdiction', config.r2.jurisdiction]),
    '--content-type', entry.contentType,
    '--cache-control', cacheControl(config)];
}

export async function runWrangler(root, args, config) {
  const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  try { await lstat(cli); }
  catch { throw new Error('Wrangler is not installed. Run npm ci, then npm run login.'); }
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.r2.account_id }
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Wrangler failed (${signal ?? code}).`)));
  });
}

export async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

export function parseArgs(args, valueFlags = ['--config']) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (Object.hasOwn(flags, arg)) throw new Error(`Repeated option: ${arg}`);
      if (valueFlags.includes(arg)) {
        if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Provide a value after ${arg}.`);
        flags[arg] = args[++index];
      } else flags[arg] = true;
    } else positional.push(arg);
  }
  return { flags, positional };
}

export function assertFlags(flags, allowed) {
  for (const key of Object.keys(flags)) if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}
