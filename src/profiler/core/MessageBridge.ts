/**
 * MessageBridge - postMessage between the profiler and its host.
 */

import type { EngineType, ProfilerInMessage, ProfilerInMessageType } from './types';
import { incomingType, postToHost } from '../../shared/host';
import { SOURCE_PROFILER } from '../../brand';

export type MessageHandler = (message: ProfilerInMessage) => void;

export class MessageBridge {
  private readonly engine: EngineType;
  private handlers: Map<ProfilerInMessageType, MessageHandler[]> = new Map();
  private isListening = false;
  private boundHandleMessage: (event: MessageEvent) => void;

  constructor(engine: EngineType) {
    this.engine = engine;
    this.boundHandleMessage = this.handleMessage.bind(this);
  }

  /** Send a message to the host. */
  send(message: Record<string, unknown>): void {
    postToHost({ ...message, engine: this.engine }, SOURCE_PROFILER);
  }

  /**
   * Register a handler for incoming editor messages
   */
  on(type: ProfilerInMessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);

    if (!this.isListening) {
      this.startListening();
    }
  }

  /**
   * Remove a handler
   */
  off(type: ProfilerInMessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  private startListening(): void {
    if (this.isListening) return;
    this.isListening = true;
    window.addEventListener('message', this.boundHandleMessage);
  }

  private handleMessage(event: MessageEvent): void {
    const type = incomingType(event);
    if (!type) return;

    const normalizedType = this.normalizeMessageType(type);
    if (!normalizedType) return;

    const handlers = this.handlers.get(normalizedType);
    if (handlers) {
      const message: ProfilerInMessage = {
        type: normalizedType,
        config: event.data.config,
      };
      for (const handler of handlers) {
        handler(message);
      }
    }
  }

  private normalizeMessageType(type: string): ProfilerInMessageType | null {
    switch (type) {
      case 'PROFILER_START':
      case 'START_PROFILER':
        return 'PROFILER_START';

      case 'PROFILER_STOP':
      case 'STOP_PROFILER':
        return 'PROFILER_STOP';

      case 'PROFILER_REQUEST_SNAPSHOT':
      case 'REQUEST_PROFILER_SNAPSHOT':
        return 'PROFILER_REQUEST_SNAPSHOT';

      case 'PROFILER_SET_CONFIG':
      case 'SET_PROFILER_CONFIG':
        return 'PROFILER_SET_CONFIG';

      default:
        return null;
    }
  }

  /**
   * Cleanup - remove event listener
   */
  destroy(): void {
    if (this.isListening) {
      window.removeEventListener('message', this.boundHandleMessage);
      this.isListening = false;
    }
    this.handlers.clear();
  }
}
