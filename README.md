# MirrorKit 使用说明

[中文](README.md) | [English](README_EN.md)

## 开源协议

本项目使用 GNU Affero General Public License v3.0 or later。

```text
SPDX-License-Identifier: AGPL-3.0-or-later
```

你可以复制、分发和修改本项目代码，但修改版也必须以相同协议开源。

如果你把修改版部署成网络服务供他人使用，也必须向使用者提供对应源码。

注意：本协议只覆盖本项目工具代码，不覆盖通过本工具下载到本地的第三方网站资源。

## 免责声明

本项目仅供学习研究、技术交流和本地测试使用，请勿用于任何违法违规用途。

本工具只是模拟镜像站的本地研究工具，并非目标网站的完整复制版本，也不代表目标网站官方内容。

通过本工具下载到本地的所有资源，仅限个人学习研究和本地测试。未经授权，不得对下载资源进行二次上传、公开传播、分发、商用或用于搭建公开镜像站；此类行为可能构成侵权或违法。

使用者应自行确认目标网站的版权、服务条款、访问限制和当地法律法规。禁止将本项目用于未授权复制、传播、商用、绕过访问控制、侵犯版权、侵犯隐私、攻击网站或其他不当行为。

因使用本项目产生的任何风险、损失、法律责任或第三方纠纷，均由使用者自行承担，项目作者不承担任何责任。

这是一个网页本地镜像框架。

目标规则：

```text
所有资源先走本地
本地没有，再去远程请求
请求成功后，缓存到本地
以后再访问，直接读本地
```

外层 `index.html` 只是启动页，不保存目标网站首页。目标网站内容都会放进一个独立文件夹里，例如：

```text
项目文件夹/
├─ index.html
├─ server.js
├─ tools/
└─ example-site.com/
   ├─ index.html
   ├─ assets/
   └─ ...
```

项目外层文件夹叫什么都可以，不影响代码。

## 零、运行依赖

本项目需要安装：

```text
Node.js 18 或更高版本
现代浏览器，例如 Chrome、Edge、Firefox
```

原因：

```text
server.js 和 tools 里的脚本都用 Node.js 运行
下载远程资源时使用 Node.js 内置 fetch
fetch 从 Node.js 18 开始内置，低版本 Node 可能无法运行
```

检查 Node.js 版本：

```bat
node -v
```

如果显示类似下面这样，就可以用：

```text
v18.x.x
v20.x.x
v22.x.x
```

本项目没有额外 npm 依赖，不需要运行：

```bat
npm install
```

只要 Node.js 版本够，直接运行即可：

```bat
node server.js
```

或者双击：

```text
一键启动服务器.bat
```

## 一、换网站要改哪里

换网站有两种方式：

```text
方式 A：运行命令时用环境变量临时指定网站，不改代码
方式 B：直接修改两个文件顶部配置
```

如果只是临时测试一个网站，推荐先用方式 A。

### 方式 A：用环境变量临时换站

这种方式不需要改 `server.js` 和 `tools/mirror-assets.js`，只在当前命令窗口生效。

CMD 示例：

```bat
set TARGET_HOST=https://example.com
set MIRROR_NAME=example.com
set START_PATH=/
node server.js
```

批量下载也可以这样：

```bat
set TARGET_HOST=https://example.com
set MIRROR_NAME=example.com
set START_PATH=/
node tools\mirror-assets.js
```

如果入口不是首页，而是某个路径，例如：

```text
https://example.com/example-path
```

就把 `START_PATH` 写成：

```bat
set START_PATH=/example-path
```

如果要运行隐藏媒体补充工具，并且目标站有单独的远程媒体桶，可以额外指定：

```bat
set CMS_MEDIA_HOST=https://storage.example.com/example-bucket
node tools\mirror-cms-media.js
```

这种方式适合反复测试不同网站，因为代码默认配置不用来回改。

### 方式 B：修改文件顶部配置

如果你想把某个网站固定成默认目标，再改两个文件顶部配置：

```text
server.js
tools/mirror-assets.js
```

这两个文件里的配置要保持一致。

### 1. TARGET_HOST

目标网站域名，只写协议 + 域名，不要带最后的 `/`。

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';
```

改成你要扒的网站：

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://www.xxx.com';
```

### 2. MIRROR_NAME

本地保存文件夹名。

```js
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';
```

例如：

```js
const MIRROR_NAME = process.env.MIRROR_NAME || 'xxx.com';
```

下载内容会保存到：

```text
项目文件夹/xxx.com/
```

### 3. START_PATH

目标网站入口路径。

如果网站首页就是：

```text
https://www.xxx.com/
```

就写：

```js
const START_PATH = process.env.START_PATH || '/';
```

如果入口是：

```text
https://www.xxx.com/zh
```

就写：

```js
const START_PATH = process.env.START_PATH || '/zh';
```

访问镜像时用：

```text
http://localhost:3000/<MIRROR_NAME><START_PATH>
```

例如：

```text
http://localhost:3000/xxx.com/
http://localhost:3000/xxx.com/zh
```

## 二、工具怎么用

工具都在 `tools/` 文件夹里。

### 1. server.js

用途：启动本地服务器。

它负责：

```text
打开本地镜像
优先读取本地文件
本地没有时去远程下载
下载成功后保存本地
把页面里的外链改成本地镜像路径
```

运行：

```bat
node server.js
```

或者双击：

```text
一键启动服务器.bat
```

打开：

```text
http://localhost:3000/
```

外层启动页会自动显示当前配置的入口。

### 2. tools\mirror-assets.js

