const fs = require('fs');
const path = require('path');

// ROOT：项目根目录。脚本在 tools 目录里，所以向上一级。
const ROOT = path.resolve(__dirname, '..');

// ====== 站点配置区：换网站时主要改这里 ======
// TARGET_HOST：目标网站源站，只写协议 + 域名，不要带最后的斜杠。
// 默认使用 example.com 作为占位示例，避免把某个真实网站当成框架默认内容。
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';

// MIRROR_NAME：本地保存文件夹名。
// 规则：不管扒什么网站，所有下载内容都先进这个文件夹。
// 外面的 index.html 只做框架说明页，不保存目标站首页。
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';

// START_PATH：目标站点入口路径。
// 默认从根路径 / 开始；换网站时可以改成 /cn、/zh-hans、/home 等。
const START_PATH = process.env.START_PATH || '/';

// TIMEOUT_MS：单个远程请求超时时间，防止下载一直卡住。
const TIMEOUT_MS = Number(process.env.MIRROR_TIMEOUT_MS || 30000);

// CONCURRENCY：并发下载数量。太高容易被限流，默认 6 比较稳。
const CONCURRENCY = Number(process.env.MIRROR_CONCURRENCY || 6);

// SEED_URLS：第一批入口资源。
// 换网站时改这里：可以放首页、栏目页、站点地图、核心 JSON、核心 JS。
const SEED_URLS = [
    START_PATH
];

// REMOTE_ASSET_PREFIXES：额外扫描的完整远程资源前缀。
// 这里不是某个网站专用；匹配到才用，不匹配就跳过。
const REMOTE_ASSET_PREFIXES = [];

// ====== 通用规则区：不是某个网站专用，不要随便删 ======
// 内置远程资源前缀。Google Storage 很常见，所以保留为通用规则。
const BUILTIN_REMOTE_ASSET_PREFIXES = [
    'https://storage.googleapis.com/'
];

// ASSET_EXTS：认为值得下载的资源扩展名。
// 新网站如果有 glb/gltf/pdf/zip 等格式，可以继续往这里加。
const ASSET_EXTS = [
    'avif', 'bin', 'css', 'gif', 'html', 'ico', 'jpg', 'jpeg', 'js', 'json',
    'ktx', 'ktx2', 'mjs', 'mov', 'mp3', 'mp4', 'otf', 'png', 'svg', 'ttf',
    'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2', 'zip'
];

