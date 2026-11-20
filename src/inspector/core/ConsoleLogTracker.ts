/**
 * ConsoleLogTracker - Captures console.log and console.warn from game code.
 *
 * Intercepts the console methods and forwards game-originated messages to the
 * host as CONSOLE_LOG. Our own logs are dropped at log/warn level; errors are
 * always forwarded.
 */

import type { ConsoleLogLevel } from './types';
import type { MessageBridge } from './MessageBridge';
import { SLUG } from '../../brand';

/** Max ring-buffer size in the tracker itself (parent has its own ring). */
const MAX_ENTRIES = 200;

/** Our own logs start with the tool's name in brackets. */
function isOwnLog(message: string): boolean {
  return message.toLowerCase().startsWith(`[${SLUG}`);
}

export class ConsoleLogTracker {
  private readonly messages: MessageBridge;
  private entryCount = 0;

  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;

  constructor(messages: MessageBridge) {
    this.messages = messages;
    this.originalLog = console.log;
    this.originalWarn = console.warn;
  }

  private active = false;

  init(): void {
    this.active = true;
    console.log = this.interceptLog;
    console.warn = this.interceptWarn;
  }

  private send(level: ConsoleLogLevel, args: unknown[]): void {
    if (this.entryCount >= MAX_ENTRIES) return;

    const message = args
      .map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try { return JSON.stringify(a); } catch { return String(a); }
      })
      .join(' ');

    // Always forward errors; skip our own log/warn to avoid noise.
    if (level !== 'error' && isOwnLog(message)) return;

    this.entryCount++;
    this.messages.send({
      type: 'CONSOLE_LOG',
      entry: { level, message, timestamp: Date.now() },
    });
  }

  private interceptLog = (...args: unknown[]): void => {
    this.originalLog.apply(console, args);
    this.send('log', args);
  };

  private interceptWarn = (...args: unknown[]): void => {
    this.originalWarn.apply(console, args);
    this.send('warn', args);
  };

  /** Reset entry counter (e.g. on game restart). */
  resetCount(): void {
    this.entryCount = 0;
  }

  destroy(): void {
    if (!this.active) return;
    this.active = false;
    console.log = this.originalLog;
    console.warn = this.originalWarn;
  }
}
