import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Keep the existing CLI/MCP canvas_read tool; expose the selected object IDs and
// current bound label rather than requiring agents to infer the relation from pixels.
export function installAnnotationReadSupport() {
  const dist = join(ROOT, 'node_modules/@ansuman-shukla/whiteboard-mcp/dist');
  const changes = [
    { file: 'mcp/tools.js',
      from: 'frame: el.frameId ?? undefined,',
      to: 'frame: el.frameId ?? undefined,\n            annotation: el.customData?.studyAnnotation?.role === "card" ? { ...el.customData.studyAnnotation, text: labels.get(el.id) ?? "" } : undefined,' },
    { file: 'shared/describe.js',
      from: '        return body + attrs(el);',
      to: '        const annotation = el.customData?.studyAnnotation;\n        if (annotation?.role === "card") body += `\\n  Object annotation ${annotation.id} · targets ${JSON.stringify(annotation.targetIds)}\\n  ${JSON.stringify(textOf(this.labels.get(el.id) ?? el))}`;\n        return body + attrs(el);' },
  ];
  const plans = changes.map(change => {
    const target = join(dist, change.file);
    const backup = join(ROOT, 'state/frontend-original/whiteboard-mcp-0.3.5', change.file);
    const current = readFileSync(target, 'utf8');
    const original = existsSync(backup) ? readFileSync(backup, 'utf8') : current;
    if (original.split(change.from).length !== 2) throw new Error('批注读取补丁定位失败：' + change.file);
    const updated = original.replace(change.from, change.to);
    if (current !== original && current !== updated) throw new Error('读取模块存在其他修改，未覆盖：' + change.file);
    return { target, backup, original, updated, needed: current !== updated };
  });
  for (const plan of plans) if (plan.needed) {
    mkdirSync(dirname(plan.backup), { recursive: true });
    if (!existsSync(plan.backup)) writeFileSync(plan.backup, plan.original, 'utf8');
    writeFileSync(plan.target, plan.updated, 'utf8');
  }
}
