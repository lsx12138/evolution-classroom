// Persist object comments as ordinary Excalidraw cards with structured target IDs.
const META = 'studyAnnotation';
const MAX_TEXT = 2000;
const nonce = () => Math.floor(Math.random() * 2147483647);
const uid = () => 'study-ann-' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const dataOf = el => el?.customData?.[META];
const typeNames = { rectangle: '矩形', diamond: '菱形', ellipse: '椭圆', text: '文字', arrow: '箭头', line: '线条', freedraw: '手写笔画', image: '图片', frame: '画框' };

export function selectedTargets(elements, selectedIds) {
  return elements.filter(el => !el.isDeleted && selectedIds?.[el.id] && !dataOf(el) && !(el.containerId && selectedIds[el.containerId]));
}

export function targetLabel(el, elements) {
  const label = elements.find(item => !item.isDeleted && item.containerId === el.id);
  return (el.originalText || el.text || label?.originalText || label?.text || typeNames[el.type] || '画布对象').replace(/\s+/g, ' ').slice(0, 70);
}

// Like targetLabel, but an unlabeled shape is described by the text drawn inside it.
export function describeTarget(el, elements, bounds) {
  const own = targetLabel(el, elements);
  if (own !== (typeNames[el.type] || '画布对象') || !bounds || el.type === 'text') return own;
  const [x1, y1, x2, y2] = bounds([el]);
  const inside = elements.filter(item => !item.isDeleted && item.type === 'text' && !item.containerId && !dataOf(item) && item.x >= x1 && item.y >= y1 && item.x + item.width <= x2 && item.y + item.height <= y2)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const words = inside.map(item => item.originalText || item.text || '').join(' ').replace(/\s+/g, ' ').trim();
  return words ? (own + '：' + words).slice(0, 70) : own;
}

export function readAnnotations(elements) {
  return elements.filter(el => !el.isDeleted && dataOf(el)?.role === 'card').map(card => {
    const meta = dataOf(card);
    const label = elements.find(el => !el.isDeleted && el.type === 'text' && el.containerId === card.id);
    const text = label?.originalText || label?.text || '';
    const prefix = `批注 ${meta.number}\n`;
    return { card, meta, text, body: text.startsWith(prefix) ? text.slice(prefix.length) : text };
  }).sort((a, b) => a.meta.createdAt - b.meta.createdAt || a.card.id.localeCompare(b.card.id));
}

