import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAnnotationReadSupport } from './annotation-read.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(ROOT, 'node_modules/@ansuman-shukla/whiteboard-mcp');
const FRONTEND = join(PACKAGE, 'dist/frontend');
const ENTRY = 'index-C70T-g4a.js';
const STYLE = 'index-BDd_Gh6U.css';
const ZH_ENTRY = 'zh-CN-LNUGB5OW-B1zcv0KF.js';
const ORIGINAL_HTML_SHA = '2ce4aec18d375b365fb70e9538b670bc8311b2e6d554ac5a9f8aad2c723a81b9';
const ORIGINAL_JS_SHA = '27467ab6c225fccba16ec49e34f70f61562d3a2380e53679ebb103398415c05a';
const sha = value => createHash('sha256').update(value).digest('hex');

// Windows' system font "Segoe UI Emoji" carries a broken character map for some math symbols
// (√ shows as Ã, ≠ as "-", ∞ as °; the bytes are Mac Roman code points read as Latin-1).
// Excalidraw puts it LAST in every canvas font stack, and Chrome believes it has those glyphs,
// so no later font is tried. Re-declaring it here, limited to emoji/pictograph ranges, makes the
// browser use it only for real emoji; math symbols then fall through to a font that draws them right.
const GLYPH_FIX_RANGES = 'U+00A9,U+00AE,U+203C,U+2049,U+2122,U+2139,U+2194-21AA,U+231A-23FF,U+24C2,U+25AA-25FE,U+2600-27BF,U+2934-2935,U+2B05-2B55,U+3030,U+303D,U+3297,U+3299,U+FE0F,U+200D,U+20E3,U+1F000-1FAFF,U+E0020-E007F';
const GLYPH_FIX_STYLE = `<style id="study-glyph-fix">@font-face{font-family:"Segoe UI Emoji";src:local("Segoe UI Emoji");unicode-range:${GLYPH_FIX_RANGES};}</style>\n  </head>`;

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`汉化定位不唯一，已停止：${before}`);
  return source.replace(before, after);
}

