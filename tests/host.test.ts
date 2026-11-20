// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incomingType, postToHost, setHost, tap } from '../src/shared/host';
import { SLUG } from '../src/brand';

const event = (data: unknown, init: Partial<MessageEventInit> = {}) => new MessageEvent('message', { data, ...init });

afterEach(() => {
  setHost(undefined);
  vi.restoreAllMocks();
});

describe('postToHost', () => {
  it('tags what it posts with the tool, so a host can tell ours from the game\'s', () => {
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    postToHost({ type: 'INSPECTOR_READY' });
    expect(post).toHaveBeenCalledWith({ type: 'INSPECTOR_READY', source: SLUG }, '*');
  });

  it('posts to the named origin alone, under the host\'s own name for the message', () => {
    setHost({ origin: 'https://editor.example', aliases: { out: { INSPECTOR_READY: 'EDITOR_READY' } } });
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    postToHost({ type: 'INSPECTOR_READY' });
    expect(post).toHaveBeenCalledWith({ type: 'EDITOR_READY', source: SLUG }, 'https://editor.example');
  });

  it('lets a listener in the page hear every message, until it leaves', () => {
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    const heard: unknown[] = [];
    const leave = tap((m) => heard.push(m.type));
    postToHost({ type: 'GAME_PAUSED' });
    leave();
    postToHost({ type: 'GAME_RESUMED' });
    expect(heard).toEqual(['GAME_PAUSED']);
  });
  it('posts one message under several names when a host needs both', () => {
    setHost({ aliases: { out: { SCENE_TREE: ['SCENE_TREE', 'EDITOR_TREE'] } } });
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    postToHost({ type: 'SCENE_TREE', tree: 1 }, 'profiler-tag');
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      { type: 'SCENE_TREE', tree: 1, source: 'profiler-tag' },
      { type: 'EDITOR_TREE', tree: 1, source: 'profiler-tag' },
    ]);
  });
});

describe('incomingType', () => {
  it('reads a command, and never one of our own messages coming back', () => {
    expect(incomingType(event({ type: 'INSPECTOR_PAUSE' }))).toBe('INSPECTOR_PAUSE');
    expect(incomingType(event({ type: 'GAME_PAUSED', source: SLUG }))).toBeNull();
    expect(incomingType(event('not a message'))).toBeNull();
  });

  it('with an origin named, takes commands from it and from this window only', () => {
    setHost({ origin: 'https://editor.example' });
    expect(incomingType(event({ type: 'INSPECTOR_PAUSE' }, { origin: 'https://editor.example' }))).toBe('INSPECTOR_PAUSE');
    expect(incomingType(event({ type: 'INSPECTOR_PAUSE' }, { origin: 'https://evil.example' }))).toBeNull();
    expect(incomingType(event({ type: 'INSPECTOR_PAUSE' }, { origin: 'http://localhost', source: window }))).toBe('INSPECTOR_PAUSE');
  });

  it('maps a host\'s own name for a command to ours', () => {
    setHost({ aliases: { in: { EDITOR_PAUSE: 'INSPECTOR_PAUSE' } } });
    expect(incomingType(event({ type: 'EDITOR_PAUSE' }))).toBe('INSPECTOR_PAUSE');
  });
});
