/**
 * Error Tracker - Global runtime error handler for game previews
 *
 * Captures JavaScript errors, unhandled promise rejections, and console.error calls
 * Sends them to the parent window (host) for AI-powered debugging
 */

import type { RuntimeError } from './types';
import type { MessageBridge } from './MessageBridge';
import type { SourceMapResolver } from './SourceMapResolver';
import { sourceRefFromStack } from './StackParser';

export class ErrorTracker {
  private readonly messages: MessageBridge;
  private readonly sourceMapResolver: SourceMapResolver;
  private errors: RuntimeError[] = [];
  private maxErrors = 50; // Prevent memory leak from too many errors
  private errorHashes = new Set<string>(); // Deduplicate identical errors
  /** Source-map resolutions still running (an agent reading the list waits for them). */
  private inflight = new Set<Promise<void>>();

  // Store original console.error for restoration
  private originalConsoleError: typeof console.error;

  constructor(messages: MessageBridge, sourceMapResolver: SourceMapResolver) {
    this.messages = messages;
    this.sourceMapResolver = sourceMapResolver;
    this.originalConsoleError = console.error;
  }

  /**
   * Initialize global error handlers
   */
  init(): void {
    // Capture JavaScript errors
    window.addEventListener('error', this.handleError);

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', this.handleRejection);

    // Override console.error to capture framework errors
    console.error = this.handleConsoleError;
  }

  /**
   * Handle window.onerror events
   */
  private handleError = (event: ErrorEvent): void => {
    const error: RuntimeError = {
      type: 'error',
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      timestamp: Date.now(),
    };

    this.trackError(error);
  };

  /**
   * Handle unhandled promise rejections
   */
  private handleRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    const error: RuntimeError = {
      type: 'unhandledrejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
      timestamp: Date.now(),
    };

    this.trackError(error);
  };

  /**
   * Handle console.error calls (captures framework errors)
   */
  private handleConsoleError = (...args: unknown[]): void => {
    // Call original console.error so errors still show in console
    this.originalConsoleError.apply(console, args);

    // Extract error message
    const message = args
      .map(arg => {
        if (arg instanceof Error) return arg.message;
        if (typeof arg === 'string') return arg;
        return String(arg);
      })
      .join(' ');

    // Get stack trace if first arg is an Error
    const stack = args[0] instanceof Error ? args[0].stack : undefined;

    const error: RuntimeError = {
      type: 'console_error',
      message,
      stack,
      timestamp: Date.now(),
    };

    this.trackError(error);
  };

  /**
   * Track an error (deduplicate, resolve source map, and send to editor)
   */
  private trackError(error: RuntimeError): void {
    // Create hash for deduplication (message + line + column)
    const hash = `${error.message}-${error.filename || ''}-${error.line || 0}-${error.column || 0}`;

    // Skip if we've already seen this exact error
    if (this.errorHashes.has(hash)) {
      return;
    }

    // Add to tracking
    this.errorHashes.add(hash);
    this.errors.push(error);

    // Enforce max error limit (remove oldest)
    if (this.errors.length > this.maxErrors) {
      const removed = this.errors.shift();
      if (removed) {
        const removedHash = `${removed.message}-${removed.filename || ''}-${removed.line || 0}-${removed.column || 0}`;
        this.errorHashes.delete(removedHash);
      }
    }

    // Resolve source map then send (fire-and-forget async)
    const p = this.resolveAndSend(error);
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  /** Resolves once every error seen so far has its source line (or failed to get one). */
  async settled(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /**
   * Resolve error location through source map, then send to parent.
   * Falls back to raw location if resolution fails.
   */
  private async resolveAndSend(error: RuntimeError): Promise<void> {
    // A rejection or a console.error(err) has no filename: the first frame of
    // the game's own code in its stack is where it came from.
    const ref = error.filename && error.line != null && error.column != null
      ? { f: error.filename, l: error.line, c: error.column }
      : sourceRefFromStack(error.stack);
    if (ref) {
      try {
        const resolved = await this.sourceMapResolver.resolve(ref);
        if (resolved) {
          error.originalSource = resolved.source;
          error.originalLine = resolved.line;
          error.originalColumn = resolved.column;
          error.originalSourceLine = resolved.sourceLine;
        }
      } catch {
        // Source map resolution is best-effort
      }
    }

    this.messages.send({
      type: 'RUNTIME_ERROR',
      error,
    });
  }

  /**
   * Get all tracked errors
   */
  getErrors(): readonly RuntimeError[] {
    return this.errors;
  }

  /**
   * Clear all tracked errors
   */
  clearErrors(): void {
    this.errors = [];
    this.errorHashes.clear();
  }

  /**
   * Cleanup - restore original error handlers
   */
  destroy(): void {
    window.removeEventListener('error', this.handleError);
    window.removeEventListener('unhandledrejection', this.handleRejection);
    console.error = this.originalConsoleError;
  }
}
