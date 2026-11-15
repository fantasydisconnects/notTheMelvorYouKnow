First time only
Install Node.js 22 or newer, then open a terminal in the repo folder:

git switch main
git pull --ff-only origin main
npm ci
copy asset-hosting.json asset-hosting.local.json
notepad asset-hosting.local.json


In that file, enter the Cloudflare public image URL, account ID, and bucket name. Save and close it.

Log in to Cloudflare:

npm run login


Every new version
Before making changes, get the latest code:

git pull --ff-only origin main
npm ci


Make your changes, then check, upload images, and build the ZIP:

npm test
npm run assets -- check
npm run assets -- upload
npm run build -- --remote --name SAE-v0.9.6-remote


Replace 0.9.6 with your new version number. Unchanged images are skipped automatically.

Your ZIP is in dist/SAE-v0.9.6-remote.zip. Test it in Melvor, then upload it to mod.io.

ZIP with images included
No Cloudflare setup or upload needed:

npm run build -- --bundled --name SAE-v0.9.6-bundled