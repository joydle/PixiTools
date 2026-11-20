// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBridge } from '../../src/inspector/core/MessageBridge';

/**
 * Post a message to `window` and let the (synchronous) 'message' listeners run.
 * jsdom dispatches MessageEvent listeners synchronously, so no await is needed.
 */
function postToWindow(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('MessageBridge — listener lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('destroy() removes the SAME listener reference it added', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const bridge = new MessageBridge('threejs');
    bridge.on('INSPECTOR_PAUSE', () => {});
    bridge.destroy();

    const added = add.mock.calls.find((c) => c[0] === 'message');
    const removed = remove.mock.calls.find((c) => c[0] === 'message');
    expect(added).toBeTruthy();
    expect(removed).toBeTruthy();
    // The bug: .bind(this) at add-time != .bind(this) at remove-time → no-op.
    // The fix: one stored bound reference used for both.
    expect(removed![1]).toBe(added![1]);
  });

  it('stops firing handlers after destroy() (no leaked listener)', () => {
    const bridge = new MessageBridge('pixi');
    const handler = vi.fn();
    bridge.on('INSPECTOR_PAUSE', handler);

    postToWindow({ type: 'PAUSE_GAME' }); // alias → INSPECTOR_PAUSE
    expect(handler).toHaveBeenCalledTimes(1);

    bridge.destroy();
    postToWindow({ type: 'PAUSE_GAME' });
    expect(handler).toHaveBeenCalledTimes(1); // no further calls — listener gone
  });

  it('detaches the window listener on destroy (no accumulation across reloads)', () => {
    // Count live 'message' listeners by watching add/remove balance.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    for (let i = 0; i < 3; i++) {
      const b = new MessageBridge('threejs');
      b.on('INSPECTOR_PAUSE', () => {});
      b.destroy();
    }
    const added = add.mock.calls.filter((c) => c[0] === 'message').length;
    const removedRefs = new Set(remove.mock.calls.filter((c) => c[0] === 'message').map((c) => c[1]));
    const addedRefs = new Set(add.mock.calls.filter((c) => c[0] === 'message').map((c) => c[1]));
    // Every added 'message' listener ref must also have been removed.
    expect(added).toBe(3);
    for (const ref of addedRefs) {
      expect(removedRefs.has(ref)).toBe(true);
    }
  });

  it('two bridges over their lifecycle do not stack a leaked listener', () => {
    // Simulates a hot reload: build a bridge, destroy it, build another.
    const first = new MessageBridge('threejs');
    const firstHandler = vi.fn();
    first.on('INSPECTOR_RESUME', firstHandler);
    first.destroy();

    const second = new MessageBridge('threejs');
    const secondHandler = vi.fn();
    second.on('INSPECTOR_RESUME', secondHandler);

    postToWindow({ type: 'RESUME_GAME' });
    expect(firstHandler).not.toHaveBeenCalled(); // destroyed bridge is silent
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });
});

describe('engine version stamping', () => {
  it('send() includes engineVersion from the lazy resolver when it resolves', () => {
    const posted: Record<string, unknown>[] = [];
    const orig = window.parent.postMessage;
    (window.parent as { postMessage: unknown }).postMessage = (msg: Record<string, unknown>) => posted.push(msg);
    try {
      let version: string | undefined;
      const bridge = new MessageBridge('threejs', () => version);
      bridge.send({ type: 'PING' });
      version = 'r171'; // engine global attached late — resolver re-runs per send
      bridge.send({ type: 'PING' });
      expect(posted[0]).not.toHaveProperty('engineVersion');
      expect(posted[1]).toMatchObject({ engine: 'threejs', engineVersion: 'r171' });
    } finally {
      (window.parent as { postMessage: unknown }).postMessage = orig;
    }
  });
});

describe('MessageBridge — the host-neutral names (a host that names no platform)', () => {
  it('routes GET_SCENE_TREE and SELECT_OBJECT, with the target', () => {
    const bridge = new MessageBridge('pixi');
    const tree = vi.fn();
    const select = vi.fn();
    bridge.on('GET_SCENE_TREE', tree);
    bridge.on('SELECT_OBJECT', select);
    postToWindow({ type: 'GET_SCENE_TREE' });
    postToWindow({ type: 'SELECT_OBJECT', target: 'courier' });
    expect(tree).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECT_OBJECT', target: 'courier' }));
    bridge.destroy();
  });

  it('carries a scene-tree place with SELECT_OBJECT, and only a real one', () => {
    const bridge = new MessageBridge('three');
    const select = vi.fn();
    bridge.on('SELECT_OBJECT', select);
    postToWindow({ type: 'SELECT_OBJECT', target: 'Mesh', path: [0, 4] });
    expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ target: 'Mesh', path: [0, 4] }));
    for (const path of [[-1], [1.5], ['0'], 'nope']) {
      postToWindow({ type: 'SELECT_OBJECT', target: 'Mesh', path });
      expect(select.mock.lastCall?.[0].path).toBeUndefined();
    }
    bridge.destroy();
  });

  it('passes a screenshot requestId through to the handler, and only a sane one', () => {
    const bridge = new MessageBridge('pixi');
    const seen: Array<string | undefined> = [];
    bridge.on('REQUEST_SCREENSHOT', (msg) => seen.push(msg.requestId));
    postToWindow({ type: 'REQUEST_SCREENSHOT', requestId: 'shot-1' });
    postToWindow({ type: 'REQUEST_SCREENSHOT' });
    postToWindow({ type: 'REQUEST_SCREENSHOT', requestId: 42 });
    postToWindow({ type: 'REQUEST_SCREENSHOT', requestId: 'x'.repeat(200) });
    expect(seen).toEqual(['shot-1', undefined, undefined, undefined]);
    bridge.destroy();
  });
});
