import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repoRoot, loadConfig, requireRemote, inventory, inspectMod, verifyObject, verifyAll,
  cacheControl, wranglerPutArgs, runWrangler, atomicJson, parseArgs, assertFlags, isMain } from './asset-tools.mjs';

export async function uploadAssets(root, config, entries, {
  dryRun = false, force = false, run = runWrangler, verify = verifyObject, log = console.log
} = {}) {
  requireRemote(config, true);
  const stateFile = resolve(root, '.asset-state/uploads.json');
  let state = {};
  if (!dryRun) {
    try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read upload receipt: ${error.message}`); }
  }
  const destination = JSON.stringify([config.r2.account_id, config.r2.bucket, config.r2.jurisdiction, config.base_url]);
  state[destination] ??= {};
  let uploaded = 0;
  let skipped = 0;
  let checkpoint = Promise.resolve();
  async function processEntry(entry, index) {
    log(`[${index + 1}/${entries.length}] ${dryRun ? 'Would upload' : 'Checking'} ${entry.key} -> ${config.r2.bucket}/${entry.key} (${entry.size} bytes)`);
    if (dryRun) return;
    const prior = state[destination][entry.key];
    if (!force && prior?.sha256 === entry.sha256 && prior?.cache_seconds === config.cache_seconds) {
      try {
        await verify(entry, { bustCache: true, cache: cacheControl(config) });
        log('  Unchanged and verified; skipped.');
        skipped++;
        return;
      } catch (error) { log(`  Re-uploading: ${error.message}`); }
    }
    await run(root, wranglerPutArgs(config, entry), config);
    await verify(entry, { bustCache: true, cache: cacheControl(config) });
    state[destination][entry.key] = { sha256: entry.sha256, cache_seconds: config.cache_seconds,
      verified_at: new Date().toISOString() };
    // Serialize receipt writes so concurrent completions cannot overwrite a newer snapshot.
    checkpoint = checkpoint.then(() => atomicJson(stateFile, state));
    await checkpoint;
    uploaded++;
    log(`  Uploaded and verified: ${entry.url}`);
  }
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(config.upload_concurrency ?? 3, entries.length) }, async () => {
    while (!failure && next < entries.length) {
      const index = next++;
      try { await processEntry(entries[index], index); }
      catch (error) { failure ??= error; }
    }
  }));
  // In-flight work finishes and receipts are saved before reporting a failure.
  if (failure) throw failure;
  log(dryRun ? `Preview only: ${entries.length} files, ${entries.reduce((n, entry) => n + entry.size, 0)} bytes; ${cacheControl(config)}.`
    : `Finished: ${uploaded} uploaded, ${skipped} unchanged. No objects deleted.`);
  return { uploaded, skipped };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') {
    console.log('Usage: npm run assets -- check | find NAME | upload [ASSET_PATH] [--dry-run] [--force] | verify [ASSET_PATH]\nOptional: --config relative/config.json');
    return;
  }
  const { flags, positional } = parseArgs(args);
  assertFlags(flags, command === 'upload' ? ['--config', '--dry-run', '--force'] : ['--config']);
  if (!['check', 'find', 'upload', 'verify'].includes(command) || positional.length > 1 ||
      (command === 'find' && positional.length !== 1) || (command === 'check' && positional.length)) {
    throw new Error('Use check, find NAME, upload [ASSET_PATH], or verify [ASSET_PATH]. See npm run assets -- --help.');
  }
  const config = await loadConfig(repoRoot, flags['--config']);
  const entries = await inventory(repoRoot, config);
  if (command === 'find') {
    const matches = entries.filter(entry => entry.key.toLowerCase().includes(positional[0].toLowerCase()));
    for (const entry of matches) console.log(`${entry.key}\n  R2 key: ${entry.key}\n  URL: ${entry.url ?? '(set base_url to see the URL)'}`);
    if (!matches.length) throw new Error(`No assets match ${positional[0]}. Try part of the filename.`);
    return;
  }
  const mod = await inspectMod(repoRoot, entries);
  if (command === 'check') {
    console.log(`Checked ${entries.length} assets (${entries.reduce((n, entry) => n + entry.size, 0)} bytes) and ${mod.references.size} referenced paths. All references match exact filenames.`);
    return;
  }
  requireRemote(config, command === 'upload');
  const selected = positional.length ? entries.filter(entry => entry.key === positional[0]) : entries;
  if (!selected.length) throw new Error(`Asset not found with this exact path: ${positional[0]}. Use find to locate it.`);
  if (command === 'upload') await uploadAssets(repoRoot, config, selected, { dryRun: flags['--dry-run'], force: flags['--force'] });
  else {
    await verifyAll(selected);
    console.log(`Verified ${selected.length} public objects against local files.`);
  }
}

if (isMain(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