export function makeAnnotation(elements, targetIds, body, convert, bounds, now = Date.now()) {
  const clean = body.trim();
  if (!clean || clean.length > MAX_TEXT) throw new Error(`请填写 1～${MAX_TEXT} 字的批注。`);
  const targets = elements.filter(el => targetIds.includes(el.id) && !el.isDeleted && !dataOf(el));
  if (!targets.length) throw new Error('原对象已删除，请重新选择要批注的内容。');
  const number = Math.max(0, ...readAnnotations(elements).map(item => Number(item.meta.number) || 0)) + 1;
  const id = uid();
  const [left, top, right] = bounds(targets);
  let cardX = right + 70, cardY = top;
  // Put the card next to the target without covering an existing drawing or comment.
  const cardWidth = 300;
  const cardHeight = Math.max(100, 42 + clean.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / 14)), 0) * 25);
  const overlaps = (y, el) => !el.isDeleted && cardX < el.x + el.width + 18 && cardX + cardWidth + 18 > el.x && y < el.y + el.height + 18 && y + cardHeight + 18 > el.y;
  for (let attempt = 0; attempt < 80; attempt++) {
    const obstruction = elements.find(el => overlaps(cardY, el));
    if (!obstruction) break;
    cardY = obstruction.y + obstruction.height + 30;
  }
  const bindable = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'image']);
  const originalTargets = targets.filter(el => bindable.has(el.type));
  const skeletons = originalTargets.map(el => JSON.parse(JSON.stringify(el)));
  skeletons.push({ id, type: 'rectangle', x: cardX, y: cardY, width: cardWidth, height: cardHeight,
    backgroundColor: '#fff3bf', fillStyle: 'solid', strokeColor: '#b7791f', strokeWidth: 1,
    roundness: { type: 3 }, label: { text: `批注 ${number}\n${clean}`, fontFamily: 2, fontSize: 18, strokeColor: '#5f370e', textAlign: 'left', verticalAlign: 'top' } });
  for (const [index, target] of targets.entries()) {
    const box = bounds([target]);
    const x = box[2] + 5, y = (box[1] + box[3]) / 2;
    skeletons.push({ id: `${id}-link-${index}`, type: 'arrow', x, y,
      points: [[0, 0], [cardX - x - 5, cardY + 35 - y]],
      strokeColor: '#b7791f', strokeStyle: 'dashed', strokeWidth: 1, roughness: 0,
      startArrowhead: 'dot', endArrowhead: null,
      ...(bindable.has(target.type) ? { start: { id: target.id } } : {}), end: { id } });
  }
  const converted = convert(skeletons, { regenerateIds: false });
  const existing = new Set(elements.map(el => el.id));
  const added = converted.filter(el => !existing.has(el.id));
  const meta = { schemaVersion: 1, role: 'card', id, number, createdAt: now,
    targetIds: targets.map(el => el.id),
    targets: targets.map(el => ({ id: el.id, type: el.type, quote: targetLabel(el, elements) })) };
  for (const el of added) el.customData = { ...el.customData, [META]: el.id === id ? meta : { schemaVersion: 1, role: el.type === 'arrow' ? 'connector' : 'label', id } };
  // Only add the native arrow bindings to existing objects, preserving their geometry,
  // labels and all unrelated bindings. Native connectors then follow a moved target.
  const links = new Map();
  for (const el of added) if (el.type === 'arrow' && el.startBinding?.elementId) {
    const targetId = el.startBinding.elementId;
    links.set(targetId, [...(links.get(targetId) || []), { id: el.id, type: 'arrow' }]);
  }
  const updated = elements.map(el => links.has(el.id) ? { ...el, boundElements: [...(el.boundElements || []), ...links.get(el.id)], version: el.version + 1, versionNonce: nonce(), updated: now } : el);
  return { id, meta, body: clean, elements: [...updated, ...added], added };
}

// ---- Pick mode: hover highlights the smallest object under the pointer; drag selects a region.
export function pickableElements(elements) {
  const byId = new Map(elements.map(el => [el.id, el]));
  const out = new Map();
  for (const el of elements) {
    if (el.isDeleted || dataOf(el)) continue;
    const owner = el.containerId && byId.get(el.containerId);
    const target = owner && !owner.isDeleted ? owner : el;
    if (!dataOf(target)) out.set(target.id, target);
  }
  return [...out.values()];
}

export function pickAt(elements, point, bounds, pad = 4) {
  let best = null, bestArea = Infinity;
  for (const el of pickableElements(elements)) {
    const [x1, y1, x2, y2] = bounds([el]);
    if (point.x < x1 - pad || point.x > x2 + pad || point.y < y1 - pad || point.y > y2 + pad) continue;
    const area = Math.max(1, (x2 - x1) * (y2 - y1));
    if (area < bestArea) { best = el; bestArea = area; }
  }
  return best ? [best.id] : [];
}

export function pickInRect(elements, rect, bounds) {
  const left = Math.min(rect.x1, rect.x2), right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2), bottom = Math.max(rect.y1, rect.y2);
  return pickableElements(elements).filter(el => {
    const [x1, y1, x2, y2] = bounds([el]);
    return x1 >= left && x2 <= right && y1 >= top && y2 <= bottom;
  }).map(el => el.id);
}

export const toScene = (state, clientX, clientY) => ({
  x: (clientX - (state.offsetLeft || 0)) / state.zoom.value - state.scrollX,
  y: (clientY - (state.offsetTop || 0)) / state.zoom.value - state.scrollY,
});
export const toScreen = (state, x, y) => ({
  x: (x + state.scrollX) * state.zoom.value + (state.offsetLeft || 0),
  y: (y + state.scrollY) * state.zoom.value + (state.offsetTop || 0),
});