// MAGIC_BYTES：二进制文件头校验。
// 目标是防止把 HTML 错误页保存成图片、字体、wasm 等假资源。
const MAGIC_BYTES = {
    '.png': [0x89, 0x50, 0x4e, 0x47],
    '.jpg': [0xff, 0xd8, 0xff],
    '.jpeg': [0xff, 0xd8, 0xff],
    '.gif': [0x47, 0x49, 0x46],
    '.webp': [0x52, 0x49, 0x46, 0x46],
    '.wasm': [0x00, 0x61, 0x73, 0x6d],
    '.woff': [0x77, 0x4f, 0x46, 0x46],
    '.woff2': [0x77, 0x4f, 0x46, 0x32],
    '.ktx': [0xab, 0x4b, 0x54, 0x58],
    '.ktx2': [0xab, 0x4b, 0x54, 0x58]
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

// 命令参数：
// --retry-bad：本地已有文件也重新下载/校验，适合清掉坏缓存后重跑。
const args = new Set(process.argv.slice(2));
const SHOULD_RETRY_BAD = args.has('--retry-bad');

function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function isAssetUrl(value) {
    try {
        const url = new URL(value);
        const ext = path.extname(decodeURIComponent(url.pathname)).toLowerCase().slice(1);
        return ASSET_EXTS.includes(ext);
    } catch {
        return false;
    }
}

// 把 HTML/JS/CSS/JSON 里提取出来的字符串整理成资源路径。
function normalizeAssetPath(rawPath) {
    if (!rawPath) return null;

    let value = rawPath
        .replace(/\\\//g, '/')
        .replace(/^['"`]+|['"`]+$/g, '')
        .trim();

    if (!value || value.includes('${') || value.includes('`') || value.includes('\n') || value.includes('\r')) {
        return null;
    }

    if (value.startsWith('//')) value = `https:${value}`;
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return isAssetUrl(value) ? value : null;
    }

    if (value.startsWith('/')) value = value.slice(1);

    const clean = value.split('#')[0].split('?')[0];
    const ext = path.extname(clean).toLowerCase().slice(1);
    if (!ASSET_EXTS.includes(ext)) return null;

    return clean;
}

// 从文本中提取资源引用：引号路径、CSS url(...)、裸 URL。
function extractAssetPathsFromText(text) {
    const output = new Set();
    const extGroup = ASSET_EXTS.join('|');
    const patterns = [
        new RegExp('["\'`]([^"\'`]+?\\.(?:' + extGroup + ')(?:\\?[^"\'`]*)?)["\'`]', 'gi'),
        new RegExp('url\\(([^)]+?\\.(?:' + extGroup + ')(?:\\?[^)]*)?)\\)', 'gi'),
        new RegExp('(?:https?:\\/\\/[^"\'`\\s)]+|\\/[A-Za-z0-9_./%~@+\\-=]+)\\.(?:' + extGroup + ')(?:\\?[^"\'`\\s)]*)?', 'gi')
    ];

    for (const regex of patterns) {
        for (const match of text.matchAll(regex)) {
            const candidate = normalizeAssetPath(match[1] || match[0]);
            if (candidate) output.add(candidate);
        }
    }

    // 对指定 CDN 前缀做宽松扫描，处理带空格、括号或奇怪转义的媒体 URL。
    for (const prefix of getActiveRemoteAssetPrefixes()) {
        let cursor = 0;
        while (true) {
            const start = text.indexOf(prefix, cursor);
            if (start === -1) break;

            let end = start;
            while (end < text.length && !['"', "'", '<', '>', '\n', '\r'].includes(text[end])) {
                end++;
            }

            const candidate = text.slice(start, end).trim();
            if (isAssetUrl(candidate)) output.add(candidate);
            cursor = end + 1;
        }
    }

    return output;
}

function getActiveRemoteAssetPrefixes() {
    return new Set([...REMOTE_ASSET_PREFIXES, ...BUILTIN_REMOTE_ASSET_PREFIXES]);
}

// 递归扫描 JSON，提取所有字符串里的资源路径。
function extractAssetPathsFromJson(value, output = new Set()) {
    if (Array.isArray(value)) {
        for (const item of value) extractAssetPathsFromJson(item, output);
        return output;
    }

    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) extractAssetPathsFromJson(item, output);
        return output;
    }

    if (typeof value !== 'string') return output;

    const direct = normalizeAssetPath(value);
    if (direct) output.add(direct);

    for (const item of extractAssetPathsFromText(value)) {
        output.add(item);
    }

    return output;
}

function isHtmlLike(buffer) {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

function hasMagic(buffer, magic) {
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

// 下载结果校验：这是防止坏缓存的关键逻辑，不建议删除。
function isValidDownload(localPath, response, buffer) {
    const ext = path.extname(localPath).toLowerCase();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (isHtmlLike(buffer) && ext !== '.html' && ext !== '') return false;

    if (ext === '.json') {
        try {
            JSON.parse(buffer.toString('utf8'));
            return true;
        } catch {
            return false;
        }
    }

    if (ext === '.js' || ext === '.mjs') {
        return !contentType.includes('text/html');
    }

    if (IMAGE_EXTS.has(ext) && contentType.startsWith('image/')) {
        return true;
    }

    const magic = MAGIC_BYTES[ext];
    if (magic) return hasMagic(buffer, magic);

    return true;
}

// 把资源路径映射成本地保存路径。
// 完整 URL 会按 hostname 建目录，避免不同来源资源重名。
// 所有内容都会放在 ROOT/MIRROR_NAME 下面。
function localPathForAsset(assetPath) {
    if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
        const url = new URL(assetPath);
        const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
        return path.join(ROOT, MIRROR_NAME, url.hostname, pathname);
    }

    const cleanPath = decodeURIComponent(assetPath.replace(/^\/+/, '')) || 'index.html';
    const finalPath = path.extname(cleanPath) ? cleanPath : path.posix.join(cleanPath, 'index.html');
    return path.join(ROOT, MIRROR_NAME, finalPath);
}

function remoteUrlForAsset(assetPath) {
    if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
        return assetPath;
    }
    return `${TARGET_HOST}/${assetPath.replace(/^\/+/, '')}`;
}

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: TARGET_HOST
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

// 本地已有入口文件也参与资源提取。
// 注意：外层 index.html 是框架说明页，所以这里只拿它做补充扫描，不把它当目标站首页。
function collectLocalSources() {
    const sources = [];
    const mirrorRoot = path.join(ROOT, MIRROR_NAME);
    const startLocalPath = localPathForAsset(START_PATH);

    for (const filePath of [
        path.join(mirrorRoot, 'index.html'),
        startLocalPath,
        path.join(ROOT, 'unsupported.html')
    ]) {
        if (fs.existsSync(filePath)) sources.push(filePath);
    }

    return sources;
}

function walk(dir, output = []) {
    if (!fs.existsSync(dir)) return output;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, output);
        else output.push(fullPath);
    }
    return output;
}