export function localizeWhiteboard() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
  if (pkg.version !== '0.3.5') throw new Error('白板版本已变化，先核对汉化脚本，不能直接套用 0.3.5 补丁。');
  const originalJs = readFileSync(join(FRONTEND, 'assets', ENTRY), 'utf8');
  if (sha(originalJs) !== ORIGINAL_JS_SHA) throw new Error('白板原始入口与固定版本不一致，未改动文件。');
  const htmlPath = join(FRONTEND, 'index.html');
  const currentHtml = readFileSync(htmlPath, 'utf8');
  const backup = join(ROOT, 'state/frontend-original/whiteboard-mcp-0.3.5/index.html');
  const originalHtml = existsSync(backup) ? readFileSync(backup, 'utf8') : currentHtml;
  if (sha(originalHtml) !== ORIGINAL_HTML_SHA) throw new Error('白板原始 HTML 与固定版本不一致，未改动文件。');

  // Only alter the host app UI. Protocol names and Excalidraw's original bundles stay intact.
  const boundary = 'const ese="M19 21H5a2';
  const at = originalJs.indexOf(boundary);
  if (at < 0) throw new Error('找不到白板宿主界面，未改动文件。');
  let app = originalJs.slice(at);
  app = replaceOnce(app, 'p.jsxs(NT,{excalidrawAPI:l,theme:a,', 'p.jsxs(NT,{excalidrawAPI:l,langCode:"zh-CN",theme:a,');
  const words = [
    ['Name this board…', '给白板副本起个名字…'],
    ['Board name', '白板名称'],
    ['Later chats can find it', '其他老师可查找这个白板副本'],
    ['Saving…', '正在保存…'],
    ['Save', '保存'],
    ['connecting…', '正在连接…'],
    ['live', '已连接'],
    ['reconnecting…', '正在重连…'],
    ['server stopped — ask your agent to open the board', '服务已停止，请让老师重新打开白板'],
    ['Waiting for the canvas daemon', '正在等待白板服务'],
    ['Connected to the canvas', '已连接到共享白板'],
    ["Whiteboard MCP's background process isn't running (after a restart, or it was stopped). Your agent starts it again; this tab then reconnects by itself.", '白板后台未运行。请启动电脑上的白板入口，页面会自动重连。'],
    ['offline — not sent', '当前未连接，留言未发送'],
    ['sent to agent ✓', '留言已发送，请在聊天中提醒老师查看 ✓'],
    ['Following the agent: new drawings scroll into view', '跟随老师：自动显示新板书'],
    ['Not following the agent', '未跟随老师：保持当前视野'],
    ['Note to agent', '给老师留言（发送后请在聊天中提醒查看）'],
    ['Note', '留言'],
    ['Note to agent…', '给老师留言…'],
    ['⌘/Ctrl + Enter', 'Ctrl/⌘ + Enter 发送'],
    ['Send', '发送'],
    ['No canvas in this link — open it from your agent.', '链接中没有白板，请使用老师给出的完整白板链接。'],
    ['Save to library', '保存白板副本'],
    ['Your agent will draw here — you can draw too.', '老师会在这里画板书，你也可以一起写画。'],
  ];
  for (const [en, zh] of words) {
    const from = JSON.stringify(en), to = JSON.stringify(zh);
    if (!app.includes(from)) throw new Error(`找不到待翻译文字：${en}`);
    app = app.split(from).join(to);
  }
  app = replaceOnce(app, '`${t} viewers on this canvas`', '`当前有 ${t} 个窗口连接此白板`');
  app = replaceOnce(app, '`Saved "${D.name}". Any chat can find it with canvas_search.`', '`已保存“${D.name}”，其他老师可查找这个白板副本。`');
  app = replaceOnce(app, '`Not saved: ${D instanceof Error?D.message:String(D)}`', '`保存失败：${({offline:"白板未连接","connection lost":"连接已中断","timed out":"请求超时","already saving":"正在保存，请稍候"})[D instanceof Error?D.message:String(D)]??(D instanceof Error?D.message:String(D))}`');
  app = replaceOnce(app, 'function mse(){', 'const __StudyAnnotations=__createAnnotationUI(I,Zp,ie,lt),__StudyMouseTools=__createMouseToolUI(I);function mse(){');
  app = replaceOnce(app, 'p.jsxs(Use,{children:[L,v&&p.jsx(tse,{initialName:U,onSave:M,onClose:w})]})', 'p.jsxs(Use,{children:[L,v&&p.jsx(tse,{initialName:U,onSave:M,onClose:w}),p.jsx(__StudyAnnotations,{api:i,connected:s==="live",onNote:N=>E.current?.sendNote(N)??!1}),p.jsx(__StudyMouseTools,{api:i})]})');
  const annotationUi = readFileSync(join(ROOT, 'whiteboard-annotations.mjs'), 'utf8');
  const mouseToolsUi = readFileSync(join(ROOT, 'whiteboard-mouse-tools.mjs'), 'utf8');
  const localizedJs = 'import {createMouseToolUI as __createMouseToolUI} from "./study-mouse-tools.js";\nimport {createAnnotationUI as __createAnnotationUI} from "./study-annotations.js";\n' + originalJs.slice(0, at) + app;
  const extra = JSON.parse(readFileSync(join(ROOT, 'whiteboard-zh-CN-extra.json'), 'utf8'));
  const originalZh = readFileSync(join(FRONTEND, 'assets', ZH_ENTRY), 'utf8');
  const zhExport = originalZh.match(/export\{[^}]+\};?\s*$/);
  if (!zhExport || !zhExport[0].includes('x as default')) throw new Error('中文语言包结构发生变化，未改动文件。');
  for (const key of Object.keys(extra)) {
    if (key.split('.').some(part => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('无效翻译键：' + key);
    if (typeof extra[key] !== 'string') throw new Error('翻译必须为文本：' + key);
  }
  const additions = `const __studyZhExtra=${JSON.stringify(extra)};for(const[key,value]of Object.entries(__studyZhExtra)){const parts=key.split('.');let target=x;for(const part of parts.slice(0,-1))target=target[part]??(target[part]={});target[parts.at(-1)]=value;}`;
  // Excalidraw reads named section exports, including sections absent in the older
  // upstream zh-CN file. Updating only its default object would leave these English.
  const exported = new Set([...zhExport[0].matchAll(/\bas (\w+)/g)].map(match => match[1]));
  const newSections = [...new Set(Object.keys(extra).map(key => key.split('.')[0]))].filter(key => !exported.has(key));
  const sectionVars = newSections.map(key => `const __studySection_${key}=x.${key};`).join('');
  const sectionExports = newSections.map(key => `__studySection_${key} as ${key}`).join(',');
  const exports = sectionExports ? zhExport[0].replace('};', `,${sectionExports}};`) : zhExport[0];
  const localizedZh = originalZh.slice(0, zhExport.index) + additions + sectionVars + exports;
  // A new directory gives EVERY relative module import a new URL. This avoids stale
  // immutable assets and duplicate React modules without changing server cache rules.
  const assetFolder = `zh-CN-${sha(localizedJs + localizedZh + annotationUi + mouseToolsUi).slice(0, 12)}`;
  const assetDirectory = `assets/${assetFolder}`;
  let html = replaceOnce(originalHtml, '<html lang="en">', '<html lang="zh-CN">');
  html = replaceOnce(html, '<title>Whiteboard</title>', '<title>教学白板</title>');
  html = replaceOnce(html, '</head>', GLYPH_FIX_STYLE);
  html = replaceOnce(html, `./assets/${ENTRY}`, `./${assetDirectory}/${ENTRY}`);
  html = replaceOnce(html, `./assets/${STYLE}`, `./${assetDirectory}/${STYLE}`);
  if (currentHtml !== originalHtml && currentHtml !== html && !/<html lang="zh-CN">[\s\S]*\.\/assets\/zh-CN-[a-f0-9]{12}\//.test(currentHtml)) {
    throw new Error('白板 HTML 存在其他修改，未覆盖。');
  }
  const destination = join(FRONTEND, 'assets', assetFolder);
  const result = { locale: 'zh-CN', upstreamVersion: pkg.version, assetDirectory };
  installAnnotationReadSupport();
  if (currentHtml === html && existsSync(join(destination, ENTRY)) && existsSync(join(destination, ZH_ENTRY)) && existsSync(join(destination, 'study-annotations.js')) && sha(readFileSync(join(destination, ENTRY))) === sha(localizedJs) && sha(readFileSync(join(destination, ZH_ENTRY))) === sha(localizedZh) && sha(readFileSync(join(destination, 'study-annotations.js'))) === sha(annotationUi) && existsSync(join(destination, 'study-mouse-tools.js')) && sha(readFileSync(join(destination, 'study-mouse-tools.js'))) === sha(mouseToolsUi)) return result;
  mkdirSync(dirname(backup), { recursive: true });
  if (!existsSync(backup)) writeFileSync(backup, originalHtml, 'utf8');
  const originalAssets = readdirSync(join(FRONTEND, 'assets'), { withFileTypes: true }).filter(entry => entry.isFile());
  mkdirSync(destination, { recursive: true });
  for (const entry of originalAssets) copyFileSync(join(FRONTEND, 'assets', entry.name), join(destination, entry.name));
  writeFileSync(join(destination, ENTRY), localizedJs, 'utf8');
  writeFileSync(join(destination, ZH_ENTRY), localizedZh, 'utf8');
  writeFileSync(join(destination, 'study-annotations.js'), annotationUi, 'utf8');
  writeFileSync(join(destination, 'study-mouse-tools.js'), mouseToolsUi, 'utf8');
  // Original assets remain available to already-open tabs; no board data is edited.
  const temp = htmlPath + '.study-zh.tmp';
  writeFileSync(temp, html, 'utf8');
  renameSync(temp, htmlPath);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(localizeWhiteboard()));
}