用途：通用批量下载。

适合下载普通网站资源：

```text
HTML
CSS
JS
JSON
图片
字体
普通视频文件
wasm
压缩纹理
```

运行：

```bat
node tools\mirror-assets.js
```

如果想重新检查坏缓存：

```bat
node tools\mirror-assets.js --retry-bad
```

一般换网站后，先跑这个。

### 3. tools\mirror-cms-media.js

用途：补充下载隐藏媒体。

有些网站的视频、图片不直接写在 HTML 里，而是藏在：

```text
CMS JSON
远程存储桶
app 缓存号文件
运行时数据文件
```

这种情况下，普通 `mirror-assets.js` 可能扫不到，就跑这个补充脚本。

运行：

```bat
node tools\mirror-cms-media.js
```

重新检查坏缓存：

```bat
node tools\mirror-cms-media.js --retry-bad
```

这个脚本也有顶部配置：

```js
const TARGET_HOST = process.env.TARGET_HOST || 'https://example.com';
const MIRROR_NAME = process.env.MIRROR_NAME || 'example.com';
const CMS_HOST = process.env.CMS_MEDIA_HOST || 'https://storage.example.com/example-bucket';
```

如果新网站没有 CMS / 远程媒体桶，不用跑这个。

如果新网站有类似的远程媒体桶，就把 `CMS_HOST` 改成对应地址。

### 4. tools\find-video-refs.js

用途：查本地文本文件里有没有视频链接。

运行：

```bat
node tools\find-video-refs.js
```

它只查引用，不下载。

能帮你判断视频链接藏在哪个文件里。

### 5. tools\validate-assets.js

用途：检查本地资源有没有坏缓存。

运行：

```bat
node tools\validate-assets.js
```

它会检查有没有把 HTML 错误页误保存成图片、JSON、字体等资源。

## 三、推荐流程

### 普通网站

```bat
node tools\mirror-assets.js
node server.js
```

然后打开：

```text
http://localhost:3000/
```

### 有隐藏视频 / CMS 数据的网站

```bat
node tools\mirror-assets.js
node tools\mirror-cms-media.js
node server.js
```

然后打开：

```text
http://localhost:3000/
```

### 只想边打开边自动补资源

直接启动服务器：

```bat
node server.js
```

然后在网页里操作、滚动、进入详情页。

服务器看到缺失资源，会自动下载。

注意：如果网页里的地址是完整外链，例如：

```text
https://cdn.xxx.com/a.mp4
```

服务器会把它改成本地镜像路径：

```text
/xxx.com/cdn.xxx.com/a.mp4
```

这样浏览器会先问本地服务器，本地没有时才去远程缓存。

## 四、什么时候需要改更多规则

一般只改：

```text
TARGET_HOST
MIRROR_NAME
START_PATH
```

只有下面情况才改别的。

### 1. 缺少某种扩展名

位置：

```text
tools/mirror-assets.js
tools/mirror-cms-media.js
```

改：

```js
const ASSET_EXTS = [
    ...
];
```

例如网站有：

```text
.glb
.gltf
.pdf
.m3u8
.ts
.m4s
```

就加进去。

### 2. 有特殊 CMS / 远程媒体桶

位置：

```text
tools/mirror-cms-media.js
```

改：

```js
const CMS_HOST = process.env.CMS_MEDIA_HOST || 'https://storage.example.com/example-bucket';
```

### 3. 有多个入口页

位置：

```text
tools/mirror-assets.js
```

改：

```js
const SEED_URLS = [
    START_PATH,
    '/about',
    '/work',
    '/contact'
];
```

### 4. 某些路径带点但不是域名

位置：

```text
server.js
```

改：

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

例如：

```text
/etc.clientlibs/xxx.js
```

虽然有点，但它是站内路径，不是远程域名。

## 五、重新扒一个网站

如果想清掉当前镜像重新下载：

1. 关闭服务器窗口。
2. 删除当前镜像文件夹，例如：

```text
xxx.com/
```

3. 确认两个文件顶部配置一致：

```text
server.js
tools/mirror-assets.js
```

4. 重新运行：

```bat
node tools\mirror-assets.js
node server.js
```

如果需要隐藏媒体：

```bat
node tools\mirror-cms-media.js
```


## 六、常见问题

### 1. 打开页面变成下载文件

通常是无扩展名页面没有保存成 `index.html`。

现在服务器会把这种路径：

```text
/about
```

保存成：

```text
<MIRROR_NAME>/about/index.html
```

### 2. 视频已经下载，本地断网还是播不了

通常是网页还在请求外网完整地址。

现在服务器会把外链改成本地镜像路径。如果改完后仍然不行：

```text
重启服务器
Ctrl + F5 强制刷新页面
确认视频文件确实在镜像文件夹里
```

### 3. 日志出现 Rejected unexpected content

意思是远程返回的内容不像目标资源。

例如请求的是：

```text
.jpg
.js
.json
```

但远程实际返回：

```text
text/html
```

这通常是 404、跳转页、fallback 页面。脚本拒绝缓存是正常保护。

### 4. 菜单、轮播、弹窗点不开

先确认：

```text
改完 server.js 后重启服务器
浏览器 Ctrl + F5 强制刷新
打开控制台看 JS 报错
```

注意：不要粗暴重写整个 JS。现在服务器只做外链前缀替换，避免破坏压缩 JS。

## 七、编码注意

所有包含中文注释的文件都保持 UTF-8。

不要用 PowerShell 重定向写中文文件，例如：

```bat
echo 中文 > README.md
```

这种方式容易把中文写坏。