export function removeAnnotation(elements, id, now = Date.now()) {
  const removed = new Set(elements.filter(el => dataOf(el)?.id === id).map(el => el.id));
  return elements.map(el => {
    if (removed.has(el.id)) return { ...el, isDeleted: true, version: el.version + 1, versionNonce: nonce(), updated: now };
    if (el.boundElements?.some(bound => removed.has(bound.id))) return { ...el, boundElements: el.boundElements.filter(bound => !removed.has(bound.id)), version: el.version + 1, versionNonce: nonce(), updated: now };
    return el;
  });
}

const CSS = `
.study-ann-dock{position:fixed;right:16px;bottom:72px;z-index:30;pointer-events:auto;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#273329}
.study-ann-dock button,.study-ann-panel textarea{font:inherit;box-sizing:border-box}
.study-ann-dock button{cursor:pointer;touch-action:manipulation;border:1px solid #dedfd6;border-radius:9px;padding:8px 12px;background:#fff;color:inherit;min-height:38px}
.study-ann-dock button:disabled{opacity:.5;cursor:default}
.study-ann-dock button:focus-visible,.study-ann-panel textarea:focus{outline:2px solid #448977;outline-offset:2px}
.study-ann-actions{display:flex;justify-content:flex-end;gap:7px}
.study-ann-actions>button{box-shadow:0 3px 16px #00000012}
.study-ann-dock .study-ann-primary{background:#17685a;color:white;border-color:#17685a}
.study-ann-dock .study-ann-panel{display:block;position:absolute;right:0;bottom:50px;width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 180px);overflow:auto;background:#fffef8;border:1px solid #e2dfd2;box-shadow:0 8px 32px #0002;border-radius:14px;padding:16px;box-sizing:border-box}
.study-ann-dock .study-ann-panel form,.study-ann-dock .study-ann-item{display:block}
.study-ann-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;font-weight:650;font-size:17px}
.study-ann-heading button{padding:3px 10px;min-height:32px;font-size:13px;font-weight:400}
.study-ann-muted{font-size:12px;color:#6a736a;margin:6px 0 10px}
.study-ann-target{padding:8px 10px;background:#eeefe6;border-radius:8px;margin-bottom:10px;overflow-wrap:anywhere}
.study-ann-panel label{display:block;font-weight:550;margin:8px 0 5px}
.study-ann-panel textarea{display:block;width:100%;min-height:100px;resize:vertical;background:#fff;color:#20372c;border:1px solid #aebdb1;border-radius:8px;padding:10px;line-height:1.6}
.study-ann-save-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:10px 0 14px}
.study-ann-item{border-top:1px solid #e4e4d8;padding-top:12px;margin-top:12px}
.study-ann-item h4{margin:0 0 4px;font-size:14px;font-weight:650}
.study-ann-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 8px;font-size:14px;line-height:1.65}
.study-ann-item-actions{display:flex;gap:6px;flex-wrap:wrap}
.study-ann-item-actions button{padding:4px 8px;min-height:32px;font-size:12px}
.study-ann-message{font-size:13px;color:#17685a;white-space:pre-wrap;margin:9px 0}
.study-ann-message[role=alert]{color:#a03d1e}
[data-theme=dark] .study-ann-dock{color:#e5eadf}
[data-theme=dark] .study-ann-panel{background:#242820;border-color:#4b5046}
[data-theme=dark] .study-ann-dock button{background:#30382c;color:#e5eadf;border-color:#515e4a}
[data-theme=dark] .study-ann-dock .study-ann-primary{background:#17685a;border-color:#448977}
[data-theme=dark] .study-ann-target{background:#353e2e}
[data-theme=dark] .study-ann-panel textarea{background:#1d251b;color:#e5eadf}
[data-theme=dark] .study-ann-muted{color:#b2beaa}
.study-pick-layer{position:fixed;inset:0;z-index:29;cursor:crosshair;background:transparent;touch-action:none}
.study-pick-box{position:fixed;pointer-events:none;border:2px solid #e8590c;background:#e8590c14;border-radius:6px;box-shadow:0 0 0 4px #e8590c22;transition:left .06s,top .06s,width .06s,height .06s}
.study-pick-drag{position:fixed;pointer-events:none;border:1.5px dashed #1971c2;background:#1971c20d}
.study-pick-chip{position:fixed;pointer-events:none;transform:translateY(-100%);margin-top:-6px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#e8590c;color:#fff;font:12px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:2px 8px;border-radius:6px}
.study-pick-hint{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:31;pointer-events:none;background:#273329e8;color:#fff;font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:6px 14px;border-radius:9px;max-width:calc(100vw - 32px);text-align:center}
.study-ctx-menu{position:fixed;z-index:40;min-width:220px;background:#fff;border:1px solid #dedfd6;border-radius:10px;box-shadow:0 8px 28px #0003;padding:5px;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#273329}
.study-ctx-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:7px 12px;border-radius:7px;cursor:pointer;font:inherit;color:inherit}
.study-ctx-menu button:hover,.study-ctx-menu button:focus-visible{background:#fff3bf;outline:none}
.study-ctx-menu hr{border:0;border-top:1px solid #ecece4;margin:4px 6px}
.study-ctx-menu small{color:#6a736a;font-size:12px;margin-left:6px}
[data-theme=dark] .study-ctx-menu{background:#242820;border-color:#4b5046;color:#e5eadf}
[data-theme=dark] .study-ctx-menu button:hover{background:#3a4232}
@media(max-width:600px){.study-ann-dock{right:10px;bottom:116px}.study-ann-dock .study-ann-panel{width:min(340px,calc(100vw - 20px));padding:13px;max-height:calc(100dvh - 190px)}}
`;

