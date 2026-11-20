/**
 * Source Map Resolver — lazy, cached resolution of bundled→original source locations.
 *
 * Fetches .map files on demand (only when inspector opens), caches SourceMapConsumer
 * instances, and resolves { f, l, c } → { source, line, sourceLine, varName }.
 *
 * In Vite dev mode (unbundled), skips resolution — raw stack is already correct.
 * If .map file not found, falls back to the raw bundled location.
 */

import { SourceMapConsumer } from 'source-map-js';
import { ResolvedSource } from './types';
import { NAME } from '../../brand';

export class SourceMapResolver {
  /** Cached SourceMapConsumer instances (null = fetch failed, don't retry) */
  private consumers = new Map<string, SourceMapConsumer | null>();

  /** In-flight fetch promises (deduplication) */
  private pending = new Map<string, Promise<SourceMapConsumer | null>>();

  /**
   * Resolve a compact source ref to the original source location.
   *
   * @param src The { f: fileUrl, l: line, c: column } from obj.__src
   * @returns Resolved original source, or null if resolution failed
   */
  async resolve(src: { f: string; l: number; c: number }): Promise<ResolvedSource | null> {
    // Unbundled ESM (Vite dev `?t=` or no file hash) → raw is already the original.
    // We *don't* gate on `location.host === localhost:*` because the preview
    // iframe runs on a localhost port too but serves *bundled* `assets/index-*.js`
    // — that false positive made the resolver short-circuit and we lost every
    // map resolution. The shape of the URL is the only reliable signal.
    if (!looksBundled(src.f)) {
      let path = src.f;
      try { path = new URL(src.f).pathname; } catch { /* keep the raw string */ }
      // A dev server's module is the TRANSFORMED file (types stripped, imports
      // rewritten), so its line is not the source's. Vite serves it with an
      // inline map; read it once per module, and fall back to the raw line.
      if (isDevModule(src.f)) {
        const inline = await this.getInlineConsumer(src.f);
        if (inline) {
          const pos = inline.originalPositionFor({ line: src.l, column: src.c });
          if (pos.source && pos.line) {
            const out: ResolvedSource = { source: path, line: pos.line, column: pos.column ?? undefined };
            this.fillSourceLine(inline, pos.source, pos.line, out);
            return out;
          }
        }
      }
      // A plain module served as written (an import map, no bundler): the file
      // is the source, so its own line is the text.
      const out: ResolvedSource = { source: path, line: src.l, column: src.c };
      const text = await this.getText(src.f);
      const sourceLine = text?.split('\n')[src.l - 1];
      if (sourceLine && sourceLine.length <= 400) {
        out.sourceLine = sourceLine.trim();
        const varMatch = sourceLine.match(/(?:const|let|var)\s+(\w+)\s*=|this\.(\w+)\s*=/);
        if (varMatch) out.varName = varMatch[1] || varMatch[2];
      }
      return out;
    }

    // Get or fetch SourceMapConsumer for this file
    const consumer = await this.getConsumer(src.f);
    if (!consumer) {
      // No source map available → return bundled location as-is
      return {
        source: this.extractPath(src.f),
        line: src.l,
        column: src.c,
      };
    }

    // Resolve to original position
    const pos = consumer.originalPositionFor({
      line: src.l,
      column: src.c,
    });

    if (!pos.source) {
      console.warn(
        `[${NAME}] source map present but no mapping for ${src.f}:${src.l}:${src.c} ` +
          `(position outside mapped ranges — bundler boilerplate or generated code)`,
      );
      return null;
    }

    const result: ResolvedSource = {
      source: this.normalizePath(pos.source),
      line: pos.line!,
      column: pos.column ?? undefined,
    };

    if (pos.line) this.fillSourceLine(consumer, pos.source, pos.line, result);
    return result;
  }

  /** The source line's text (and the variable it assigns) from the map's embedded content. */
  private fillSourceLine(consumer: SourceMapConsumer, source: string, line: number, result: ResolvedSource): void {
    try {
      const content = consumer.sourceContentFor(source, true);
      const sourceLine = content?.split('\n')[line - 1];
      if (!sourceLine) return;
      result.sourceLine = sourceLine.trim();
      // Extract variable name from assignment patterns
      const varMatch = sourceLine.match(/(?:const|let|var)\s+(\w+)\s*=|this\.(\w+)\s*=/);
      if (varMatch) result.varName = varMatch[1] || varMatch[2];
    } catch {
      // Source content not available — that's fine
    }
  }

