const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ====== 站点配置区：换网站时主要改这里 ======
// PORT：本地服务器端口。默认 3000，可以用环境变量 PORT 覆盖。
const PORT = Number(process.env.PORT || 3000);

// TARGET_HOST：目标网站源站，只写协议 + 域名，不要带最后的斜杠。
// 默认使用 example.com 作为占位示例，避免把某个真实网站当成框架默认内容。
// 真正扒站时，把这里改成目标站点，例如 https://www.example-site.com。
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';

// MIRROR_NAME：本地镜像文件夹名。
// 规则：不管扒什么网站，所有目标网站内容都先进这个文件夹。
// 外层 index.html 永远只做框架说明页，不保存目标网站首页。
// 默认用目标域名去掉开头的 www.，例如 www.example-site.com -> example-site.com。
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';

// START_PATH：目标站点入口路径。
// 默认从根路径 / 开始；换网站时可以改成 /cn、/zh-hans、/home 等。
const START_PATH = process.env.START_PATH || '/';

// REQUEST_TIMEOUT_MS：单个远程请求超时时间，防止某个资源一直卡住。
const REQUEST_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 30000);

// REMOTE_MIRRORS：手动远程资源映射。
// 这个数组不是绑定某一个网站的规则；如果别的网站也有同样结构，也可以继续用。
// 例子：
// { prefix: '/cdn.example.com/', origin: 'https://cdn.example.com' }
const REMOTE_MIRRORS = [];

// BUILTIN_REMOTE_MIRRORS：内置通用映射。
// 当前保持为空，避免把某个旧网站的 CDN 专用地址写死到框架里。
const BUILTIN_REMOTE_MIRRORS = [];

// IGNORED_PATH_PREFIXES：浏览器、插件、OAuth、MCP 等探测请求。
// 这些通常不是目标网站资源，不缓存，避免日志刷屏。
const IGNORED_PATH_PREFIXES = [
    '/.well-known/',
    '/bb-mcp'
];

// NOOP_REMOTE_HOSTS：镜像时默认空跑的统计/广告域名。
// 这些脚本常见行为是 document.write、跳转跟踪、广告竞价。
// 在本地镜像里继续执行反而可能把页面主体覆盖成空白，所以直接返回空脚本/空响应。
const NOOP_REMOTE_HOSTS = new Set([
    'www.googletagmanager.com',
    'googleads.g.doubleclick.net',
    'yads.c.yimg.jp',
    'yads.yjtag.yahoo.co.jp',
    'static.criteo.net',
    'bidder.criteo.com'
]);

// 有些广告脚本挂在正常 CDN 域名下面，不能按整个域名屏蔽。
// 所以只在脚本请求命中这些路径关键词时空跑。
const NOOP_SCRIPT_PATH_PATTERNS = [
    /\/yads\//i,
    /\/advertising\//i,
    /\/ds\/yas\//i,
    /\/ds\/cl\//i
];

// ====== 通用规则区：不是某个网站专用，不要随便删 ======
// 有些站点资源路径带点，例如 /etc.clientlibs/...，它不是远程域名。
// 这些前缀应当继续拼到 TARGET_HOST 后面去抓。
const SITE_PATH_PREFIXES = new Set([
    'content',
    'etc.clientlibs',
    'experiment',
    'webui',
    'auth',
    'graphql'
]);

// 判断路径第一段是否像“被本地化后的远程域名”。
// 例如 /assets.adobedtm.com/a.js 可以代理到 https://assets.adobedtm.com/a.js。
// 要求至少两个点，是为了避免把 /etc.clientlibs/... 误判成域名。
function looksLikeMirroredRemoteHost(segment) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(segment);
}

// 运行时只重写 HTML/CSS。
// 不能重写 JS：很多压缩脚本里有正则、模板字符串和转义 URL，粗暴替换会把脚本改坏，
// 典型表现就是菜单、轮播、弹窗等交互全部点不开。
const REWRITE_TEXT_EXTS = new Set(['.html', '.css']);

// JS/JSON 只做“外链前缀 -> 本地镜像前缀”的精确替换。
// 这样离线时媒体、CMS、第三方脚本会先走 localhost，但不会破坏压缩 JS 里的正则。
const EXTERNAL_URL_REWRITE_TEXT_EXTS = new Set(['.js', '.mjs', '.json']);
const REWRITE_ASSET_EXTS = [
    'avif', 'bin', 'css', 'gif', 'html', 'ico', 'jpg', 'jpeg', 'js', 'json',
    'ktx', 'ktx2', 'mjs', 'mov', 'mp3', 'mp4', 'otf', 'png', 'svg', 'ttf',
    'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2'
];

