# MirrorKit User Guide

[中文](README.md) | [English](README_EN.md)

## License

This project is licensed under the GNU Affero General Public License v3.0 or later.

```text
SPDX-License-Identifier: AGPL-3.0-or-later
```

You may copy, distribute, and modify this project, but modified versions must also be released under the same license.

If you deploy a modified version as a network service for others to use, you must also provide the corresponding source code to those users.

Important: this license only covers the MirrorKit tool code. It does not cover third-party website assets downloaded with this tool.

## Disclaimer

This project is for learning, research, technical study, and local testing only. Do not use it for any illegal or unauthorized purpose.

MirrorKit is a local research tool that simulates a mirror site. It is not a complete copy of any target website and is not affiliated with any target website.

All resources downloaded with this tool are for personal research and local testing only. Without authorization, do not re-upload, publish, redistribute, commercialize, or use downloaded resources to operate a public mirror site. Those actions may violate copyright law or other laws.

Users are responsible for checking the copyright, terms of service, access rules, and applicable laws for any target website. Do not use this project for unauthorized copying, redistribution, commercial use, access-control bypassing, privacy violations, attacks, or other improper behavior.

Any risk, loss, legal liability, or third-party dispute caused by using this project is the user's own responsibility. The project author assumes no liability.

MirrorKit is a local website mirror framework.

Core rule:

```text
Try local files first
If missing, request the remote site
If the request succeeds, cache it locally
Future visits read from local files
```

The outer `index.html` is only a starter page. It does not store the target website homepage. Target website files are saved inside a separate mirror folder, for example:

```text
project-folder/
├─ index.html
├─ server.js
├─ tools/
└─ example-site.com/
   ├─ index.html
   ├─ assets/
   └─ ...
```

The outer project folder name can be changed freely.

## 0. Requirements

Install:

```text
Node.js 18 or newer
A modern browser, such as Chrome, Edge, or Firefox
```

Why:

```text
server.js and the scripts in tools/ run with Node.js
Remote resources are downloaded with the built-in Node.js fetch API
fetch is built into Node.js starting from Node.js 18
```

Check your Node.js version:

```bat
node -v
```

These versions are fine:

```text
v18.x.x
v20.x.x
v22.x.x
```

This project has no npm package dependencies. You do not need to run:

```bat
npm install
```

Run directly:

```bat
node server.js
```

Or double-click:

```text
一键启动服务器.bat
```

## 1. How To Change The Target Website

There are two ways to change the target website:

```text
Option A: use environment variables at runtime, without editing code
Option B: edit the top configuration in two files
```

For temporary testing, use Option A first.

### Option A: Use Environment Variables

This does not edit `server.js` or `tools/mirror-assets.js`. It only applies to the current command window.

CMD example:

```bat
set TARGET_HOST=https://example.com
set MIRROR_NAME=example.com
set START_PATH=/
node server.js
```

Batch download:

```bat
set TARGET_HOST=https://example.com
set MIRROR_NAME=example.com
set START_PATH=/
node tools\mirror-assets.js
```

If the entry is not the homepage, for example:

```text
https://example.com/example-path
```

set `START_PATH` to:

```bat
set START_PATH=/example-path
```

If you need the hidden media helper and the target site has a separate remote media bucket, also set:

```bat
set CMS_MEDIA_HOST=https://storage.example.com/example-bucket
node tools\mirror-cms-media.js
```

This is useful when you test different websites often, because the default code does not need to change.

### Option B: Edit The Top Configuration

If you want one target website to become the default, edit the top configuration in two files:

```text
server.js
tools/mirror-assets.js
```

Keep the values in both files consistent.

### TARGET_HOST

The source website origin. Use protocol plus domain only. Do not include the final `/`.

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';
```

Change it to your target site:

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://www.xxx.com';
```

### MIRROR_NAME

The local folder name for downloaded files.

```js
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';
```

For example:

```js
const MIRROR_NAME = process.env.MIRROR_NAME || 'xxx.com';
```

Downloaded files will be saved into:

```text
project-folder/xxx.com/
```

### START_PATH

The entry path of the target site.

If the entry is:

```text
https://www.xxx.com/
```

use:

```js
const START_PATH = process.env.START_PATH || '/';
```

If the entry is:

```text
https://www.xxx.com/zh
```

use:

```js
const START_PATH = process.env.START_PATH || '/zh';
```

Open the mirror with:

```text
http://localhost:3000/<MIRROR_NAME><START_PATH>
```

Examples:

```text
http://localhost:3000/xxx.com/
http://localhost:3000/xxx.com/zh
```

## 2. Tools

All helper scripts are in `tools/`.

### server.js

Starts the local server.

It handles:

```text
Opening the local mirror
Reading local files first
Fetching missing files from the remote site
Saving fetched files locally
Rewriting external links to local mirror paths
```

Run:

```bat
node server.js
```

Or double-click:

```text
一键启动服务器.bat
```

Then open:

```text
http://localhost:3000/
```

The starter page automatically shows the current mirror entry.

### tools\mirror-assets.js

General batch downloader.

Good for ordinary website resources:

