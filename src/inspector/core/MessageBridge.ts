/**
 * Message Bridge - postMessage between the inspector and its host.
 */

import {
  EngineType,
  EditorMessage,
  EditorMessageType,
} from './types';
import { incomingType, postToHost } from '../../shared/host';

export type MessageHandler = (message: EditorMessage) => void;

export class MessageBridge {
  private readonly engine: EngineType;
  private handlers: Map<EditorMessageType, MessageHandler[]> = new Map();
  private isListening = false;
  /**
   * ONE stable bound reference for the window 'message' listener. `.bind(this)`
   * creates a NEW function each call, so binding separately at add- and
   * remove-time means removeEventListener never matches and the listener leaks
   * (one dead handler per hot reload).
   */
  private readonly boundHandleMessage = this.handleMessage.bind(this);

  constructor(
    engine: EngineType,
    /** Lazily resolved on every send — engine globals (window.THREE / PIXI)
     *  often attach AFTER the bridge is constructed. */
    private readonly resolveEngineVersion?: () => string | undefined,
  ) {
    this.engine = engine;
  }

  /** Send a message to the host. */
  send(message: Record<string, unknown>): void {
    const engineVersion = this.resolveEngineVersion?.();
    postToHost({
      ...message,
      engine: this.engine,
      ...(engineVersion ? { engineVersion } : {}),
    });
  }

  /** Register a handler for a command from the host. */
  on(type: EditorMessageType, handler: MessageHandler): void {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);

    if (!this.isListening) {
      this.startListening();
    }
  }

  /** Remove a handler. */
  off(type: EditorMessageType, handler: MessageHandler): void {
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
      const data = event.data;
      const message: EditorMessage = {
        type: normalizedType,
        target: data.target,
      };
      // A scene-tree place, only when it is one: whole, non-negative indexes.
      if (Array.isArray(data.path) && data.path.length <= 64
        && data.path.every((i: unknown) => Number.isInteger(i) && (i as number) >= 0)) {
        message.path = data.path as number[];
      }
      // A host's correlation id for a screenshot request, echoed on its result
      // so the host can tell its own capture from another's.
      if (typeof data.requestId === 'string' && data.requestId.length > 0 && data.requestId.length <= 128) {
        message.requestId = data.requestId;
      }
      handlers.forEach(handler => handler(message));
    }
  }

  /** The commands a host may send, with the older names some hosts use. */
  private normalizeMessageType(type: string): EditorMessageType | null {
    switch (type) {
      case 'INSPECTOR_PAUSE':
      case 'ENABLE_INSPECTOR':
      case 'PAUSE_GAME':
        return 'INSPECTOR_PAUSE';

      case 'INSPECTOR_RESUME':
      case 'RESUME_GAME':
        return 'INSPECTOR_RESUME';

      case 'CLEAR_SELECTION':
      case 'GET_SCENE_TREE':
      case 'REQUEST_SCREENSHOT':
      case 'REQUEST_AREA_SCREENSHOT':
      case 'DETECT_ENGINE':
      case 'FOCUS_OBJECT':
      case 'SELECT_OBJECT':
        return type;

      default:
        return null;
    }
  }

  /** Cleanup - remove event listener */
  destroy(): void {
    if (this.isListening) {
      window.removeEventListener('message', this.boundHandleMessage);
      this.isListening = false;
    }
    this.handlers.clear();
  }
}
