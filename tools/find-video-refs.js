const fs = require('fs');
const path = require('path');

// ROOT：项目根目录。
const ROOT = path.resolve(__dirname, '..');

// 视频引用匹配规则。
// 只查常见网页视频格式；如果网站用 mpeg-dash 或其他扩展名，可以加到这里。
const VIDEO_RE = /["'`]([^"'`]+?\.(?:mp4|webm|mov|m3u8)(?:\?[^"'`]*)?)["'`]/gi;

// 只扫描文本类文件，避免把二进制资源当文本读。
const TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.txt']);

// 递归列出目录文件。
// node_modules 通常很大且不是目标站资源，所以跳过。
function walk(dir, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, output);
        else output.push(fullPath);
    }
    return output;
}

// 主流程：扫描项目文本文件，输出视频 URL 或路径。
for (const filePath of walk(ROOT)) {
    if (filePath.includes(`${path.sep}tools${path.sep}`)) continue;
    if (!TEXT_EXTS.has(path.extname(filePath).toLowerCase())) continue;

    const text = fs.readFileSync(filePath, 'utf8');
    const matches = [...new Set([...text.matchAll(VIDEO_RE)].map(match => match[1]))];
    if (!matches.length) continue;

    console.log(`\n${path.relative(ROOT, filePath)}: ${matches.length}`);
    for (const item of matches.slice(0, 200)) {
        console.log(item);
    }
}
