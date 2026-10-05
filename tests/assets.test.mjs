import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { loadConfig, requireRemote, inventory, inspectMod, safePath, assetUrl, digest,
  verifyObject, verifyAll, wranglerPutArgs } from '../scripts/asset-tools.mjs';
import { uploadAssets } from '../scripts/assets.mjs';
import { buildZip } from '../scripts/build.mjs';

const config = {
  base_url: 'https://images.example.com', cache_seconds: 300,
  r2: { account_id: 'a'.repeat(32), bucket: 'sae-test', jurisdiction: 'eu' }
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const quiet = () => {};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sae-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function put(name, bytes) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), bytes);
  }
  await put('asset-hosting.json', JSON.stringify(config));
  await put('manifest.json', JSON.stringify({ namespace: 'expandedAreas', icon: 'assets/ICON.png',
    setup: 'src/setup.mjs', load: ['src/data/main.json', 'src/dependentData/mods/demo.json'] }));
  await put('src/data/main.json', JSON.stringify({ namespace: 'expandedAreas', data: {
    items: [{ id: 'Staff', media: 'assets/bank/Staff.png', description: 'Use assets/bank/Staff.png here.' }],
    categories: [{ emptyMedia: 'assets/skills/empty.svg' }]
  } }));
  await put('src/dependentData/mods/demo.json', JSON.stringify({ dependentData: [{ namespace: 'demo',
    modifications: { items: [{ id: 'demo:Staff', media: 'assets/bank/Staff.png' }] } }] }));
  await put('src/setup.mjs', 'export function setup(ctx) {}\n');
  await put('src/data/inactive.json', '{"unused":true}');
  await put('assets/ICON.png', png);
  await put('assets/bank/Staff.png', png);
  await put('assets/skills/empty.svg', svg);
  await put('assets/.DS_Store', 'junk');
  await put('.agents/README.md', 'private knowledge');
  await put('old-release.zip', 'old release');
  return { root, put };
}

test('configuration merges R2 overrides and accepts one-day caching', async t => {
  const { root, put } = await fixture(t);
  await put('asset-hosting.local.json', JSON.stringify({ cache_seconds: 86400, r2: { bucket: 'other-bucket' } }));
  const value = await loadConfig(root);
  assert.equal(value.cache_seconds, 86400);
  assert.equal(value.r2.bucket, 'other-bucket');
  assert.equal(value.r2.jurisdiction, 'eu');
  assert.equal(value.r2.account_id, config.r2.account_id);
});

test('malformed configuration and missing explicit config fail before side effects', async t => {
  const { root, put } = await fixture(t);
  await assert.rejects(loadConfig(root, 'missing.json'), /Cannot read/);
  for (const override of [{ cache_seconds: -1 }, { cache_seconds: 3.5 }, { cache_seconds: '300' },
    { base_url: 'https://user:secret@example.com' }, { r2: { jurisdiction: 'elsewhere' } }, { cach_seconds: 300 },
    { upload_concurrency: 0 }, { upload_concurrency: 5 }]) {
    await put('asset-hosting.local.json', JSON.stringify(override));
    await assert.rejects(loadConfig(root));
  }
  await put('asset-hosting.local.json', '{oops');
  await assert.rejects(loadConfig(root), /Cannot read/);
  assert.throws(() => requireRemote({ ...config, base_url: '' }), /base_url/);
});

test('keys stay stable after replacing bytes, URLs encode filenames, and junk is excluded', async t => {
  const { root, put } = await fixture(t);
  await put('assets/bank/Space #1.png', png);
  const original = await inventory(root, config);
  const staff = original.find(entry => entry.key === 'assets/bank/Staff.png');
  await put(staff.key, Buffer.concat([png, Buffer.from('changed')]));
  const changed = (await inventory(root, config)).find(entry => entry.key === staff.key);
  assert.equal(changed.key, staff.key);
  assert.equal(changed.url, staff.url);
  assert.notEqual(changed.sha256, staff.sha256);
  assert.equal(original.length, 4);
  assert.equal(assetUrl(config, 'assets/bank/Space #1.png'), 'https://images.example.com/assets/bank/Space%20%231.png');
});

test('exact-case and missing references fail the preflight', async t => {
  const { root, put } = await fixture(t);
  const entries = await inventory(root, config);
  await put('src/data/main.json', JSON.stringify({ media: 'assets/bank/staff.png' }));
  await assert.rejects(inspectMod(root, entries), /actual case: assets\/bank\/Staff.png/);
  await put('src/data/main.json', JSON.stringify({ emptyMedia: 'assets/missing.svg' }));
  await assert.rejects(inspectMod(root, entries), /file missing/);
});

