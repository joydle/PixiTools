/**
 * The host: whoever these tools talk to over postMessage. In an iframe it is
 * the page around the game (an editor, a test runner); in a page of its own it
 * is the page itself, which is how the built-in panel listens.
 */

import { SOURCE_INSPECTOR, SOURCE_PROFILER } from '../brand';

export interface HostOptions {
  /**
   * The one origin to post to and to accept commands from. Unset, messages go
   * to any parent ('*') and commands are taken from any window: right for a
   * local dev page, wrong for a page other sites can frame.
   */
  origin?: string;
  /**
   * Other names a host uses for our messages: `in` maps a name it sends to
   * ours, `out` maps a name we send to the one it listens for (or to several:
   * the message is posted once under each).
   */
  aliases?: { in?: Record<string, string>; out?: Record<string, string | string[]> };
}

let host: HostOptions = {};

/** Set once, before the tools start; both the inspector and the profiler read it. */
export function setHost(options: HostOptions | undefined): void {
  host = options ?? {};
}

const taps = new Set<(message: Record<string, unknown>) => void>();

/** Hear every message the tools post, in this window (the built-in panel does). Returns the undo. */
export function tap(listener: (message: Record<string, unknown>) => void): () => void {
  taps.add(listener);
  return () => { taps.delete(listener); };
}

/** Post one message to the host, tagged with the tool's `source` so a host can tell ours from the game's. */
export function postToHost(message: Record<string, unknown>, source: string = SOURCE_INSPECTOR): void {
  const type = message.type;
  const out = typeof type === 'string' ? host.aliases?.out?.[type] : undefined;
  for (const listener of taps) listener(message);
  const names = out === undefined ? [type] : Array.isArray(out) ? out : [out];
  for (const name of names) {
    try {
      window.parent.postMessage({ ...message, type: name, source }, host.origin ?? '*');
    } catch {
      // A detached or cross-origin-restricted parent: nothing listens.
    }
  }
}

/** The message's type under our name, or null when it is not for us to read. */
export function incomingType(event: MessageEvent): string | null {
  const data = event.data as { type?: unknown; source?: unknown } | null | undefined;
  if (!data || typeof data.type !== 'string') return null;
  // What we posted ourselves comes back when the host is this same window.
  if (data.source === SOURCE_INSPECTOR || data.source === SOURCE_PROFILER) return null;
  if (host.origin && event.origin !== host.origin && event.source !== window) return null;
  return host.aliases?.in?.[data.type] ?? data.type;
}