```text
HTML
CSS
JS
JSON
Images
Fonts
Normal video files
wasm
Compressed textures
```

Run:

```bat
node tools\mirror-assets.js
```

Retry bad cache files:

```bat
node tools\mirror-assets.js --retry-bad
```

Run this first after changing the target website.

### tools\mirror-cms-media.js

Supplemental downloader for hidden media.

Some websites do not write videos and images directly in HTML. They may be hidden in:

```text
CMS JSON
Remote storage buckets
Cache-versioned app files
Runtime data files
```

In those cases, `mirror-assets.js` may not discover everything. Run this supplemental script.

Run:

```bat
node tools\mirror-cms-media.js
```

Retry bad cache files:

```bat
node tools\mirror-cms-media.js --retry-bad
```

This script has its own top configuration:

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';
const CMS_HOST = process.env.CMS_MEDIA_HOST || 'https://storage.example.com/example-bucket';
```

If the new site does not use a CMS or remote media bucket, you do not need this script.

If the new site has a similar media bucket, change `CMS_HOST`.

### tools\find-video-refs.js

Finds video links inside local text files.

Run:

```bat
node tools\find-video-refs.js
```

It only searches references. It does not download files.

### tools\validate-assets.js

Checks for bad local cached files.

Run:

```bat
node tools\validate-assets.js
```

It helps detect cases where an HTML error page was accidentally saved as an image, JSON file, font, or other asset.

## 3. Recommended Workflow

### Ordinary Website

```bat
node tools\mirror-assets.js
node server.js
```

Then open:

```text
http://localhost:3000/
```

### Website With Hidden Videos Or CMS Data

```bat
node tools\mirror-assets.js
node tools\mirror-cms-media.js
node server.js
```

Then open:

```text
http://localhost:3000/
```

### Lazy Cache While Browsing

Start only the server:

```bat
node server.js
```

Then browse, scroll, and open detail pages. Missing resources will be fetched and cached when the browser requests them.

If a page contains a full external URL like:

```text
https://cdn.xxx.com/a.mp4
```

the server rewrites it to:

```text
/xxx.com/cdn.xxx.com/a.mp4
```

So the browser asks the local server first. If the file is missing locally, the server fetches and caches it.

## 4. When To Change More Rules

Usually only change:

```text
TARGET_HOST
MIRROR_NAME
START_PATH
```

Change more rules only in these cases.

### Missing File Extensions

Files:

```text
tools/mirror-assets.js
tools/mirror-cms-media.js
```

Edit:

```js
const ASSET_EXTS = [
    ...
];
```

For example, add:

```text
.glb
.gltf
.pdf
.m3u8
.ts
.m4s
```

### Special CMS Or Remote Media Bucket

File:

```text
tools/mirror-cms-media.js
```

Edit:

```js
const CMS_HOST = process.env.CMS_MEDIA_HOST || 'https://storage.example.com/example-bucket';
```

### Multiple Entry Pages

File:

```text
tools/mirror-assets.js
```

Edit:

```js
const SEED_URLS = [
    START_PATH,
    '/about',
    '/work',
    '/contact'
];
```

### Paths With Dots That Are Not Domains

File:

```text
server.js
```

Edit:

```js
const SITE_PATH_PREFIXES = new Set([
    'content',
    'etc.clientlibs',
    'experiment',
    'webui',
    'auth',
    'graphql'
]);
```

Example:

```text
/etc.clientlibs/xxx.js
```

It contains a dot, but it is still an internal site path, not a remote domain.

## 5. Re-Mirroring A Website

1. Close the server window.
2. Delete the current mirror folder, for example:

```text
xxx.com/
```

3. Make sure the top configuration matches in:

```text
server.js
tools/mirror-assets.js
```

4. Run again:

```bat
node tools\mirror-assets.js
node server.js
```

If hidden media is needed:

```bat
node tools\mirror-cms-media.js
```

## 6. FAQ

### A Page Opens As A Downloaded File

This usually means an extensionless route was not saved as `index.html`.

The server now saves a route like:

```text
/about
```

as:

```text
<MIRROR_NAME>/about/index.html
```

### Videos Were Downloaded, But Offline Playback Still Fails

Usually the page is still requesting a full external URL.

The server rewrites external links to local mirror paths. If it still fails:

```text
Restart the server
Press Ctrl + F5 in the browser
Confirm the video file exists inside the mirror folder
```

### Log Shows Rejected unexpected content

The remote response does not look like the requested resource.

For example, the request expects:

```text
.jpg
.js
.json
```

but the remote server returns:

```text
text/html
```

That is usually a 404 page, redirect page, or fallback page. Rejecting it is normal protection.

### Menus, Carousels, Or Modals Do Not Open

Check:

```text
Restart the server after editing server.js
Press Ctrl + F5 in the browser
Open the browser console and inspect JS errors
```

Do not rewrite the whole JS file aggressively. The server only rewrites external URL prefixes to avoid breaking minified JS.

## 7. Encoding Note

Files containing Chinese comments should stay UTF-8.

Do not write Chinese files with PowerShell redirection, for example:

```bat
echo 中文 > README.md
```

That can corrupt Chinese text.