// MIME_TYPES：告诉浏览器每类文件应该怎么解析。
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.otf': 'font/opentype',
    '.ttf': 'font/ttf',
    '.bin': 'application/octet-stream',
    '.ktx': 'image/ktx',
    '.ktx2': 'image/ktx2',
    '.zip': 'application/zip'
};

// MAGIC_BYTES：常见二进制文件头校验。
// 作用：防止远程返回 HTML 错误页，却被保存成 jpg/png/wasm/font。
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

function isMirrorRequest(reqPath) {
    return reqPath === `/${MIRROR_NAME}` || reqPath.startsWith(`/${MIRROR_NAME}/`);
}

function stripMirrorPrefix(reqPath) {
    if (reqPath === `/${MIRROR_NAME}`) return '/';
    return reqPath.slice(MIRROR_NAME.length + 1) || '/';
}

function getTargetPathFromRequestPath(reqPath) {
    return isMirrorRequest(reqPath) ? stripMirrorPrefix(reqPath) : reqPath;
}

function getMirroredRemoteHost(reqPath) {
    const targetPath = getTargetPathFromRequestPath(reqPath);
    const firstSegment = targetPath.split('/').filter(Boolean)[0];

    if (!firstSegment || !looksLikeMirroredRemoteHost(firstSegment)) {
        return null;
    }

    return firstSegment.toLowerCase();
}

function shouldServeNoopRemote(reqPath) {
    const host = getMirroredRemoteHost(reqPath);
    if (host && NOOP_REMOTE_HOSTS.has(host)) {
        return true;
    }

    const targetPath = getTargetPathFromRequestPath(reqPath);
    const ext = path.extname(targetPath).toLowerCase();

    if (ext !== '.js' && ext !== '.mjs') {
        return false;
    }

    return NOOP_SCRIPT_PATH_PATTERNS.some(pattern => pattern.test(targetPath));
}

function serveNoopRemote(req, res, reqPath) {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const ext = path.extname(parsedUrl.pathname).toLowerCase();
    const dest = (req.headers['sec-fetch-dest'] || '').toLowerCase();
    const accept = (req.headers.accept || '').toLowerCase();

    console.log(`\x1b[36m[Noop] ${reqPath}\x1b[0m`);

    if (dest === 'script' || ext === '.js' || ext === '.mjs') {
        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.js'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end('/* MirrorKit noop remote script */');
        return;
    }

    if (dest === 'iframe' || ext === '.html') {
        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.html'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end('<!doctype html><html><head></head><body></body></html>');
        return;
    }

    if (accept.includes('application/json') || ext === '.json') {
        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.json'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end('{}');
        return;
    }

    res.writeHead(204, {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
    });
    res.end();
}

// 页面路由通常没有扩展名，例如 /about、/cn/about。
// 本地保存时统一落成 index.html，避免浏览器把无扩展名文件当下载文件。
function isRoutePath(reqPath) {
    return path.extname(reqPath) === '';
}

function isHtmlLike(buffer) {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

function isHtmlText(text) {
    const head = text.slice(0, 512).trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

function hasExpectedMagic(filePath, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    const magic = MAGIC_BYTES[ext];
    if (!magic) return true;
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

// 这是缓存安全阀：不要把 HTML fallback 错误页存成图片、字体、JSON 等假资源。
function isValidCachedResponse(filePath, response, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (isHtmlLike(buffer) && ext !== '.html' && ext !== '') {
        return false;
    }

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

    // 有些站点扩展名不准，例如 .png 实际返回 image/jpeg。
    // 只要响应明确是图片，就允许保存。
    if (IMAGE_EXTS.has(ext) && contentType.startsWith('image/')) {
        return true;
    }

    return hasExpectedMagic(filePath, buffer);
}

function ensureDirExists(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// 把 URL 路径安全映射到项目目录内。
// 核心规则：目标网站内容必须放在 MIRROR_NAME 文件夹里。
function getLocalPath(reqPath) {
    const baseDir = __dirname;
    let safePath = decodeURIComponent(reqPath);

    if (!isMirrorRequest(safePath)) {
        safePath = path.posix.join('/', MIRROR_NAME, safePath);
    }

    const targetPath = stripMirrorPrefix(safePath);
    if (isRoutePath(targetPath)) {
        safePath = path.posix.join(safePath, 'index.html');
    }

    const normalizedPath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
    const localPath = path.join(baseDir, normalizedPath);
    const resolvedBase = path.resolve(baseDir);
    const resolvedLocal = path.resolve(localPath);

    if (!resolvedLocal.startsWith(resolvedBase)) {
        return null;
    }

    return localPath;
}

function getContentType(filePath, data) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext && data && isHtmlLike(data)) return MIME_TYPES['.html'];
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveLocalFile(filePath, res) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code}`);
            return;
        }

        data = transformResponseForLocalMirror(filePath, data);

        res.writeHead(200, {
            'Content-Type': getContentType(filePath, data),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}

function getMirrorEntryPath() {
    const startPath = START_PATH.startsWith('/') ? START_PATH : `/${START_PATH}`;
    return startPath === '/' ? `/${MIRROR_NAME}/` : `/${MIRROR_NAME}${startPath}`;
}

// 外层入口页由服务器注入当前配置。
// 这样 index.html 不需要写死网站名，也不需要先靠浏览器额外 fetch 才知道入口路径。
function serveStarterPage(res) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, text) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code}`);
            return;
        }

        const config = {
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        };

        const html = text.replace(
            'window.__MIRROR_CONFIG__ = null;',
            `window.__MIRROR_CONFIG__ = ${JSON.stringify(config)};`
        );

        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.html'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTargetHostName() {
    return new URL(TARGET_HOST).hostname;
}

