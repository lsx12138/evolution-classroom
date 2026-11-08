import test from 'node:test';
import assert from 'node:assert/strict';
import { attachWheelZoom } from './whiteboard-mouse-tools.mjs';
import { pickAt, pickInRect, pickableElements, toScene, toScreen } from './whiteboard-annotations.mjs';

const bounds = els => [Math.min(...els.map(e => e.x)), Math.min(...els.map(e => e.y)), Math.max(...els.map(e => e.x + e.width)), Math.max(...els.map(e => e.y + e.height))];
const scene = [
  { id: 'frame', type: 'rectangle', x: 0, y: 0, width: 1000, height: 1000 },
  { id: 'card', type: 'rectangle', x: 100, y: 100, width: 200, height: 100 },
  { id: 'card-label', type: 'text', x: 120, y: 120, width: 80, height: 20, containerId: 'card' },
  { id: 'dot', type: 'ellipse', x: 400, y: 400, width: 10, height: 10 },
  { id: 'gone', type: 'rectangle', x: 100, y: 100, width: 5, height: 5, isDeleted: true },
  { id: 'ann', type: 'rectangle', x: 150, y: 150, width: 20, height: 20, customData: { studyAnnotation: { role: 'card' } } },
];

test('hover picks the smallest object under the pointer, mapping labels to their container', () => {
  assert.deepEqual(pickAt(scene, { x: 130, y: 125 }, bounds), ['card']);   // on the label text
  assert.deepEqual(pickAt(scene, { x: 160, y: 160 }, bounds), ['card']);   // annotation cards are not targets
  assert.deepEqual(pickAt(scene, { x: 403, y: 403 }, bounds), ['dot']);
  assert.deepEqual(pickAt(scene, { x: 900, y: 900 }, bounds), ['frame']);
  assert.deepEqual(pickAt(scene, { x: 2000, y: 2000 }, bounds), []);
  assert.deepEqual(pickableElements(scene).map(e => e.id).sort(), ['card', 'dot', 'frame']);
});
test('drag selects fully contained objects only, in any drag direction', () => {
  assert.deepEqual(pickInRect(scene, { x1: 500, y1: 500, x2: 50, y2: 50 }, bounds).sort(), ['card', 'dot']);
  assert.deepEqual(pickInRect(scene, { x1: 90, y1: 90, x2: 200, y2: 200 }, bounds), []);
});
test('screen and scene coordinates round-trip', () => {
  const state = { zoom: { value: 1.5 }, scrollX: -40, scrollY: 25, offsetLeft: 10, offsetTop: 60 };
  const s = toScene(state, 310, 400), back = toScreen(state, s.x, s.y);
  assert.ok(Math.abs(back.x - 310) < 1e-9 && Math.abs(back.y - 400) < 1e-9);
});

function wheelFixture() {
  const handlers = new Map(), dispatched = [];
  class WheelEvent { constructor(type, init) { Object.assign(this, { type, ...init }); } }
  const win = { WheelEvent, addEventListener: (n, fn) => handlers.set(n, fn), removeEventListener: n => handlers.delete(n) };
  const canvas = { tagName: 'CANVAS', closest: sel => sel === '.excalidraw' ? {} : null, dispatchEvent: e => dispatched.push(e) };
  const clean = attachWheelZoom(win);
  const fire = (over = {}) => {
    const e = { target: canvas, deltaY: 100, deltaX: 0, deltaMode: 0, clientX: 5, clientY: 6, ctrlKey: false, metaKey: false, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() {}, ...over };
    handlers.get('wheel')(e); return e;
  };
  return { fire, dispatched, clean, handlers, canvas };
}
test('plain wheel on the canvas becomes a Ctrl+wheel zoom at the same point', () => {
  const f = wheelFixture();
  const e = f.fire();
  assert.equal(e.prevented, true); assert.equal(e.stopped, true);
  assert.equal(f.dispatched.length, 1);
  assert.deepEqual([f.dispatched[0].ctrlKey, f.dispatched[0].deltaY, f.dispatched[0].clientX, f.dispatched[0].clientY], [true, 100, 5, 6]);
  f.fire({ deltaMode: 1, deltaY: -3 }); assert.equal(f.dispatched[1].deltaY, -99);
  f.clean(); assert.equal(f.handlers.size, 0);
});
test('ctrl/meta wheel, panels and non-canvas targets are left alone', () => {
  const f = wheelFixture();
  assert.equal(f.fire({ ctrlKey: true }).prevented, false);
  assert.equal(f.fire({ metaKey: true }).prevented, false);
  assert.equal(f.fire({ target: { tagName: 'DIV', closest: () => ({}) } }).prevented, false);
  assert.equal(f.fire({ target: { tagName: 'CANVAS', closest: () => null } }).prevented, false);
  assert.equal(f.dispatched.length, 0); f.clean();
});
