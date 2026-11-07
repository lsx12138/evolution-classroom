import { appendFile, readFile, writeFile, mkdir, realpath, readdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, relative, sep, isAbsolute } from 'node:path';

const subjects = { english: '01_英语', math: '02_高数', politics: '03_政治', it: '04_信息技术' };
const revision = text => createHash('sha256').update(text).digest('hex');
const str = { type: 'string' };
const subjectSchema = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const studyTools = [
  { name: 'study_context', description: '开始/接续学习前读取电脑和手机共用的当前任务与真实学习记录。记录可能比总控摘要更新；未汇报不等于没学。', inputSchema: object({ subject: subjectSchema }) },
  { name: 'study_read_file', description: '读取工作区允许的教材、角色卡、任务与记录；不提供保管件答案或归档。返回 revision 供更新当前任务时核对。', inputSchema: object({ path: str }, ['path']) },
  { name: 'study_append_record', description: '仅在收到学生真实学习汇报/作答后追加到同一份科学习记录。不得把工具测试、AI代答或计划记成已学。request_id 用于网络重试去重。', inputSchema: object({ subject: subjectSchema, request_id: str, student_evidence: str, summary: str, source: { type: 'string', enum: ['phone', 'desktop'] } }, ['subject', 'request_id', 'student_evidence', 'summary', 'source']) },
  { name: 'study_update_current', description: '更新本科唯一当前任务。先读取取得 expected_revision；旧版本会被拒绝。按实际学习证据接续，保留未完成任务和既定节奏，记录白板 lesson/ID 以便换设备。', inputSchema: object({ subject: subjectSchema, expected_revision: str, content: str }, ['subject', 'expected_revision', 'content']) },
];

