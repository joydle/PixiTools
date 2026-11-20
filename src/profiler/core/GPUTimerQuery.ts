/**
 * GPUTimerQuery - WebGL GPU timing via EXT_disjoint_timer_query
 *
 * Wraps the EXT_disjoint_timer_query / EXT_disjoint_timer_query_webgl2
 * extension for GPU-side frame timing. Gracefully degrades when unavailable.
 *
 * Usage pattern:
 *   gpuTimer.beginFrame();
 *   renderer.render(scene, camera);
 *   gpuTimer.endFrame();
 *   // ... next frame ...
 *   const gpuMs = gpuTimer.getResult(); // result from *previous* frame
 *
 * Note: GPU timer results are asynchronous — you get the result of the
 * previous frame, not the current one. This is by design (GPU/CPU async).
 */

// WebGL extension interfaces
interface EXTDisjointTimerQuery {
  QUERY_COUNTER_BITS_EXT: number;
  CURRENT_QUERY_EXT: number;
  QUERY_RESULT_EXT: number;
  QUERY_RESULT_AVAILABLE_EXT: number;
  TIME_ELAPSED_EXT: number;
  TIMESTAMP_EXT: number;
  GPU_DISJOINT_EXT: number;
  createQueryEXT(): WebGLQuery;
  deleteQueryEXT(query: WebGLQuery): void;
  beginQueryEXT(target: number, query: WebGLQuery): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(query: WebGLQuery, pname: number): unknown;
}

export class GPUTimerQuery {
  private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private ext: EXTDisjointTimerQuery | null = null;
  private isWebGL2 = false;
  private _available = false;

  // Double-buffer queries: one being measured, one being read
  private currentQuery: WebGLQuery | null = null;
  private pendingQuery: WebGLQuery | null = null;
  private lastResult: number | null = null;
  private frameActive = false;

  constructor(gl: WebGL2RenderingContext | WebGLRenderingContext | null) {
    if (!gl) return;
    this.gl = gl;
    this.isWebGL2 = 'createQuery' in gl;
    this.initExtension();
  }

  private initExtension(): void {
    if (!this.gl) return;

    try {
      if (this.isWebGL2) {
        // WebGL2: use built-in query API with the extension for TIME_ELAPSED
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as EXTDisjointTimerQuery;
      }

      if (!this.ext) {
        // WebGL1 or WebGL2 without the new extension: try the old one
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query') as unknown as EXTDisjointTimerQuery;
      }

      if (this.ext) {
        this._available = true;
      }
    } catch {
      // Extension not available — degrade gracefully
      this._available = false;
    }
  }

  /** Whether GPU timing is available on this context */
  get available(): boolean {
    return this._available;
  }

  /** Begin timing the current frame's GPU work */
  beginFrame(): void {
    if (!this._available || !this.gl || !this.ext || this.frameActive) return;

    // Resolve the previous frame's query before starting a new one
    this.resolvePendingQuery();

    // Move current → pending
    if (this.currentQuery) {
      this.pendingQuery = this.currentQuery;
    }

    // Create new query for this frame
    try {
      if (this.isWebGL2) {
        this.currentQuery = (this.gl as WebGL2RenderingContext).createQuery();
        if (this.currentQuery) {
          (this.gl as WebGL2RenderingContext).beginQuery(this.ext.TIME_ELAPSED_EXT, this.currentQuery);
          this.frameActive = true;
        }
      } else {
        this.currentQuery = this.ext.createQueryEXT();
        if (this.currentQuery) {
          this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, this.currentQuery);
          this.frameActive = true;
        }
      }
    } catch {
      // Query creation failed — disable
      this._available = false;
    }
  }

  /** End timing the current frame's GPU work */
  endFrame(): void {
    if (!this._available || !this.gl || !this.ext || !this.frameActive) return;

    try {
      if (this.isWebGL2) {
        (this.gl as WebGL2RenderingContext).endQuery(this.ext.TIME_ELAPSED_EXT);
      } else {
        this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);
      }
    } catch {
      this._available = false;
    }

    this.frameActive = false;
  }

  /** Get the GPU time in milliseconds from the last completed query */
  getResult(): number | null {
    this.resolvePendingQuery();
    return this.lastResult;
  }

  private resolvePendingQuery(): void {
    if (!this.pendingQuery || !this.gl || !this.ext) return;

    try {
      // Check for GPU disjoint (context was lost/reset)
      const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (disjoint) {
        // Results are unreliable, discard
        this.cleanupQuery(this.pendingQuery);
        this.pendingQuery = null;
        this.lastResult = null;
        return;
      }

      let available: unknown;
      let resultNs: unknown;

      if (this.isWebGL2) {
        const gl2 = this.gl as WebGL2RenderingContext;
        available = gl2.getQueryParameter(this.pendingQuery, gl2.QUERY_RESULT_AVAILABLE);
        if (available) {
          resultNs = gl2.getQueryParameter(this.pendingQuery, gl2.QUERY_RESULT);
        }
      } else {
        available = this.ext.getQueryObjectEXT(this.pendingQuery, this.ext.QUERY_RESULT_AVAILABLE_EXT);
        if (available) {
          resultNs = this.ext.getQueryObjectEXT(this.pendingQuery, this.ext.QUERY_RESULT_EXT);
        }
      }

      if (available && typeof resultNs === 'number') {
        this.lastResult = resultNs / 1_000_000; // nanoseconds → milliseconds
        this.cleanupQuery(this.pendingQuery);
        this.pendingQuery = null;
      }
      // If not available yet, keep pending for next check
    } catch {
      if (this.pendingQuery) this.cleanupQuery(this.pendingQuery);
      this.pendingQuery = null;
      this.lastResult = null;
    }
  }

  private cleanupQuery(query: WebGLQuery): void {
    try {
      if (this.isWebGL2) {
        (this.gl as WebGL2RenderingContext).deleteQuery(query);
      } else if (this.ext) {
        this.ext.deleteQueryEXT(query);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /** Clean up all resources */
  destroy(): void {
    if (this.currentQuery) {
      if (this.frameActive) {
        this.endFrame();
      }
      this.cleanupQuery(this.currentQuery);
      this.currentQuery = null;
    }
    if (this.pendingQuery) {
      this.cleanupQuery(this.pendingQuery);
      this.pendingQuery = null;
    }
    this._available = false;
  }
}