export function createAnnotationUI(React, convert, capture, bounds) {
  const h = React.createElement;
  return function StudyAnnotations({ api, connected, onNote }) {
    const [snapshot, setSnapshot] = React.useState({ elements: [], selected: [] });
    const [open, setOpen] = React.useState(false);
    const [targetIds, setTargetIds] = React.useState([]);
    const [body, setBody] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const textarea = React.useRef(null);
    const signature = React.useRef('');
    React.useEffect(() => {
      if (!api) return;
      const update = () => {
        const elements = api.getSceneElementsIncludingDeleted();
        const selected = selectedTargets(elements, api.getAppState().selectedElementIds);
        const annotations = readAnnotations(elements);
        const key = JSON.stringify([selected.map(el => [el.id, el.version]), annotations.map(item => [item.card.id, item.card.version, item.text]), elements.filter(el => dataOf(el)).map(el => [el.id, el.isDeleted, el.version])]);
        if (signature.current !== key) { signature.current = key; setSnapshot({ elements: [...elements], selected }); }
      };
      update();
      return api.onChange(update);
    }, [api]);
    React.useEffect(() => { if (open && targetIds.length) textarea.current?.focus(); }, [open, targetIds.join('|')]);
    React.useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4500); return () => clearTimeout(timer); }, [message]);
    // Right-click menu and pick mode.
    const [menu, setMenu] = React.useState(null);      // {x, y, selected}
    const [pick, setPick] = React.useState(null);      // {ids, drag:{x1,y1,x2,y2}|null, note}
    const [, setTick] = React.useState(0);
    const passNative = React.useRef(false);
    const press = React.useRef(null);
    const last = React.useRef({ x: 0, y: 0 });
    const draftRef = React.useRef({ body: '', targetIds: [] });
    draftRef.current = { body, targetIds };
    React.useEffect(() => {
      if (!api) return;
      const onContext = event => {
        if (passNative.current) { passNative.current = false; return; }
        const node = event.target;
        if (node?.tagName !== 'CANVAS' || !node.closest?.('.excalidraw')) return;
        const state = api.getAppState();
        if (state.editingTextElement || state.openDialog) return;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
        const selected = selectedTargets(api.getSceneElementsIncludingDeleted(), state.selectedElementIds).length;
        setMenu({ x: event.clientX, y: event.clientY, selected });
      };
      window.addEventListener('contextmenu', onContext, { capture: true });
      return () => window.removeEventListener('contextmenu', onContext, { capture: true });
    }, [api]);
    React.useEffect(() => {
      if (!menu && !pick) return;
      const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); setPick(null); } };
      const onDown = event => { if (menu && !event.target?.closest?.('.study-ctx-menu')) setMenu(null); };
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('pointerdown', onDown, true);
      return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
    }, [menu, pick]);
    if (!api) return null;
    const scenePoint = (cx, cy) => toScene(api.getAppState(), cx, cy);
    const hoverAt = (cx, cy) => pickAt(api.getSceneElementsIncludingDeleted(), scenePoint(cx, cy), bounds, 4 / api.getAppState().zoom.value);
    const startPick = (cx, cy) => {
      setMenu(null);
      if (draftRef.current.body.trim() && draftRef.current.targetIds.length) { setOpen(true); setError('输入框里还有未提交的批注，请先提交，或点“取消本次批注”。'); return; }
      last.current = { x: cx, y: cy };
      setPick({ ids: hoverAt(cx, cy), drag: null, note: '' });
    };
    const finishPick = ids => {
      setPick(null); setTargetIds(ids); setOpen(true); setError(''); setMessage('');
    };
    const nativeMenu = (cx, cy) => {
      setMenu(null);
      const canvas = [...document.elementsFromPoint(cx, cy)].find(node => node.tagName === 'CANVAS' && node.closest('.excalidraw'));
      if (!canvas) return;
      passNative.current = true;
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, buttons: 0 }));
      setTimeout(() => { passNative.current = false; }, 0);
    };
    const layerEvents = {
      onPointerDown: event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const p = scenePoint(event.clientX, event.clientY);
        press.current = { cx: event.clientX, cy: event.clientY, x: p.x, y: p.y, dragging: false };
      },
      onPointerMove: event => {
        last.current = { x: event.clientX, y: event.clientY };
        const start = press.current;
        if (start && (start.dragging || Math.hypot(event.clientX - start.cx, event.clientY - start.cy) > 5)) {
          start.dragging = true;
          const p = scenePoint(event.clientX, event.clientY);
          const drag = { x1: start.x, y1: start.y, x2: p.x, y2: p.y };
          setPick({ ids: pickInRect(api.getSceneElementsIncludingDeleted(), drag, bounds), drag, note: '' });
        } else setPick(value => value && { ...value, ids: hoverAt(event.clientX, event.clientY), note: '' });
      },
      onPointerUp: event => {
        const start = press.current; press.current = null;
        if (!start || event.button !== 0) return;
        const ids = start.dragging ? pick?.ids || [] : hoverAt(event.clientX, event.clientY);
        if (ids.length) finishPick(ids);
        else setPick({ ids: [], drag: null, note: start.dragging ? '框里没有完整包含的对象，框大一点再试。' : '这里没有对象，换个位置或拖框选择。' });
      },
      onContextMenu: event => { event.preventDefault(); setPick(null); },
      onWheel: event => {
        const canvas = [...document.elementsFromPoint(event.clientX, event.clientY)].find(node => node.tagName === 'CANVAS' && node.closest('.excalidraw'));
        if (!canvas) return;
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: event.clientX, clientY: event.clientY, pointerType: 'mouse', isPrimary: true }));
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: event.deltaY || event.deltaX, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY }));
        requestAnimationFrame(() => { setPick(value => value && !value.drag ? { ...value, ids: hoverAt(last.current.x, last.current.y) } : value); setTick(t => t + 1); });
      },
    };
    const pickOverlay = () => {
      if (!pick) return null;
      const state = api.getAppState();
      const all = api.getSceneElementsIncludingDeleted();
      const chosen = all.filter(el => pick.ids.includes(el.id));
      const parts = [h('div', { key: 'layer', className: 'study-pick-layer', 'data-testid': 'annotation-pick-layer', ...layerEvents })];
      if (pick.drag) {
        const a = toScreen(state, Math.min(pick.drag.x1, pick.drag.x2), Math.min(pick.drag.y1, pick.drag.y2));
        const b = toScreen(state, Math.max(pick.drag.x1, pick.drag.x2), Math.max(pick.drag.y1, pick.drag.y2));
        parts.push(h('div', { key: 'drag', className: 'study-pick-drag', style: { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y } }));
      }
      if (chosen.length) {
        const [x1, y1, x2, y2] = bounds(chosen);
        const a = toScreen(state, x1, y1), b = toScreen(state, x2, y2);
        const box = { left: a.x - 5, top: a.y - 5, width: b.x - a.x + 10, height: b.y - a.y + 10 };
        parts.push(h('div', { key: 'box', className: 'study-pick-box', style: box }));
        const label = chosen.length === 1 ? describeTarget(chosen[0], all, bounds) : `${chosen.length} 个对象`;
        parts.push(h('div', { key: 'chip', className: 'study-pick-chip', style: { left: box.left, top: box.top } }, `批注：${label}`));
      }
      parts.push(h('div', { key: 'hint', className: 'study-pick-hint', role: 'status' }, pick.note || '批注：移动鼠标选择对象，单击确定 · 按住拖动框选多个 · 滚轮缩放 · Esc 或右键取消'));
      return parts;
    };
    const contextMenu = () => {
      if (!menu) return null;
      const x = Math.min(menu.x, window.innerWidth - 240), y = Math.min(menu.y, window.innerHeight - 150);
      return h('div', { className: 'study-ctx-menu', role: 'menu', style: { left: Math.max(8, x), top: Math.max(8, y) }, onContextMenu: e => e.preventDefault() },
        h('button', { type: 'button', role: 'menuitem', onClick: () => startPick(menu.x, menu.y) }, '批注…', h('small', null, '移动鼠标选对象')),
        menu.selected > 0 && h('button', { type: 'button', role: 'menuitem', onClick: () => { setMenu(null); begin(); } }, `批注已选中的 ${menu.selected} 个对象`),
        h('hr'),
        h('button', { type: 'button', role: 'menuitem', onClick: () => nativeMenu(menu.x, menu.y) }, '白板菜单', h('small', null, '复制、粘贴、图层…')));
    };
    const annotations = readAnnotations(snapshot.elements);
    const begin = () => {
      const selected = selectedTargets(api.getSceneElementsIncludingDeleted(), api.getAppState().selectedElementIds);
      if (!selected.length) { setOpen(true); setError('先用选择工具点击对象，或拖框选中多个对象，再点“批注所选”。'); return; }
      if (body.trim() && targetIds.length) { setOpen(true); setError('输入框里还有未提交的批注，请先提交，或点“取消本次批注”。'); return; }
      setTargetIds(selected.map(el => el.id)); setOpen(true); setError(''); setMessage('');
    };
    const save = event => {
      event?.preventDefault(); setError(''); setMessage('');
      if (!connected) { setError('当前未连接，批注未提交；输入内容已保留，请连接后再试。'); return; }
      try {
        const result = makeAnnotation(api.getSceneElementsIncludingDeleted(), targetIds, body, convert, bounds);
        api.updateScene({ elements: result.elements, captureUpdate: capture.IMMEDIATELY });
        const note = `【对象批注 ${result.id}】\n关联对象：${result.meta.targetIds.slice(0, 10).join(', ')}${result.meta.targetIds.length > 10 ? '（完整列表见批注元数据）' : ''}\n批注：${result.body}`;
        onNote?.(note.slice(0, 3900));
        setTargetIds([]); setBody(''); setMessage('批注已添加到白板。请在聊天中提醒老师查看批注。');
        api.scrollToContent(result.added.filter(el => el.id === result.id), { fitToContent: true, animate: true, maxZoom: 1 });
      } catch (err) { setError(err.message || '暂未添加成功，请重试。'); }
    };
    const locate = (item, target) => {
      const wanted = target ? item.meta.targetIds : [item.card.id];
      const elements = api.getSceneElements().filter(el => wanted.includes(el.id));
      if (!elements.length) { setError('原对象已删除，批注内容仍保留。'); return; }
      api.scrollToContent(elements, { fitToContent: true, animate: true, maxZoom: 1.5 });
    };
    const discard = () => { setTargetIds([]); setBody(''); setError(''); };
    const remove = item => {
      if (!connected) { setError('当前未连接，请重连后再删除批注。'); return; }
      api.updateScene({ elements: removeAnnotation(api.getSceneElementsIncludingDeleted(), item.meta.id), captureUpdate: capture.IMMEDIATELY });
      setMessage('批注已删除；可用白板的撤销按钮恢复。'); setError('');
    };
    return h(React.Fragment, null, pickOverlay(), contextMenu(), h('div', { className: 'study-ann-dock', 'data-testid': 'annotation-dock', onKeyDown: event => event.stopPropagation() },
      h('style', null, CSS),
      open && h('section', { className: 'study-ann-panel', style: { display: 'block' }, 'aria-label': '对象批注面板' },
        h('div', { className: 'study-ann-heading' }, h('span', null, '对象批注'), h('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': '关闭批注面板' }, '关闭')),
        targetIds.length ? h('form', { onSubmit: save },
          h('div', { className: 'study-ann-target' }, `已关联 ${targetIds.length} 个对象：`, targetIds.map(id => {
            const el = snapshot.elements.find(item => item.id === id && !item.isDeleted);
            return el ? describeTarget(el, snapshot.elements, bounds) : '已删除的对象';
          }).slice(0, 3).join('；'), targetIds.length > 3 ? '…' : ''),
          h('label', { htmlFor: 'study-annotation-text' }, '批注内容'),
          h('textarea', { id: 'study-annotation-text', ref: textarea, value: body, maxLength: MAX_TEXT, placeholder: '例如：这一步为什么这样算？', onChange: e => setBody(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } } }),
          h('div', { className: 'study-ann-save-row' }, h('span', { className: 'study-ann-muted' }, `${body.length}/${MAX_TEXT}`), h('button', { type: 'submit', className: 'study-ann-primary', disabled: !body.trim() || !connected }, '保存批注')),
          h('button', { type: 'button', onClick: discard }, '取消本次批注')) : h(React.Fragment, null,
          h('p', { className: 'study-ann-muted' }, '在白板上右键选“批注…”，移动鼠标选中对象后单击；也可以先选中对象再点下方“批注所选”。')),
        error && h('p', { className: 'study-ann-message', role: 'alert' }, error),
        message && h('p', { className: 'study-ann-message', role: 'status' }, message),
        h('p', { className: 'study-ann-muted' }, annotations.length ? `共 ${annotations.length} 条批注，与板书一起保存。` : '还没有批注。老师读取白板时能看到你的批注；批注不会自动唤醒老师。'),
        ...annotations.map(item => h('article', { className: 'study-ann-item', key: item.card.id, 'data-annotation-id': item.card.id },
          h('h4', null, `批注 ${item.meta.number}`),
          h('div', { className: 'study-ann-muted' }, (item.meta.targets || []).slice(0, 2).map(target => target.quote).join('；')),
          h('p', { className: 'study-ann-body' }, item.body),
          h('div', { className: 'study-ann-item-actions' },
            h('button', { type: 'button', onClick: () => locate(item, true), 'aria-label': `定位批注 ${item.meta.number} 的原对象` }, '定位原对象'),
            h('button', { type: 'button', onClick: () => locate(item, false), 'aria-label': `定位批注 ${item.meta.number} 的卡片` }, '定位批注'),
            h('button', { type: 'button', onClick: () => remove(item), 'aria-label': `删除批注 ${item.meta.number}`, disabled: !connected }, '删除批注'))))),
      h('div', { className: 'study-ann-actions' },
        snapshot.selected.length > 0 && h('button', { type: 'button', className: 'study-ann-primary', onClick: begin }, `批注所选（${snapshot.selected.length}）`),
        h('button', { type: 'button', onClick: () => setOpen(value => !value), 'aria-expanded': open, 'aria-label': `打开批注列表，共 ${annotations.length} 条` }, `批注 ${annotations.length}`))));
  };
}
