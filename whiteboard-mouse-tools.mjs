// Browser-local input preferences. Never edit scene elements or shared lesson state.
export function toolSnapshot(tool) {
  if (!tool || typeof tool.type !== 'string') return null;
  return {
    type: tool.type,
    ...(tool.type === 'custom' && typeof tool.customType === 'string' ? { customType: tool.customType } : {}),
    ...(typeof tool.locked === 'boolean' ? { locked: tool.locked } : {}),
  };
}
const keyOf = tool => tool ? tool.type + ':' + (tool.customType || '') : '';

export function attachMouseToolShortcuts(api, targetWindow = window) {
  if (!api?.getAppState || !api?.setActiveTool) return () => {};
  let history = [];
  const pressed = new Set(), claimed = new Map();
  function remember(state = api.getAppState()) {
    const tool = toolSnapshot(state.activeTool);
    if (!tool) return;
    if (tool.type === 'hand') {
      if (!history.length) {
        const previous = toolSnapshot(state.activeTool.lastActiveTool);
        if (previous && previous.type !== 'hand') history.push(previous);
      }
      return;
    }
    if (keyOf(history.at(-1)) === keyOf(tool)) history[history.length - 1] = tool;
    else history = [...history, tool].slice(-20);
  }
  remember();
  const unsubscribe = api.onChange?.((_elements, state) => remember(state || api.getAppState()));
  function inBoard(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return false;
    const node = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    if (!node?.closest?.('.excalidraw')) return false;
    if (node.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return false;
    const state = api.getAppState();
    return !state.editingTextElement && !state.openDialog;
  }
  const side = event => event.button === 3 || event.button === 4;
  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
  function down(event) {
    if (!side(event) || !inBoard(event)) return;
    swallow(event);
    claimed.set(event.button, Date.now());
    if (pressed.has(event.button)) return; // pointerdown + compatibility mousedown: one action.
    pressed.add(event.button);
    // Do not interrupt a stroke or an ongoing left/right/middle-button gesture.
    if ((event.buttons || 0) & 7) return;
    remember();
    const current = toolSnapshot(api.getAppState().activeTool);
    let next;
    if (event.button === 4) {
      if (current?.type === 'hand') return;
      next = { type: 'hand', locked: current?.locked ?? false };
    } else {
      next = current?.type === 'hand' ? history.at(-1) : history.at(-2);
      if (!next) next = { type: 'selection', locked: false };
    }
    api.setActiveTool({ ...next });
  }
  function finish(event) {
    if (!side(event) || event.pointerType && event.pointerType !== 'mouse') return;
    const recentlyClaimed = Date.now() - (claimed.get(event.button) ?? -Infinity) < 400;
    if (inBoard(event) || recentlyClaimed) swallow(event);
    pressed.delete(event.button);
    if (event.type === 'auxclick') claimed.delete(event.button);
  }
  const clear = () => { pressed.clear(); claimed.clear(); };
  const handlers = { pointerdown: down, mousedown: down, pointerup: finish, mouseup: finish, auxclick: finish, pointercancel: clear, blur: clear };
  const options = { capture: true, passive: false };
  for (const [name, fn] of Object.entries(handlers)) targetWindow.addEventListener(name, fn, options);
  return () => {
    unsubscribe?.();
    for (const [name, fn] of Object.entries(handlers)) targetWindow.removeEventListener(name, fn, options);
    clear();
  };
}

// Plain mouse wheel over the drawing canvas zooms (around the cursor) instead of scrolling.
// The board's own Ctrl+wheel zoom does the math, so limits and cursor anchoring stay native.
// Panning remains: hand tool, upper side button, Space+drag or middle-button drag.
export function attachWheelZoom(targetWindow = window) {
  function wheel(event) {
    if (event.ctrlKey || event.metaKey) return; // native zoom (incl. touchpad pinch) or our re-dispatch
    const node = event.target;
    if (node?.tagName !== 'CANVAS' || !node.closest?.('.excalidraw')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!raw) return;
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
    // The board zooms around its last known pointer position; refresh it to this wheel point.
    if (targetWindow.PointerEvent) node.dispatchEvent(new targetWindow.PointerEvent('pointermove', { bubbles: true, clientX: event.clientX, clientY: event.clientY, pointerType: 'mouse', isPrimary: true }));
    node.dispatchEvent(new targetWindow.WheelEvent('wheel', {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: raw * unit, deltaX: 0, deltaMode: 0,
      clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
    }));
  }
  const options = { capture: true, passive: false };
  targetWindow.addEventListener('wheel', wheel, options);
  return () => targetWindow.removeEventListener('wheel', wheel, options);
}

export function createMouseToolUI(React) {
  return function StudyMouseTools({ api }) {
    React.useEffect(() => attachMouseToolShortcuts(api), [api]);
    React.useEffect(() => attachWheelZoom(), []);
    return null;
  };
}