export class StudyStore {
  constructor(workspace, state, options={}) {
    this.workspace = resolve(workspace); this.state = state; this.locks = new Map();
    this.subjects=options.subjects||subjects;
    this.overviewFile=options.overviewFile||'00_统筹规划/进度记录/CURRENT.md';
    this.recordFile=options.recordFile||'学习记录.md';
    for(const folder of Object.values(this.subjects))if(typeof folder!=='string'||folder.startsWith('/')||folder.includes('\\')||folder.split('/').some(p=>!p||p==='..'||p.startsWith('_')))throw Error('Invalid subject folder');
    if(!/^[^/\\]+\.md$/.test(this.recordFile))throw Error('Invalid record filename');
  }
  async locked(key, fn) {
    const prior = this.locks.get(key) ?? Promise.resolve();
    const run = prior.catch(() => {}).then(fn);
    this.locks.set(key, run);
    try { return await run; } finally { if (this.locks.get(key) === run) this.locks.delete(key); }
  }
  folder(subject) {
    if (!Object.hasOwn(this.subjects, subject)) throw new Error('未知科目');
    return this.subjects[subject];
  }
  async path(file) {
    if (typeof file !== 'string' || file.includes('\\') || file.includes('\0') || file.split('/').some(p => p === '..' || p.startsWith('_'))) throw new Error('不允许的文件路径');
    const fixed = ['README.md', 'AGENTS.md', this.overviewFile];
    const eligible = fixed.includes(file) || (file.endsWith('.md')&&Object.values(this.subjects).some(folder=>file.startsWith(folder+'/')));
    if (!eligible || /(?:^|\/)(node_modules|state|板书)(?:\/|$)/.test(file)) throw new Error('仅允许读取教学 Markdown；答案保管件不开放');
    const candidate = await realpath(resolve(this.workspace, file));
    const base = await realpath(this.workspace);
    const rel = relative(base, candidate);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || rel.split(sep).some(p => p.startsWith('_')) || resolve(base, rel) !== candidate || candidate === base) throw new Error('路径越界');
    return candidate;
  }
  async read(file) {
    const text = await readFile(await this.path(file), 'utf8');
    if (Buffer.byteLength(text) > 300000) throw new Error('文件过大，请由电脑端处理');
    return { path: file, revision: revision(text), content: text };
  }
  async context(subject) {
    if (subject !== undefined) this.folder(subject);
    const selected = subject ? [subject] : Object.keys(this.subjects);
    const result = {
      source: 'One shared local workspace; the phone does not keep a separate progress database.',
      rules: (await this.read('AGENTS.md')).content,
      overview: await this.read(this.overviewFile),
      subjects: {},
      guidance: '先核对本科 CURRENT 与最新记录，再接课。白板使用同一个 lesson 或通过实际 board ID 打开。课后写真实记录，再按新 revision 更新当前任务；失联时不得假称写入成功。',
    };
    for (const key of selected) {
      const folder = this.folder(key);
      const records = await this.read(`${folder}/${this.recordFile}`);
      result.subjects[key] = {
        current: await this.read(`${folder}/CURRENT.md`),
        records: { path: records.path, content: records.content.slice(-12000), truncated: records.content.length > 12000 },
        materials: (await readdir(join(this.workspace, folder))).filter(x => x.endsWith('.md')).map(x => `${folder}/${x}`),
      };
    }
    return result;
  }
  async append(args) {
    const folder = this.folder(args.subject);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.request_id ?? '')) throw new Error('request_id 需为 8–100 位字母、数字、下划线或横线，重试沿用原值');
    for (const key of ['student_evidence', 'summary']) {
      if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > 12000) throw new Error(`${key} 需为真实学习内容，长度 1–12000`);
    }
    if (!['phone', 'desktop'].includes(args.source)) throw new Error('source 需为 phone 或 desktop');
    const file = `${folder}/${this.recordFile}`;
    return this.locked(file, async () => {
      const path = await this.path(file);
      const before = await readFile(path, 'utf8');
      const marker = `<!-- study-entry:${args.request_id}:`;
      const fingerprint = revision(JSON.stringify([args.subject, args.student_evidence, args.summary, args.source]));
      if (before.includes(marker)) {
        if (!before.includes(`${marker}${fingerprint} -->`)) throw new Error('同一 request_id 已用于不同内容，拒绝重复写入');
        return { ok: true, duplicate: true, path: file, revision: revision(before) };
      }
      const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
      const quote = args.student_evidence.replace(/\r/g, '').split('\n').map(line => `> ${line}`).join('\n');
      const entry = `\n\n${marker}${fingerprint} -->\n## ${stamp} · ${args.source === 'phone' ? '手机' : '电脑'}学习汇报\n\n学生证据：\n${quote}\n\n记录：\n${args.summary.trim()}\n`;
      await appendFile(path, entry, 'utf8');
      return { ok: true, duplicate: false, path: file, revision: revision(before + entry) };
    });
  }
  async update(args) {
    const folder = this.folder(args.subject);
    if (typeof args.content !== 'string' || !args.content.startsWith('#') || args.content.length > 30000) throw new Error('content 需为完整的 CURRENT Markdown（以 # 开头，至多 30000 字符）');
    const file = `${folder}/CURRENT.md`;
    return this.locked(file, async () => {
      const path = await this.path(file);
      const before = await readFile(path, 'utf8');
      if (args.expected_revision !== revision(before)) throw new Error('STALE_REVISION：当前任务已变化，先重新读取再合并，不能覆盖新进度');
      if (before === args.content) return { ok: true, changed: false, path: file, revision: revision(before) };
      const backup = join(this.state, 'current-backups', `${args.subject}-${Date.now()}-${randomUUID()}.md`);
      await mkdir(join(this.state, 'current-backups'), { recursive: true });
      await writeFile(backup, before, 'utf8');
      // Recheck after the backup in case a desktop editor saved during the operation.
      if (revision(await readFile(path, 'utf8')) !== args.expected_revision) throw new Error('STALE_REVISION：电脑端刚修改了任务，请重新读取');
      const temp = path + `.${randomUUID()}.tmp`;
      await writeFile(temp, args.content, 'utf8');
      await rename(temp, path);
      return { ok: true, changed: true, path: file, revision: revision(args.content) };
    });
  }
  async call(name, args) {
    if (name === 'study_context') return this.context(args.subject);
    if (name === 'study_read_file') return this.read(args.path);
    if (name === 'study_append_record') return this.append(args);
    if (name === 'study_update_current') return this.update(args);
    throw new Error('未知学习工具');
  }
}