test('path escapes and symlinked assets are rejected', async t => {
  const { root } = await fixture(t);
  assert.throws(() => safePath(root, '../secrets'), /relative path/);
  assert.throws(() => safePath(root, 'assets/../secrets'), /relative path/);
  try { await symlink(join(root, 'assets/ICON.png'), join(root, 'assets/link.png')); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows symlink permission is unavailable.');
    throw error;
  }
  await assert.rejects(inventory(root, config), /symlink/);
});

test('default jurisdiction omits the Wrangler flag; EU sends it explicitly', async t => {
  const { root } = await fixture(t);
  const entry = (await inventory(root, config))[0];
  assert.ok(wranglerPutArgs(config, entry).includes('--jurisdiction'));
  assert.ok(!wranglerPutArgs({ ...config, r2: { ...config.r2, jurisdiction: 'default' } }, entry).includes('--jurisdiction'));
});

test('verification checks bytes, MIME type, and upload cache metadata', async t => {
  const { root } = await fixture(t);
  const entry = (await inventory(root, config))[0];
  const bytes = await readFile(entry.file);
  const response = (body, headers, status = 200) => async () => new Response(body, { status, headers });
  const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' };
  await verifyObject(entry, { fetchObject: response(bytes, headers), cache: 'public, max-age=300' });
  await assert.rejects(verifyObject(entry, { fetchObject: response('wrong', headers) }), /bytes differ/);
  await assert.rejects(verifyObject(entry, { fetchObject: response(bytes, { 'content-type': 'text/html' }) }), /Content-Type/);
  await assert.rejects(verifyObject(entry, { fetchObject: response('', headers, 404) }), /HTTP 404/);
  await assert.rejects(verifyObject(entry, { fetchObject: response(bytes, headers), cache: 'public, max-age=86400' }), /Cache-Control/);
});

test('upload preview neither invokes Wrangler nor fetches or writes receipts', async t => {
  const { root } = await fixture(t);
  const entries = await inventory(root, config);
  const forbidden = () => { throw new Error('Unexpected side effect'); };
  await uploadAssets(root, config, entries, { dryRun: true, run: forbidden, verify: forbidden, log: quiet });
  await assert.rejects(access(join(root, '.asset-state/uploads.json')));
});

test('bulk verification stops scheduling files after failure and drains in-flight requests', async t => {
  const { root } = await fixture(t);
  const entries = await inventory(root, config);
  let calls = 0;
  await assert.rejects(verifyAll(Array.from({ length: 20 }, (_, i) => entries[i % entries.length]), {
    fetchObject: async () => { calls++; return new Response('', { status: 404 }); }
  }), /HTTP 404/);
  assert.equal(calls, 4);
});

test('concurrent uploads keep every successful receipt and respect the configured limit', async t => {
  const { root, put } = await fixture(t);
  for (let i = 0; i < 6; i++) await put(`assets/bank/extra-${i}.png`, png);
  const entries = await inventory(root, config);
  let active = 0;
  let peak = 0;
  await uploadAssets(root, { ...config, upload_concurrency: 2 }, entries, {
    run: async () => {
      peak = Math.max(peak, ++active);
      await new Promise(done => setTimeout(done, 5));
      active--;
    }, verify: async () => {}, log: quiet
  });
  assert.equal(peak, 2);
  const state = JSON.parse(await readFile(join(root, '.asset-state/uploads.json')));
  const receipts = Object.values(state)[0];
  assert.equal(Object.keys(receipts).length, entries.length);
  for (const entry of entries) assert.equal(receipts[entry.key].sha256, entry.sha256);
});

test('upload uses permanent keys, skips verified unchanged files, and reuploads changed cache policy', async t => {
  const { root } = await fixture(t);
  const entries = (await inventory(root, config)).slice(0, 1);
  const calls = [];
  const run = async (root, args, settings) => calls.push({ args, settings });
  const verify = async () => {};
  await uploadAssets(root, config, entries, { run, verify, log: quiet });
  assert.deepEqual(calls[0].args, wranglerPutArgs(config, entries[0]));
  assert.equal(calls[0].args[3], `sae-test/${entries[0].key}`);
  await uploadAssets(root, config, entries, { run, verify, log: quiet });
  assert.equal(calls.length, 1);
  await uploadAssets(root, { ...config, cache_seconds: 86400 }, entries, { run, verify, log: quiet });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.at(-1), 'public, max-age=86400');
  await uploadAssets(root, { ...config, cache_seconds: 86400 }, entries, { force: true, run, verify, log: quiet });
  assert.equal(calls.length, 3);
});