function getLocalUrlPrefixForHost(host, slash) {
    const separator = slash === '\\/' ? '\\/' : '/';

    if (host === getTargetHostName()) {
        return `${separator}${MIRROR_NAME}${separator}`;
    }

    return `${separator}${MIRROR_NAME}${separator}${host}${separator}`;
}

// 重写所有明确写出来的外链前缀。
// 例子：
// https://cdn.example.com/a.js -> /当前镜像文件夹/cdn.example.com/a.js
// //cdn.example.com/a.js -> /当前镜像文件夹/cdn.example.com/a.js
// https://目标站/assets/a.js -> /当前镜像文件夹/assets/a.js
// 如果 JS 里是 https:\/\/cdn.example.com\/a.js，也保持转义斜杠形式。
function rewriteExternalUrlsForLocalMirror(text) {
    const plainUrl = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/)/gi;
    const escapedUrl = /\bhttps?:\\\/\\\/([a-z0-9.-]+\.[a-z]{2,})(\\\/)/gi;
    const protocolRelativeUrl = /(^|[^:])\/\/([a-z0-9.-]+\.[a-z]{2,})(\/)/gi;
    const escapedProtocolRelativeUrl = /(^|[^:])\\\/\\\/([a-z0-9.-]+\.[a-z]{2,})(\\\/)/gi;

    return text
        .replace(plainUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash))
        .replace(escapedUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash))
        .replace(protocolRelativeUrl, (match, prefix, host, slash) => `${prefix}${getLocalUrlPrefixForHost(host, slash)}`)
        .replace(escapedProtocolRelativeUrl, (match, prefix, host, slash) => `${prefix}${getLocalUrlPrefixForHost(host, slash)}`);
}