// 找出镜像文件夹里已有但内容不合法的资源。
function collectBadCachedAssets() {
    const bad = new Set();
    const mirrorRoot = path.join(ROOT, MIRROR_NAME);

    for (const filePath of walk(mirrorRoot)) {
        const relativePath = path.relative(mirrorRoot, filePath).replace(/\\/g, '/');
        const buffer = fs.readFileSync(filePath);
        const fakeResponse = { headers: { get: () => '' } };
        if (!isValidDownload(filePath, fakeResponse, buffer)) bad.add(relativePath);
    }

    return bad;
}

function collectInitialAssets() {
    const assets = new Set(SEED_URLS);

    for (const filePath of collectLocalSources()) {
        const text = readTextIfExists(filePath);
        for (const item of extractAssetPathsFromText(text)) assets.add(item);

        if (path.extname(filePath).toLowerCase() === '.json') {
            try {
                const json = JSON.parse(text);
                for (const item of extractAssetPathsFromJson(json)) assets.add(item);
            } catch {
                // JSON 解析失败时，不从它提取二级资源。
            }
        }
    }

    if (SHOULD_RETRY_BAD) {
        for (const item of collectBadCachedAssets()) assets.add(item);
    }

    return assets;
}

async function downloadAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    const url = remoteUrlForAsset(assetPath);

    if (fs.existsSync(localPath) && !SHOULD_RETRY_BAD) {
        return { status: 'skip', assetPath };
    }

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
        return { status: 'fail', assetPath, message: `HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isValidDownload(localPath, response, buffer)) {
        return { status: 'reject', assetPath, message: response.headers.get('content-type') || 'unknown content-type' };
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return { status: 'save', assetPath, bytes: buffer.length };
}

async function runQueue(items, onResult) {
    const queue = [...items];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                onResult(await downloadAsset(item));
            } catch (err) {
                onResult({ status: 'error', assetPath: item, message: err.message });
            }
        }
    });
    await Promise.all(workers);
}

async function loadJsonAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!fs.existsSync(localPath) || path.extname(localPath).toLowerCase() !== '.json') return null;
    try {
        return JSON.parse(readTextIfExists(localPath));
    } catch {
        return null;
    }
}

async function loadTextAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    const ext = path.extname(localPath).toLowerCase();
    if (!fs.existsSync(localPath) || !['.html', '.js', '.mjs', '.css', '.json', '.txt', ''].includes(ext)) return null;

    try {
        const buffer = fs.readFileSync(localPath);
        if (buffer.includes(0)) return null;
        return buffer.toString('utf8');
    } catch {
        return null;
    }
}

// 主流程：
// 1. 下载种子资源。
// 2. 从下载到的 JSON/HTML/CSS/JS 继续提取二级资源。
// 3. 最多循环 4 轮，避免无限扩散。
async function main() {
    const pending = collectInitialAssets();
    const seen = new Set();
    const stats = { save: 0, skip: 0, fail: 0, reject: 0, error: 0 };

    for (let pass = 1; pass <= 4; pass++) {
        const batch = [...pending].filter(item => !seen.has(item));
        if (!batch.length) break;
        batch.forEach(item => seen.add(item));

        console.log(`\nPass ${pass}: ${batch.length} resources`);
        await runQueue(batch, result => {
            stats[result.status] = (stats[result.status] || 0) + 1;
            const suffix = result.message ? ` (${result.message})` : '';
            console.log(`${result.status.padEnd(6)} ${result.assetPath}${suffix}`);
        });

        for (const item of batch) {
            const json = await loadJsonAsset(item);
            if (json) {
                for (const assetPath of extractAssetPathsFromJson(json)) {
                    if (!seen.has(assetPath)) pending.add(assetPath);
                }
                continue;
            }

            const text = await loadTextAsset(item);
            if (!text) continue;
            for (const assetPath of extractAssetPathsFromText(text)) {
                if (!seen.has(assetPath)) pending.add(assetPath);
            }
        }
    }

    console.log('\nDone.');
    console.log(stats);
    console.log(`Mirror folder: ${path.join(ROOT, MIRROR_NAME)}`);
    console.log(`Scanned unique resources: ${seen.size}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
