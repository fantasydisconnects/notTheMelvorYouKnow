import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import { repoRoot, loadConfig, requireRemote, inventory, inspectMod, rewriteAssets, readRegularFile,
  verifyAll, atomicJson, parseArgs, assertFlags, isMain } from './asset-tools.mjs';

export async function buildZip(root, config, { mode, name = `SAE-${mode}`, verify = verifyAll, log = console.log }) {
  if (!['bundled', 'remote'].includes(mode)) throw new Error('Choose --bundled or --remote.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('ZIP name can contain letters, numbers, dots, hyphens, and underscores.');
  if (mode === 'remote') requireRemote(config);
  const entries = await inventory(root, config);
  const mod = await inspectMod(root, entries);
  const external = mode === 'remote' ? entries.filter(entry => mod.references.has(entry.key) && !mod.runtimeAssets.has(entry.key)) : [];
  if (mode === 'remote') {
    log(`Checking ${external.length} hosted images before building. This checks the URLs players will use.`);
    await verify(external);
  }
  const urls = new Map(external.map(entry => [entry.key, entry.url]));
  const contents = Object.create(null);
  contents['manifest.json'] = await readRegularFile(root, 'manifest.json');
  for (const [file, value] of mod.json) {
    contents[file] = mode === 'bundled' ? await readRegularFile(root, file) :
      Buffer.from(`${JSON.stringify(rewriteAssets(value, urls), null, 2)}\n`);
  }
  for (const file of mod.modules) contents[file] = await readRegularFile(root, file);
  for (const entry of entries) {
    if (mode === 'bundled' || mod.runtimeAssets.has(entry.key)) contents[entry.key] = await readRegularFile(root, entry.key);
  }
  const zip = zipSync(contents, { level: 6 });
  const folder = resolve(root, 'dist');
  await mkdir(folder, { recursive: true });
  const output = resolve(folder, `${name}.zip`);
  const temporary = `${output}.tmp`;
  await writeFile(temporary, zip);
  await rename(temporary, output);
  await atomicJson(resolve(folder, `${name}.report.json`), {
    mode, base_url: mode === 'remote' ? config.base_url : null,
    files: Object.keys(contents), hosted: Object.fromEntries(external.map(entry => [entry.key, entry.url])),
    sha256: Object.fromEntries(entries.filter(entry => mode === 'bundled' || mod.references.has(entry.key))
      .map(entry => [entry.key, entry.sha256])), size: zip.length
  });
  log(`Built ${output} (${zip.length} bytes). ${external.length} hosted images; ${entries.filter(entry => mode === 'bundled' || mod.runtimeAssets.has(entry.key)).length} bundled assets.`);
  return { output, contents, external };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), ['--config', '--name']);
  assertFlags(flags, ['--bundled', '--remote', '--config', '--name', '--help']);
  if (flags['--help']) {
    console.log('Usage: npm run build -- --bundled | --remote [--name SAE-v0.9.4.9-bundled] [--config relative/config.json]');
    return;
  }
  if (positional.length || Boolean(flags['--bundled']) === Boolean(flags['--remote'])) throw new Error('Choose exactly one: --bundled or --remote.');
  await buildZip(repoRoot, await loadConfig(repoRoot, flags['--config']), {
    mode: flags['--remote'] ? 'remote' : 'bundled', name: flags['--name']
  });
}

if (isMain(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