// 把页面里的远程 URL 改成本地镜像 URL。
// 例如 https://cdn.example.com/a.js -> /example-site.com/cdn.example.com/a.js。
function rewriteTextForLocalMirror(text) {
    const extGroup = REWRITE_ASSET_EXTS.join('|');
    const mirror = escapeRegExp(MIRROR_NAME);
    const assetUrl = new RegExp('https?:\\/\\/([^/"\\\'\\s)]+)(\\/[^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootAsset = new RegExp('(["\\\'(=])\\/(?!\\/|' + mirror + '\\/)([^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootRoute = new RegExp('(["\\\'=])\\/(?!\\/|' + mirror + '\\/)([a-z]{2}(?:-[a-z]{2})?(?:\\/[^"\\\'\\s<)]*)?)', 'gi');

    return rewriteExternalUrlsForLocalMirror(text)
        .replaceAll(TARGET_HOST, `/${MIRROR_NAME}`)
        .replace(assetUrl, (match, host, assetPath) => `/${MIRROR_NAME}/${host}${assetPath}`)
        .replace(rootAsset, (match, prefix, assetPath) => `${prefix}/${MIRROR_NAME}/${assetPath}`)
        .replace(rootRoute, (match, prefix, routePath) => `${prefix}/${MIRROR_NAME}/${routePath}`);
}

// 注入浏览器端兜底规则。
// 作用：有些按钮链接不是 HTML 里写死的，而是 JS 运行后才生成。
// 服务端文本替换抓不到这种情况，所以在页面里加一层点击/表单/window.open 拦截。
function getLocalNavigationInterceptorScript() {
    return `<script>
(function () {
    if (window.__MIRRORKIT_LINK_INTERCEPTOR__) return;
    window.__MIRRORKIT_LINK_INTERCEPTOR__ = true;

    var targetHost = ${JSON.stringify(getTargetHostName())};
    var mirrorName = ${JSON.stringify(MIRROR_NAME)};
    var localHost = window.location.hostname;
    var rewriteTimer = null;

    function isIgnoredUrl(url) {
        return !url || /^(mailto:|tel:|javascript:|data:|blob:|#)/i.test(url);
    }

    function toLocalUrl(url) {
        if (isIgnoredUrl(url)) return url;

        var parsed;
        try {
            parsed = new URL(url, window.location.href);
        } catch (err) {
            return url;
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;

        var fullPath = parsed.pathname + parsed.search + parsed.hash;
        var mirrorPrefix = '/' + mirrorName;

        if (parsed.hostname === localHost) {
            if (parsed.pathname === mirrorPrefix || parsed.pathname.indexOf(mirrorPrefix + '/') === 0) {
                return url;
            }

            return mirrorPrefix + fullPath;
        }

        if (parsed.hostname === targetHost) {
            return mirrorPrefix + fullPath;
        }

        return mirrorPrefix + '/' + parsed.hostname + fullPath;
    }

    function rewriteElement(element) {
        if (!element || !element.getAttribute) return;

        ['href', 'action'].forEach(function (attr) {
            var value = element.getAttribute(attr);
            var local = toLocalUrl(value);

            if (local && local !== value) {
                element.setAttribute(attr, local);
            }
        });
    }

    function rewritePageLinks() {
        document.querySelectorAll('a[href], form[action]').forEach(rewriteElement);
    }

    function scheduleRewrite() {
        if (rewriteTimer) return;

        rewriteTimer = window.setTimeout(function () {
            rewriteTimer = null;
            rewritePageLinks();
        }, 50);
    }

    document.addEventListener('click', function (event) {
        var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (!link) return;

        var href = link.getAttribute('href');
        var local = toLocalUrl(href);

        if (local && local !== href) {
            event.preventDefault();
            window.location.href = local;
        }
    }, true);

    document.addEventListener('submit', function (event) {
        var form = event.target;
        if (!form || !form.getAttribute) return;

        var action = form.getAttribute('action') || window.location.href;
        var local = toLocalUrl(action);

        if (local && local !== action) {
            form.setAttribute('action', local);
        }
    }, true);

    var nativeOpen = window.open;
    window.open = function (url, name, features) {
        return nativeOpen.call(window, toLocalUrl(url), name, features);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', rewritePageLinks);
    } else {
        rewritePageLinks();
    }

    if (window.MutationObserver && document.documentElement) {
        new MutationObserver(scheduleRewrite).observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
})();
</script>`;
}

function injectLocalNavigationInterceptor(text) {
    if (!isHtmlText(text) || text.includes('window.__MIRRORKIT_LINK_INTERCEPTOR__')) {
        return text;
    }

    const interceptor = getLocalNavigationInterceptorScript();

    if (/<\/head>/i.test(text)) {
        return text.replace(/<\/head>/i, `${interceptor}\n</head>`);
    }

    if (/<\/body>/i.test(text)) {
        return text.replace(/<\/body>/i, `${interceptor}\n</body>`);
    }

    return text;
}

function transformResponseForLocalMirror(filePath, data) {
    const ext = path.extname(filePath).toLowerCase();

    if (REWRITE_TEXT_EXTS.has(ext) || ext === '') {
        let text = rewriteTextForLocalMirror(data.toString('utf8'));

        if (ext !== '.css') {
            text = injectLocalNavigationInterceptor(text);
        }

        return Buffer.from(text);
    }

    if (EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext)) {
        return Buffer.from(rewriteExternalUrlsForLocalMirror(data.toString('utf8')));
    }

    return data;
}

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

function getRemoteMirror(reqPath) {
    return [...REMOTE_MIRRORS, ...BUILTIN_REMOTE_MIRRORS].find(mirror => reqPath.startsWith(mirror.prefix));
}

function getGoogleStorageTargetUrl(reqPath, search) {
    const parts = reqPath.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    if (parts[0] === 'storage.googleapis.com') {
        return `https://storage.googleapis.com/${parts.slice(1).join('/')}${search}`;
    }

    if (/^[a-z0-9-]+\.appspot\.com$/i.test(parts[0])) {
        return `https://storage.googleapis.com/${parts[0]}/${parts.slice(1).join('/')}${search}`;
    }

    return null;
}

// 根据请求路径生成真正要抓取的远程 URL。
function getTargetUrl(req, reqPath) {
    const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
    const targetPath = getTargetPathFromRequestPath(reqPath);
    const mirror = getRemoteMirror(targetPath);

    if (mirror) {
        return `${mirror.origin}${targetPath.slice(mirror.prefix.length - 1)}${requestUrl.search}`;
    }

    const gcsUrl = getGoogleStorageTargetUrl(targetPath, requestUrl.search);
    if (gcsUrl) return gcsUrl;

    const parts = targetPath.split('/').filter(Boolean);
    if (parts.length > 1 && looksLikeMirroredRemoteHost(parts[0]) && !SITE_PATH_PREFIXES.has(parts[0])) {
        return `https://${parts[0]}/${parts.slice(1).join('/')}${requestUrl.search}`;
    }

    return `${TARGET_HOST}${targetPath}${requestUrl.search}`;
}

async function proxyAndCache(req, res, localPath, reqPath) {
    const targetUrl = getTargetUrl(req, reqPath);
    console.log(`\x1b[33m[Cache Miss] ${req.url} -> ${targetUrl}\x1b[0m`);

    try {
        const response = await fetchWithTimeout(targetUrl);

        if (!response.ok) {
            console.error(`\x1b[31m[Failed] Origin status ${response.status}: ${req.url}\x1b[0m`);
            res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Origin responded with status: ${response.status}`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!isValidCachedResponse(localPath, response, buffer)) {
            const contentType = response.headers.get('content-type') || 'unknown';
            console.error(`\x1b[31m[Rejected] Not caching unexpected content for ${req.url} (${contentType})\x1b[0m`);
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Rejected unexpected content for ${req.url}`);
            return;
        }

        ensureDirExists(localPath);
        fs.writeFileSync(localPath, buffer);
        console.log(`\x1b[32m[Saved] ${localPath}\x1b[0m`);

        const responseBuffer = transformResponseForLocalMirror(localPath, buffer);

        res.writeHead(200, {
            'Content-Type': getContentType(localPath, responseBuffer),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(responseBuffer);
    } catch (err) {
        const status = err.name === 'AbortError' ? 504 : 500;
        console.error(`\x1b[31m[Error] ${req.url}: ${err.message}\x1b[0m`);
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy error: ${err.message}`);
    }
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    // 外层 / 永远打开框架说明页。
    // 目标站点入口请访问 /MIRROR_NAME/START_PATH，例如 /example.com/。
    const reqPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;

    // 给外层 index.html 用的运行时配置。
    // 这样启动页不用写死 /example.com/，会自动读取当前 server.js 顶部配置。
    if (reqPath === '/__mirror-config.json') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        }));
        return;
    }

    if (reqPath === '/index.html') {
        serveStarterPage(res);
        return;
    }

    if (IGNORED_PATH_PREFIXES.some(prefix => reqPath === prefix || reqPath.startsWith(prefix))) {
        res.writeHead(204);
        res.end();
        return;
    }

    const localPath = getLocalPath(reqPath);
    if (!localPath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    if (shouldServeNoopRemote(reqPath)) {
        serveNoopRemote(req, res, reqPath);
        return;
    }

    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        serveLocalFile(localPath, res);
        return;
    }

    await proxyAndCache(req, res, localPath, reqPath);
});

server.listen(PORT, () => {
    console.log('\n==========================================================');
    console.log('\x1b[36m  Offline Mirror - Local Proxy & Crawler Server\x1b[0m');
    console.log('==========================================================');
    console.log(`Target host: \x1b[32m${TARGET_HOST}\x1b[0m`);
    console.log(`Mirror folder: \x1b[32m${MIRROR_NAME}\x1b[0m`);
    console.log(`Local starter: \x1b[32mhttp://localhost:${PORT}/\x1b[0m`);
    console.log(`Mirror entry: \x1b[32mhttp://localhost:${PORT}${getMirrorEntryPath()}\x1b[0m`);
    console.log(`Request timeout: ${REQUEST_TIMEOUT_MS}ms`);
    console.log('Unexpected HTML fallback responses will not be cached as assets.');
    console.log('----------------------------------------------------------\n');

    const url = `http://localhost:${PORT}/`;
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} ${url}`, (err) => {
        if (err) console.error('Failed to auto-open browser:', err.message);
    });
});
