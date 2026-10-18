# Build and asset hosting

SAE is a Melvor Idle content mod. These tools let you keep images inside the mod ZIP or upload them to Cloudflare R2
and build a smaller ZIP that uses their public URLs. Your source files keep their normal local image paths.

## Install once

1. Install [Node.js](https://nodejs.org/) version 22 or newer, preferably the current LTS version.
2. Open a terminal in this repository's folder.
3. Run `npm ci` to install the tools, including Wrangler.

These commands work in a terminal on Windows, macOS, or Linux. No system ZIP utility is required.

## Build a ZIP with bundled images

```sh
npm run build -- --bundled
```

The result is `dist/SAE-bundled.zip`. This needs no Cloudflare account or internet access after installation.
To choose a release filename:

```sh
npm run build -- --bundled --name SAE-v0.9.4.9-bundled
```

Use the ZIP with Melvor's Creator Toolkit or your usual publishing workflow. Building never uploads files.

## Set up R2

Create an R2 bucket and enable its public development URL for testing, or connect a custom domain for production.
The public development URL ends in `.r2.dev`; a production URL might be `https://images.your-domain.com`.

Copy `asset-hosting.json` to `asset-hosting.local.json`, then edit the copy with your settings:

```json
{
  "base_url": "https://images.your-domain.com",
  "cache_seconds": 300,
  "r2": {
    "account_id": "YOUR_32_CHARACTER_CLOUDFLARE_ACCOUNT_ID",
    "bucket": "your-bucket-name",
    "jurisdiction": "default"
  }
}
```

Find your account ID and bucket name in the Cloudflare dashboard. Use `eu` instead of `default` if you created an
EU-jurisdiction bucket. The public URL is the bucket's public development URL or connected custom domain, not its
dashboard URL or S3 API endpoint. Do not put passwords or API tokens in this file.

The local configuration is ignored by Git. `asset-hosting.json` contains shared defaults and remains editable;
settings in `asset-hosting.local.json` override them. A partial local configuration can override only selected settings.

Log into the Cloudflare account that owns your bucket:

```sh
npm run login
```

Wrangler opens a browser for authentication. It manages the login separately from this repository. Scripts use the
account ID from your configuration, so check it before uploading.

## Preview and upload images

First check that every image reference matches a real file, including capital letters:

```sh
npm run assets -- check
```

Preview the upload destinations without changing the bucket:

```sh
npm run assets -- upload --dry-run
```

Check the displayed bucket and filenames. Then upload:

```sh
npm run assets -- upload
```

Bulk uploads invoke Wrangler once per file, with three files at a time by default, and can take several minutes.
Set `"upload_concurrency": 1` in the local configuration if you prefer one at a time; values from 1 to 4 are supported.
The command sets each image's Content-Type
and Cache-Control, then downloads it through the public URL to verify its bytes and metadata. If anything fails, it
stops starting new files and finishes any uploads already in progress. Re-running it checks and skips previously
verified, unchanged files; it retries missing or changed objects.

Files keep their readable repository paths as R2 keys. For example, `assets/icons/Skull.png` is uploaded to the object
named `assets/icons/Skull.png`. There are no version or hash folders. Uploading the same key replaces that object.
Folders and capitalization matter: `Skull.png` and `skull.png` are different keys. The command never deletes objects.

Upload receipts are stored privately in `.asset-state/`. They help with retries, but the command also checks the public
object before skipping a file. Changing the cache setting causes files to be re-uploaded with the new metadata.
Use `--force` after the upload command if you want to re-upload unchanged files too.

## Find or replace an image

Search by any part of a filename, ignoring case:

```sh
npm run assets -- find Skull
```

This shows matching repository paths, R2 keys, and public URLs. Use the exact path printed by the search:

1. Replace the image file in the repository, keeping its path and filename unchanged.
2. Preview and upload that one file:

```sh
npm run assets -- upload assets/icons/Skull.png --dry-run
npm run assets -- upload assets/icons/Skull.png
```

The existing object is replaced at the same URL. No new ZIP is needed just to correct artwork with the same path.
Existing remote ZIPs will also use the replacement. Bundled ZIPs keep their packaged artwork; build a new bundled ZIP
to include the correction. Keep the local image replacement in Git so future uploads and bundled builds use it too.

## Build a ZIP using uploaded images

After the upload succeeds:

```sh
npm run build -- --remote
```

This verifies the hosted images that the mod uses, rewrites their references in the ZIP, and creates
`dist/SAE-remote.zip`. It stops if a hosted file is missing or differs from the local file. The mod icon stays bundled,
as do any assets referenced directly by JavaScript. Images referenced by data JSON, including `emptyMedia` and
dependent-mod data, use their public URLs. Source JSON is never rewritten.

You can set a filename with `--name SAE-v0.9.4.9-remote`. A JSON report beside each ZIP lists its contents and image
checksums. Reports stay outside the ZIP. Only the manifest, its loaded JSON, JavaScript modules under `src/`, and the
appropriate assets are packaged. Local settings, tools, old ZIPs, notes, and inactive JSON files are excluded.

Load the result in Melvor to check image loading and game behavior before publishing. The tools verify files and
references; they do not simulate the game runtime.

## Cache duration and production domains

Start with `"cache_seconds": 300` (five minutes). Later, set it to `86400` for one day and re-run the upload command
to update existing objects' metadata. Merely editing the configuration does not change already uploaded objects.

The `.r2.dev` URL is for testing and is rate limited. It does not provide Cloudflare CDN caching; the Cache-Control
header can still control browser caching. Connect your own domain for production and CDN caching, then change
`base_url` in your local configuration and rebuild the remote ZIP. Upload receipts are separated by destination.

For a custom domain, configure Cloudflare cache rules to respect the uploaded Cache-Control duration. With a one-day
duration, an old image may remain in a browser or CDN cache for up to one day. An urgent correction may require purging
the affected URL in Cloudflare and refreshing the game; purging Cloudflare does not clear a player's browser cache.
An image already displayed in an open game may need a reload even after its cache expires. These images use mutable
URLs, so the scripts do not mark them `immutable`.

## Troubleshooting

- **Asset not found:** run `npm run assets -- find NAME` and copy the exact path, including capitalization.
- **Public URL returns 404:** check the bucket and account, enable public access, and confirm `base_url` points to that
  bucket. The public URL's root may itself return 404 even when individual objects work.
- **Wrangler fails:** run `npm run login` again and check the account ID and bucket jurisdiction.
- **Hosted bytes differ:** upload the current local file. If it was just uploaded, wait for the cache to expire or purge
  that URL on a custom domain. A unique verification query may bypass a cache, but cache rules can ignore queries.
- **HTTP 429:** the testing URL or service is rate limiting requests. Wait and retry; use a custom domain for production.
- **Cache metadata differs:** re-upload the file and check any custom-domain cache rules.

To verify all hosted images without uploading, run `npm run assets -- verify`; append one exact asset path to check
only that file. Use `--config relative/path.json` on assets or build commands to select another configuration instead
of the usual local override. Run `npm test` to check the tooling with local fixtures; tests do not contact Cloudflare.

Cloudflare references: [Wrangler R2 commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/),
[public buckets and domains](https://developers.cloudflare.com/r2/buckets/public-buckets/), and
[overwrites and cache behavior](https://developers.cloudflare.com/r2/reference/consistency/).
