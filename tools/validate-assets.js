const fs = require('fs');
const path = require('path');

// ROOT：项目根目录。
const ROOT = path.resolve(__dirname, '..');

// 默认只检查 assets 目录。
// 如果你换网站后资源目录不是 assets，可以改这里，或者复制一份检查逻辑。
const ASSETS_DIR = path.join(ROOT, 'assets');

// 二进制资源文件头校验表。
// 这些格式如果文件头不对，基本可以判断是坏缓存。
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

// JSON 要单独 parse；文本文件不需要二进制文件头校验。
const JSON_EXTS = new Set(['.json']);
const TEXT_EXTS = new Set(['.html', '.js', '.css', '.svg', '.txt']);

// 兼容兜底白名单。
// 有些项目会故意用“扩展名不匹配但浏览器能解码”的资源，可以把相对路径加到这里。
// 默认空数组，避免误放过坏文件。
const COMPATIBLE_FALLBACKS = new Set([]);

// 递归列出目录下所有文件。
function walk(dir, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, output);
        } else {
            output.push(fullPath);
        }
    }
    return output;
}

// 判断文件内容是不是 HTML。
// 如果图片/模型/JSON 内容其实是 HTML，通常说明之前把错误页缓存下来了。
function isHtmlLike(buffer) {
    const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<title>');
}

// 检查文件头。
function hasMagic(buffer, magic) {
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

// 校验单个文件。
// 返回 null 表示没问题；返回字符串表示坏文件原因。
function validateFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');

    if (!TEXT_EXTS.has(ext) && isHtmlLike(buffer)) {
        return 'html-fallback';
    }

    if (JSON_EXTS.has(ext)) {
        try {
            JSON.parse(buffer.toString('utf8'));
        } catch {
            return 'invalid-json';
        }
    }

    const magic = MAGIC_BYTES[ext];
    if (magic && COMPATIBLE_FALLBACKS.has(relativePath)) {
        return null;
    }

    if (magic && !hasMagic(buffer, magic)) {
        return 'bad-magic';
    }

    return null;
}

// 主流程：扫描 assets，输出所有坏缓存。
function main() {
    if (!fs.existsSync(ASSETS_DIR)) {
        console.error('assets directory not found');
        process.exit(1);
    }

    const bad = [];
    for (const filePath of walk(ASSETS_DIR)) {
        const reason = validateFile(filePath);
        if (reason) {
            bad.push({ reason, filePath });
        }
    }

    if (!bad.length) {
        console.log('No invalid cached assets found.');
        return;
    }

    for (const item of bad) {
        console.log(`${item.reason}\t${path.relative(ROOT, item.filePath)}`);
    }
    console.log(`\nInvalid cached assets: ${bad.length}`);
    process.exitCode = 2;
}

main();
