import test from 'node:test';
import assert from 'node:assert/strict';
import {attachMouseToolShortcuts} from './whiteboard-mouse-tools.mjs';

function fixture(initial = { type: 'freedraw', locked: true }) {
  let state = { activeTool: initial }, listener;
  const handlers = new Map(), changes = [];
  const api = {
    getAppState: () => state,
    setActiveTool: tool => { state = { ...state, activeTool: tool }; changes.push(tool); listener?.([], state); },
    onChange: fn => { listener = fn; return () => { listener = null; }; },
  };
  const target = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  const clean = attachMouseToolShortcuts(api, target);
  const board = { closest: selector => selector === '.excalidraw' ? {} : null };
  const editable = { closest: selector => selector === '.excalidraw' ? {} : {} };
  const outside = { closest: () => null };
  function event(type, button, overrides = {}) {
    const e = { type, button, buttons: 0, pointerType: 'mouse', target: board, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() {}, ...overrides };
    handlers.get(type)?.(e);
    return e;
  }
  const click = button => { const e = event('pointerdown', button); event('mousedown', button); event('pointerup', button); event('mouseup', button); event('auxclick', button); return e; };
  return { api, event, click, clean, handlers, changes, editable, outside, state: () => state, setState: value => { state = { ...state, ...value }; } };
}
test('upper side button selects hand and lower restores locked previous tool once per click', () => {
  const f = fixture();
  assert.equal(f.click(4).prevented, true);
  assert.equal(f.state().activeTool.type, 'hand');
  assert.equal(f.changes.length, 1);
  f.click(4); // Repeated pan must not erase the return tool.
  f.click(3);
  assert.deepEqual(f.state().activeTool, { type: 'freedraw', locked: true });
  f.clean();
});
test('return works with every observed tool, including custom tools', () => {
  for (const tool of ['selection', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'eraser', 'frame', 'embeddable', 'laser', 'magicframe', 'custom']) {
    const initial = { type: tool, locked: true, ...(tool === 'custom' ? { customType: 'teacher-marker' } : {}) };
    const f = fixture(initial); f.click(4); f.click(3); assert.deepEqual(f.state().activeTool, initial); f.clean();
  }
});
test('manual tool changes update previous-tool history and lower button can return to previous tool', () => {
  const f = fixture();
  f.api.setActiveTool({ type: 'rectangle', locked: false });
  f.click(3); assert.equal(f.state().activeTool.type, 'freedraw');
  f.click(3); assert.equal(f.state().activeTool.type, 'rectangle');
  f.click(4); f.api.setActiveTool({ type: 'text', locked: false }); f.click(4); f.click(3);
  assert.equal(f.state().activeTool.type, 'text'); f.clean();
});
test('starting in hand uses native previous tool or safely falls back to selection', () => {
  const f = fixture({ type: 'hand', lastActiveTool: { type: 'eraser', locked: true } });f.click(3);
  assert.equal(f.state().activeTool.type, 'eraser'); f.clean();
  const empty = fixture({ type: 'hand' }); empty.click(3); assert.equal(empty.state().activeTool.type, 'selection');empty.clean();
});
test('ordinary buttons, pen, editable targets, and outside-page controls are untouched', () => {
  const f = fixture();
  for (const button of [0, 1, 2]) assert.equal(f.event('pointerdown', button).prevented, false);
  assert.equal(f.event('pointerdown', 4, { pointerType: 'pen' }).prevented, false);
  assert.equal(f.event('pointerdown', 4, { target: f.editable }).prevented, false);
  assert.equal(f.event('pointerdown', 4, { target: f.outside }).prevented, false);
  assert.equal(f.changes.length, 0); f.clean();
});
test('text editing, modal dialogs and active strokes are not interrupted', () => {
  const f = fixture();
  f.setState({ editingTextElement: { id: 'text' } }); assert.equal(f.click(4).prevented, false);
  f.setState({ editingTextElement: null, openDialog: { name: 'help' } }); assert.equal(f.click(4).prevented, false);
  f.setState({ openDialog: null }); f.event('pointerdown', 4, { buttons: 17 }); f.event('pointerup', 4);
  assert.equal(f.changes.length, 0); f.clean();
});
test('side-button default navigation is cancelled across down/up/auxclick and cleanup detaches listeners', () => {
  const f = fixture();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) assert.equal(f.event(type, 4).prevented, true);
  f.clean(); assert.equal(f.handlers.size, 0);
});