test('a lost or changed public object is reuploaded even when its receipt matches', async t => {
  const { root } = await fixture(t);
  const entries = (await inventory(root, config)).slice(0, 1);
  let calls = 0;
  const run = async () => { calls++; };
  await uploadAssets(root, config, entries, { run, verify: async () => {}, log: quiet });
  let verifications = 0;
  const verify = async () => { if (++verifications === 1) throw new Error('HTTP 404'); };
  await uploadAssets(root, config, entries, { run, verify, log: quiet });
  assert.equal(calls, 2);
  assert.equal(verifications, 2);
});

test('failed upload verification does not mark the file uploaded; earlier successes remain retryable', async t => {
  const { root } = await fixture(t);
  const entries = (await inventory(root, config)).slice(0, 2);
  let count = 0;
  await assert.rejects(uploadAssets(root, config, entries, {
    run: async () => {}, verify: async () => { if (++count === 2) throw new Error('wrong bytes'); }, log: quiet
  }), /wrong bytes/);
  const state = JSON.parse(await readFile(join(root, '.asset-state/uploads.json')));
  const receipt = Object.values(state)[0];
  assert.equal(receipt[entries[0].key].sha256, entries[0].sha256);
  assert.equal(receipt[entries[1].key], undefined);
});

test('bundled ZIP needs no cloud configuration, preserves source, and excludes local tooling and inactive JSON', async t => {
  const { root } = await fixture(t);
  const original = await readFile(join(root, 'src/data/main.json'));
  const result = await buildZip(root, { ...config, base_url: '' }, {
    mode: 'bundled', verify: () => { throw new Error('Unexpected network'); }, log: quiet
  });
  const zip = unzipSync(await readFile(result.output));
  assert.deepEqual(Buffer.from(zip['src/data/main.json']), original);
  assert.ok(zip['assets/ICON.png']);
  assert.ok(zip['assets/bank/Staff.png']);
  assert.ok(zip['assets/skills/empty.svg']);
  assert.equal(zip['src/data/inactive.json'], undefined);
  assert.equal(zip['.agents/README.md'], undefined);
  assert.equal(zip['asset-hosting.json'], undefined);
  assert.deepEqual(await readFile(join(root, 'src/data/main.json')), original);
});

test('remote ZIP rewrites media, emptyMedia, and dependent data; icon stays bundled and source stays local', async t => {
  const { root } = await fixture(t);
  const original = await readFile(join(root, 'src/data/main.json'));
  let verified;
  const result = await buildZip(root, config, { mode: 'remote', verify: async entries => { verified = entries; }, log: quiet });
  const zip = unzipSync(await readFile(result.output));
  const main = JSON.parse(Buffer.from(zip['src/data/main.json']));
  const dependent = JSON.parse(Buffer.from(zip['src/dependentData/mods/demo.json']));
  assert.equal(verified.length, 2);
  assert.equal(main.data.items[0].media, 'https://images.example.com/assets/bank/Staff.png');
  assert.equal(main.data.categories[0].emptyMedia, 'https://images.example.com/assets/skills/empty.svg');
  assert.equal(main.data.items[0].description, 'Use assets/bank/Staff.png here.');
  assert.equal(dependent.dependentData[0].modifications.items[0].media, main.data.items[0].media);
  assert.ok(zip['assets/ICON.png']);
  assert.equal(zip['assets/bank/Staff.png'], undefined);
  assert.equal(zip['assets/skills/empty.svg'], undefined);
  assert.deepEqual(await readFile(join(root, 'src/data/main.json')), original);
});

test('assets used by JavaScript stay bundled in a remote build', async t => {
  const { root, put } = await fixture(t);
  await put('src/setup.mjs', 'export function setup(ctx) { ctx.getResourceUrl("assets/bank/Staff.png"); }');
  const result = await buildZip(root, config, { mode: 'remote', verify: async () => {}, log: quiet });
  assert.ok(result.contents['assets/bank/Staff.png']);
  assert.equal(JSON.parse(result.contents['src/data/main.json']).data.items[0].media, 'assets/bank/Staff.png');
});

test('remote verification failure prevents ZIP output and leaves source unchanged', async t => {
  const { root } = await fixture(t);
  const original = await readFile(join(root, 'src/data/main.json'));
  await assert.rejects(buildZip(root, config, { mode: 'remote', verify: async () => { throw new Error('HTTP 404'); }, log: quiet }), /HTTP 404/);
  await assert.rejects(access(join(root, 'dist/SAE-remote.zip')));
  assert.equal(digest(await readFile(join(root, 'src/data/main.json'))), digest(original));
});