  /** A module's text as served (cached, failures too; nothing over 2 MB is kept). */
  private texts = new Map<string, Promise<string | null>>();
  private getText(fileUrl: string): Promise<string | null> {
    let p = this.texts.get(fileUrl);
    if (!p) {
      p = fetch(fileUrl)
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => (text && text.length <= 2 * 1024 * 1024 ? text : null))
        .catch(() => null);
      this.texts.set(fileUrl, p);
    }
    return p;
  }

  /** The inline map a dev server put at the end of a module (cached, failures too). */
  private getInlineConsumer(fileUrl: string): Promise<SourceMapConsumer | null> {
    const key = `inline:${fileUrl}`;
    if (this.consumers.has(key)) return Promise.resolve(this.consumers.get(key)!);
    let p = this.pending.get(key);
    if (!p) {
      p = fetch(fileUrl)
        .then((r) => (r.ok ? r.text() : ''))
        .then((text) => {
          const raw = inlineMapOf(text);
          return raw ? new SourceMapConsumer(raw as unknown as ConstructorParameters<typeof SourceMapConsumer>[0]) : null;
        })
        .catch(() => null)
        .then((c) => { this.consumers.set(key, c); this.pending.delete(key); return c; });
      this.pending.set(key, p);
    }
    return p;
  }

  /**
   * Get a cached consumer or fetch the source map for the given file URL.
   */
  private async getConsumer(
    fileUrl: string,
  ): Promise<SourceMapConsumer | null> {
    // Check cache
    if (this.consumers.has(fileUrl)) {
      return this.consumers.get(fileUrl)!;
    }

    // Check in-flight
    if (this.pending.has(fileUrl)) {
      return this.pending.get(fileUrl)!;
    }

    // Fetch and cache
    const promise = this.fetchMap(fileUrl);
    this.pending.set(fileUrl, promise);

    const consumer = await promise;
    this.consumers.set(fileUrl, consumer);
    this.pending.delete(fileUrl);

    return consumer;
  }

  /**
   * Fetch a .map file for the given JS file URL.
   * Returns null on failure (404, network error, parse error).
   */
  private async fetchMap(
    fileUrl: string,
  ): Promise<SourceMapConsumer | null> {
    const mapUrl = fileUrl + '.map';
    try {
      const resp = await fetch(mapUrl);
      if (!resp.ok) {
        console.warn(
          `[${NAME}] source map fetch failed for ${mapUrl}: HTTP ${resp.status} ` +
            `(build did not emit a .map alongside the bundle, or preview server is not serving it)`,
        );
        return null;
      }

      const rawMap = await resp.json();
      return new SourceMapConsumer(rawMap);
    } catch (e) {
      console.warn(
        `[${NAME}] source map fetch/parse error for ${mapUrl}:`,
        e,
      );
      return null; // Cache the failure
    }
  }

  /**
   * Extract a readable path from a full URL.
   */
  private extractPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  /**
   * Normalize source map paths — strip leading ../ prefixes.
   * Vite source maps use paths like "../../src/game.ts" relative to dist/assets/.
   */
  private normalizePath(path: string): string {
    return path.replace(/^(\.\.\/)+/, '');
  }
}

/**
 * Heuristic: does this URL look like a bundled/hashed Vite build artifact?
 *
 * Matches:
 *   /assets/index-UNkCtpsA.js     ← Vite build
 *   /assets/game-q3wzC8x_.mjs     ← Vite build (other entry / .mjs)
 *   any URL ending in -<hash>.js  ← hashed chunk
 *
 * Skips (returns false) for:
 *   /src/audio.ts?t=1234567890    ← Vite dev ESM with cache-bust
 *   /node_modules/...             ← unbundled dev imports
 *   /src/game.ts                  ← raw source served by dev server
 *
 * If anything here matches a `.js` URL we'll *try* to fetch the map — the
 * `consumers` Map caches failures (null) so a missing map costs one fetch
 * per page load, not per error.
 */
function looksBundled(fileUrl: string): boolean {
  try {
    const url = new URL(fileUrl);
    const path = url.pathname;
    // Vite dev ESM serves raw `.ts` / `.tsx` / `.vue` etc. — those obviously
    // aren't bundled output. Only `.js` / `.mjs` / `.cjs` can be.
    if (!/\.(?:js|mjs|cjs)$/.test(path)) return false;
    // Cache-busted dev modules: `/src/foo.js?t=…`
    if (url.searchParams.has('t')) return false;
    // Hashed build output: `/assets/<name>-<hash>.{js,mjs,cjs}`
    // Vite hashes are 8+ url-safe base64 chars.
    if (/-[A-Za-z0-9_-]{6,}\.(?:js|mjs|cjs)$/.test(path)) return true;
    // Fall-through: treat any `.js` under `/assets/` as bundled.
    if (path.startsWith('/assets/')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * A module a dev server transformed on the fly: TypeScript/JSX sources, or a
 * cache-busted `?t=` module. Their lines are the transform's, not the source's.
 */
export function isDevModule(fileUrl: string): boolean {
  try {
    const url = new URL(fileUrl);
    if (url.pathname.includes('/node_modules/') || url.pathname.startsWith('/@')) return false;
    return /\.(?:ts|tsx|jsx|mts|vue|svelte)$/.test(url.pathname) || url.searchParams.has('t');
  } catch {
    return false;
  }
}

/** The JSON of a trailing `//# sourceMappingURL=data:…;base64,…` comment, or null. */
export function inlineMapOf(code: string): Record<string, unknown> | null {
  const m = /\/\/[#@]\s*sourceMappingURL=data:application\/json[^,]*;base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  if (!m) return null;
  try {
    // atob gives bytes as Latin-1; the map is UTF-8 (source content may hold any text).
    const bytes = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
