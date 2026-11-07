import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeWhiteboard } from './localize-whiteboard.mjs';
import {runtimeConfig,STATE_DIR} from './lib/runtime.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const state = STATE_DIR;
const cli = join(root, 'node_modules/@ansuman-shukla/whiteboard-mcp/dist/cli.js');
const args = process.argv.slice(2);
let session = 'classroom-demo';
const sessionAt = args.indexOf('--session');
if (sessionAt >= 0) {
  const value = args[sessionAt + 1];
  if (!value || value.startsWith('--') || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new Error('--session 后需要一个非空课程标识，例如 math-20261107-functions。');
  }
  session = value.trim();
  args.splice(sessionAt, 2);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`本地教学白板（共享存储，按课程选择白板）
用法：node whiteboard.mjs [--session <课程标识>] <command>

  call <tool> --file <JSON文件>   调用工具，UTF-8 JSON 可带 BOM
  call <tool>                    无参数调用
  tools --json                   查询实际工具与参数
  url [白板ID或标题]             取得完整本地网址
  status                        查看共享服务状态
  stop                          停止所有课程共用的服务
  mcp                           MCP stdio 模式（实时转发协议）

省略 --session 时连接原演示会话；正式上课请明确指定。
相对 --file 路径从本脚本目录解析，跨目录调用建议用绝对路径。
详见 docs/AGENT_INTEGRATION.md`);
  process.exit(0);
}

if (!['tools', 'status', 'stop', '--version'].includes(args[0])) localizeWhiteboard();

const mcpMode = args.length === 0 || args[0] === 'mcp';
let input;
const fileAt = args.indexOf('--file');
if (fileAt >= 0) {
  if (args[0] !== 'call' || fileAt !== 2 || !args[fileAt + 1] || args.length !== 4) {
    throw new Error('用法：call <tool> --file <JSON文件>');
  }
  input = readFileSync(resolve(root, args[fileAt + 1]), 'utf8').replace(/^\uFEFF/, '');
  JSON.parse(input);
  args.splice(fileAt, 2, '-');
}

const env = {
  ...process.env,
  WHITEBOARD_HOME: state,
  WHITEBOARD_WORKSPACE: runtimeConfig().workspace,
  WHITEBOARD_CHAT_ID: session,
  WHITEBOARD_PORT: String(runtimeConfig().whiteboardPort),
  WHITEBOARD_OPEN: 'none',
};

async function running() {
  try {
    const info = JSON.parse(readFileSync(join(state, 'daemon.json'), 'utf8'));
    const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = await res.json();
    return res.ok && body.app === 'whiteboard-mcp' && body.pid === info.pid;
  } catch { return false; }
}

if (!['tools', 'status', 'stop', '--help', '--version'].includes(args[0]) && !(await running())) {
  mkdirSync(state, { recursive: true });
  const child = spawn(process.execPath, [cli, 'serve'], {
    env, cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
  });
  let launchError;
  child.on('error', error => { launchError = error; });
  child.unref();
  const until = Date.now() + 8000;
  while (!(await running())) {
    if (launchError) throw launchError;
    if (Date.now() > until) throw new Error('白板未就绪，请检查 state/daemon.log');
    await new Promise(done => setTimeout(done, 100));
  }
}

if (mcpMode) {
  // MCP needs live stdin/stdout; buffering output until exit would block the handshake.
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env, cwd: root, windowsHide: true, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => done(code ?? 1));
  });
} else {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env, cwd: root, windowsHide: true,
    input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
