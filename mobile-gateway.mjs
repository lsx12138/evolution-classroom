import http from 'node:http';
import {runtimeConfig,STATE_DIR} from './lib/runtime.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, ToolContext, getTool, callTool } from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/mcp/tools.js';
import { Session } from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/mcp/session.js';
import { parseViewerPath } from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/shared/protocol.js';
import { validate } from './node_modules/@ansuman-shukla/whiteboard-mcp/dist/mcp/schema.js';
import { StudyStore, studyTools } from './workspace-store.mjs';
import { ClassroomBridge, createClassroomRoutes } from './chat/bridge.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest();
const jsonResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
const errorResult = error => ({ isError: true, content: [{ type: 'text', text: error.message }] });
const BODY_LIMIT = 256 * 1024;

export function createGateway(config) {
  const workspace = resolve(config.workspace);
  const state = resolve(config.state);
  const publicOrigin = new URL(config.publicOrigin).origin;
  const port = config.port ?? 47429;
  const localOrigin = `http://127.0.0.1:${port}`;
  const allowedHosts = new Set([new URL(publicOrigin).host, `127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([publicOrigin, localOrigin, `http://localhost:${port}`]);
  const token = readFileSync(join(state, 'token'), 'utf8').trim();
  const tokenDigest = digest(token);
  const store = new StudyStore(workspace, state, config.study);
  const defaultLesson = config.defaultLesson ?? 'classroom-demo';
  const events = [];
  const schemas = [
    ...TOOLS.map(({ name, description, inputSchema }) => ({ name, description,
      inputSchema: { ...inputSchema, properties: { ...inputSchema.properties, lesson: { type: 'string', description: '课程标识；与电脑 CLI --session 对应，每次调用沿用同一值。省略时为演示会话。' } } } })),
    ...studyTools,
  ];
  const matches = value => typeof value === 'string' && timingSafeEqual(digest(value), tokenDigest);
  const auth = req => matches(req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
  const peer = req => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
  function observed(req, kind) {
    events.push({ time: new Date().toISOString(), kind, peer: peer(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0,160) });
    if (events.length > 40) events.shift();
  }
  function backend() {
    const info = JSON.parse(readFileSync(join(state, 'daemon.json'), 'utf8'));
    return { port: info.port, origin: `http://127.0.0.1:${info.port}` };
  }
  function send(res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > BODY_LIMIT) throw new Error('请求体超过 256 KiB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  function guard(req) {
    if (!allowedHosts.has(req.headers.host)) return false;
    return req.headers.origin === undefined || allowedOrigins.has(req.headers.origin);
  }
  async function run(name, raw = {}, lessonOverride) {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工具参数需为 JSON 对象');
      const schema = schemas.find(t => t.name === name);
      if (!schema) throw new Error('未知工具');
      const invalid = validate(schema.inputSchema, raw);
      if (invalid) throw new Error(`参数错误：${invalid}`);
      if (name.startsWith('study_')) return jsonResult(await store.call(name, raw));
      const { lesson: requestedLesson, ...args } = raw;
      const lesson = requestedLesson ?? lessonOverride ?? defaultLesson;
      if (typeof lesson !== 'string' || !lesson.trim() || lesson.length > 256 || /[\r\n\0]/.test(lesson)) throw new Error('无效课程标识');
      if (name === 'canvas_open') args.open = false;
      if (name === 'canvas_export') {
        const filename = basename(String(args.path ?? ''));
        if (!/\.(excalidraw|png)$/i.test(filename)) throw new Error('远程导出只接受 .excalidraw 或 .png');
        args.path = join(ROOT, 'exports', filename);
      }
      // Persistent sessions share the same board mapping/cursors as the desktop CLI.
      const ctx = new ToolContext(new Session(workspace, true), { autoStart: false });
      const result = await callTool(getTool(name), args, ctx, { chatId: lesson });
      const internal = backend().origin;
      for (const part of result.content) {
        if (part.type === 'text') part.text = part.text.split(internal).join(publicOrigin);
      }
      return result;
    } catch (error) { return errorResult(error); }
  }
  function proxy(req, res) {
    const back = backend();
    const headers = { ...req.headers, host: `127.0.0.1:${back.port}` };
    if (headers.origin !== undefined) headers.origin = back.origin;
    const upstream = http.request({ hostname: '127.0.0.1', port: back.port, path: req.url, method: req.method, headers }, reply => {
      const html = reply.headers['content-type']?.includes('text/html');
      if (!html) { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); return; }
      const chunks = [];
      reply.on('data', c => chunks.push(c));
      reply.on('end', () => {
        // A phone must reconnect through Tailscale, never to its own localhost fallback.
        const content = Buffer.from(Buffer.concat(chunks).toString('utf8').replace(/<meta name="whiteboard-direct"[^>]*>/g, ''));
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': content.length, 'cache-control': 'no-store' });
        res.end(content);
      });
    });
    upstream.on('error', () => { if (!res.headersSent) send(res, 502, { error: '白板后台暂不可用' }); else res.destroy(); });
    req.pipe(upstream);
  }
  async function mcp(req, res, parsed) {
    const server = new Server({ name: 'study-whiteboard-shared', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: schemas }));
    server.setRequestHandler(CallToolRequestSchema, async request => run(request.params.name, request.params.arguments));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  }
  const classroom = new ClassroomBridge({ state, workspace, ...(config.classroomAdapters ? {adapters: config.classroomAdapters} : {}), boardLookup: async id => {
    const response = await fetch(backend().origin + '/api/canvases', {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('无法读取共享白板。');
    return (await response.json()).find(board => board.id === id);
  }});
  const classroomRoutes = createClassroomRoutes(classroom, {matches,auth,body,send,observed});
  const server = http.createServer(async (req, res) => {
    try {
      if (!guard(req)) return send(res, 403, { error: '来源不允许' });
      const url = new URL(req.url, localOrigin);
      if (url.pathname === '/health') {
        let upstreamReady = false;
        try {
          const info = JSON.parse(readFileSync(join(state, 'daemon.json'), 'utf8'));
          const response = await fetch(`http://127.0.0.1:${info.port}/health`, { signal: AbortSignal.timeout(2000) });
          const health = await response.json();
          upstreamReady = response.ok && health.app === 'whiteboard-mcp' && health.pid === info.pid;
        } catch { }
        return send(res, upstreamReady ? 200 : 503, { ok: upstreamReady, app: 'study-whiteboard-gateway', version: '1.3.1', tools: schemas.length, upstreamReady, classroomChat:true });
      }
      if (await classroomRoutes(req, res, url)) return;
      const viewer = parseViewerPath(url.pathname);
      if (viewer) {
        if (!matches(viewer.token)) return send(res, 401, { error: '无效白板访问凭据' });
        if (viewer.rest === '') observed(req, 'viewer-page');
        return proxy(req, res);
      }
      const download = /^\/mobile\/([^/]+)\/(setup\.txt|study-client\.py|study-client\.json|study-mobile\.zip|classroom\.apk)$/.exec(url.pathname);
      if (download) {
        if (!matches(download[1])) return send(res, 401, { error: '需要手机接入凭据' });
        const filename = download[2];
        observed(req, `mobile-download:${filename}`);
        const source = filename === 'study-client.py' ? join(ROOT, filename) : join(state, 'mobile', filename);
        const data = await readFile(source);
        const binaryType = filename.endsWith('.apk') ? 'application/vnd.android.package-archive' : filename.endsWith('.zip') ? 'application/zip' : 'text/plain; charset=utf-8';
        const attachment = filename.endsWith('.apk') ? 'evolution-classroom.apk' : filename.endsWith('.zip') ? 'study-mobile.zip' : null;
        res.writeHead(200, { 'Content-Type': binaryType, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...(attachment ? {'Content-Disposition':`attachment; filename="${attachment}"`} : {}) });
        return res.end(data);
      }
      if (!auth(req)) return send(res, 401, { error: '需要 Bearer Token' });
      if (url.pathname === '/agent/tools' && req.method === 'GET') return send(res, 200, { tools: schemas });
      if (url.pathname === '/agent/status' && req.method === 'GET') return send(res, 200, { ok: true, events });
      if (url.pathname === '/agent/call' && req.method === 'POST') {
        const payload = await body(req);
        observed(req, `cli:${payload.name}`);
        return send(res, 200, await run(payload.name, payload.arguments ?? {}, payload.lesson));
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'MCP 使用 httpStream POST' });
        const parsed = await body(req);
        observed(req, `mcp:${parsed.method}`);
        return await mcp(req, res, parsed);
      }
      if (url.pathname.startsWith('/api/')) return proxy(req, res);
      return send(res, 404, { error: '使用完整白板网址、/mcp 或 /agent/call' });
    } catch (error) {
      if (!res.headersSent) send(res, 400, { error: error.message }); else res.destroy();
    }
  });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const reject = code => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`); };
    if (!guard(req)) return reject(403);
    const url = new URL(req.url, localOrigin);
    const viewer = parseViewerPath(url.pathname);
    if (!viewer || viewer.rest !== 'ws') return reject(404);
    if (!matches(viewer.token)) return reject(401);
    const back = backend();
    const headers = { ...req.headers, host: `127.0.0.1:${back.port}` };
    if (headers.origin !== undefined) headers.origin = back.origin;
    const upstream = http.request({ hostname: '127.0.0.1', port: back.port, path: req.url, headers });
    upstream.on('upgrade', (reply, wire, upstreamHead) => {
      observed(req, 'viewer-websocket');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) wire.write(head);
      wire.pipe(socket); socket.pipe(wire);
      wire.on('error', () => socket.destroy()); socket.on('close', () => wire.destroy()); wire.on('close', () => socket.destroy());
    });
    upstream.on('response', reply => reject(reply.statusCode));
    upstream.on('error', () => reject(502));
    upstream.end();
  });
  server.on('close', () => classroom.close());
  return { server, run, schemas, store, events, classroom };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const state = STATE_DIR;
  const config = runtimeConfig();
  process.env.WHITEBOARD_HOME = state;
  process.env.WHITEBOARD_WORKSPACE = config.workspace;
  process.env.WHITEBOARD_OPEN = 'none';
  process.env.WHITEBOARD_PORT = String(config.whiteboardPort);
  const warm = spawnSync(process.execPath, [join(ROOT, 'whiteboard.mjs'), 'call', 'canvas_guide'], { windowsHide: true, stdio: 'ignore', timeout: 20000 });
  if (warm.status !== 0) throw new Error('无法启动白板后台');
  const boardResult=spawnSync(process.execPath,[join(ROOT,'whiteboard.mjs'),'--session',config.defaultLesson||'classroom-demo','url'],{windowsHide:true,encoding:'utf8',timeout:10000});
  if(boardResult.status!==0)throw new Error('Cannot prepare the default classroom board');
  const boardUrl=new URL(boardResult.stdout.trim().split(/\r?\n/).at(-1));
  const boardId=boardUrl.pathname.split('/')[2],token=(await readFile(join(state,'token'),'utf8')).trim();
  const classroomUrl=`${config.publicOrigin}/classroom/${boardId}/${token}/`;
  await mkdir(join(state,'mobile'),{recursive:true});
  await writeFile(join(state,'mobile/setup.txt'),`Evolution Classroom private setup\n\nClassroom: ${classroomUrl}\nRemote MCP: ${config.publicOrigin}/mcp\nAuthorization: Bearer ${token}\n\nAsk the intended desktop agent to join this lesson before sending questions. Keep this file and URL private.\n`,{mode:0o600});
  await writeFile(join(state,'mobile/study-client.json'),JSON.stringify({url:config.publicOrigin,token,lesson:config.defaultLesson||'classroom-demo'},null,2),{mode:0o600});
  const gateway = createGateway({ ...config, state, workspace: config.workspace });
  await new Promise((ok, fail) => { gateway.server.once('error', fail); gateway.server.listen(config.port, '127.0.0.1', ok); });
  await writeFile(join(state, 'mobile-gateway.pid'), String(process.pid));
  console.log(`Study gateway listening on 127.0.0.1:${config.port}`);
}
