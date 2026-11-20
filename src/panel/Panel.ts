/**
 * The built-in panel: a small host that lives in the game's own page. It reads
 * the same messages any host gets and sends the same commands, so it is also
 * the reference for writing one.
 */

import { NAME, ATTR_CHROME, id, globalSlot } from '../brand';
import { tap } from '../shared/host';
import type { ObjectMetadata, SceneTreeNode, RuntimeError, MaterialInfo } from '../inspector/core/types';
import type { FrameStats } from '../profiler/core/types';

const CSS = `
:host{all:initial;position:fixed;top:12px;right:12px;z-index:2147483600;color:#ecebe7;font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
.mono,.n,pre,.src,.xyz,.tree,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.glass{background:#101216e6;border:1px solid #ffffff1a;backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);box-shadow:0 12px 40px #0008,inset 0 1px 0 #ffffff0d}
.wrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px}

/* the bar: all there is until you ask for more */
.hud{display:flex;align-items:center;height:36px;border-radius:18px;padding:0 4px 0 12px;gap:10px;cursor:grab;user-select:none;touch-action:none}
.hud:active{cursor:grabbing}
.mark{width:9px;height:9px;border-radius:2.5px;background:var(--tone,#8fbf9f);box-shadow:0 0 10px var(--tone,#8fbf9f);transition:background .3s,box-shadow .3s}
.stats{display:flex;align-items:baseline;gap:12px;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer}
.stat{display:flex;align-items:baseline;gap:4px}
.n{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;color:#fff;min-width:2ch;text-align:right}
.u{font-size:10px;color:#8b8a85;letter-spacing:.02em}
.stats:hover .u{color:#b9b7b0}
.err{font:600 10px/1 ui-monospace,Menlo,monospace;color:#1a0d10;background:#ff7a8a;border:0;border-radius:99px;padding:4px 7px;cursor:pointer}
.pick{display:flex;align-items:center;gap:7px;height:28px;padding:0 10px 0 12px;border-radius:14px;border:0;background:#ffffff14;color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer;transition:background .15s,color .15s}
.pick:hover{background:#ffffff24}
.pick.on{background:#8fbf9f;color:#0d120e}
kbd{font-size:10px;font-weight:500;padding:2px 5px;border-radius:4px;background:#0006;color:#b9b7b0}
.pick.on kbd{background:#0d120e26;color:#0d120e}
button:focus-visible,input:focus-visible{outline:1.5px solid #8fbf9f;outline-offset:2px}

/* the card: one view at a time */
.card{width:320px;max-height:calc(100vh - 68px);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;animation:in .16s ease-out}
.card[hidden]{display:none}
@keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.tabs{display:flex;align-items:center;gap:2px;padding:6px 6px 0}
.tab{flex:none;height:26px;padding:0 10px;border:0;border-radius:8px;background:none;color:#8b8a85;font:500 12px/1 system-ui,sans-serif;cursor:pointer}
.tab:hover{color:#ecebe7}
.tab[aria-selected="true"]{background:#ffffff14;color:#fff}
.x{margin-left:auto;width:26px;height:26px;border:0;border-radius:8px;background:none;color:#8b8a85;font:400 16px/1 system-ui;cursor:pointer}
.x:hover{background:#ffffff14;color:#fff}
.view{padding:12px 14px 14px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ffffff26 transparent}
.hint{color:#8b8a85;padding:6px 0 2px;line-height:1.6}
.hint b{color:#ecebe7;font-weight:500}

/* object */
.head{display:flex;align-items:baseline;gap:8px}
.title{font-size:16px;font-weight:650;color:#fff;letter-spacing:-.01em;overflow-wrap:anywhere}
.chip{flex:none;font-size:10px;color:#b9b7b0;border:1px solid #ffffff24;border-radius:99px;padding:1px 7px}
.src{display:flex;align-items:center;gap:6px;margin-top:8px;padding:0;border:0;background:none;color:#a8d4bd;font-size:11.5px;cursor:pointer;text-align:left;overflow-wrap:anywhere}
.src:hover{color:#d3f0e1}
.src i{font-style:normal;color:#8b8a85;font-size:10px}
pre{margin:6px 0 0;padding:9px 10px;background:#0006;border-radius:8px;color:#f0deaa;font-size:11px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:92px;overflow:auto;scrollbar-width:thin}
.rows{display:grid;grid-template-columns:52px 1fr;gap:5px 10px;margin-top:12px;align-items:baseline}
.k{color:#8b8a85;font-size:11px}
.xyz{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11.5px;font-variant-numeric:tabular-nums}
.xyz span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xyz span::before{content:attr(data-a);margin-right:5px;font-size:9.5px;font-weight:600}
.xyz span:nth-child(1)::before{color:#ff8a98}.xyz span:nth-child(2)::before{color:#8fdcae}.xyz span:nth-child(3)::before{color:#8ab8ff}
.v{font-size:11.5px;overflow-wrap:anywhere}
.v .mono{font-size:11px}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;border:1px solid #ffffff33;vertical-align:-1px}
.off{color:#ffb86b}
.actions{display:flex;gap:6px;margin-top:14px}
.btn{flex:1;height:30px;border:0;border-radius:8px;background:#ffffff14;color:#ecebe7;font:500 12px/1 system-ui,sans-serif;cursor:pointer}
.btn:hover{background:#ffffff24;color:#fff}
.btn.main{background:#8fbf9f;color:#0d120e;font-weight:600}
.btn.main:hover{background:#a5d1b3}

/* scene */
.find{width:100%;height:30px;padding:0 10px;border:1px solid #ffffff1a;border-radius:8px;background:#0005;color:#fff;font:12px system-ui,sans-serif}
.find::placeholder{color:#6f6e6a}
.tree{margin:8px -6px 0;padding:0;list-style:none;font-size:11.5px}
.tree ul{margin:0;padding:0 0 0 14px;list-style:none}
.row{display:flex;align-items:center;gap:4px;height:24px;padding:0 6px;border-radius:6px;cursor:pointer;white-space:nowrap}
.row:hover{background:#ffffff12}
.row.sel{background:#8fbf9f26;color:#fff}
.row .tw{flex:none;width:14px;height:14px;border:0;padding:0;background:none;color:#8b8a85;font-size:8px;cursor:pointer;transition:transform .12s}
.row .tw.open{transform:rotate(90deg)}
.row .tw.none{visibility:hidden}
.row .nm{overflow:hidden;text-overflow:ellipsis}
.row .ty{margin-left:auto;padding-left:10px;color:#6f6e6a;font-size:10.5px}

/* perf */
.big{display:flex;align-items:flex-end;gap:12px}
.big .fps{font:650 34px/0.9 ui-monospace,Menlo,monospace;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.big .lab{font-size:11px;color:#8b8a85;padding-bottom:2px}
.big svg{margin-left:auto;width:120px;height:34px;overflow:visible}
.score{display:flex;align-items:center;gap:8px;margin-top:12px}
.score i{font:600 11px/1 system-ui;font-style:normal;padding:4px 8px;border-radius:99px;color:#0d120e}
.score span{color:#b9b7b0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:12px;background:#ffffff12;border-radius:10px;overflow:hidden}
.cell{background:#101216;padding:8px 10px}
.cell b{display:block;font:600 13px/1.2 ui-monospace,Menlo,monospace;color:#fff;font-variant-numeric:tabular-nums}
.cell span{font-size:10px;color:#8b8a85}
.issue{margin-top:10px;padding:9px 10px;border-radius:8px;background:#ffb86b14;border-left:2px solid #ffb86b}
.issue b{display:block;font-weight:600;color:#ffd9ad}
.issue span{color:#b9b7b0;font-size:11.5px}
.bad{margin-top:8px;padding:9px 10px;border-radius:8px;background:#ff7a8a14;border-left:2px solid #ff7a8a;overflow-wrap:anywhere}
.bad:first-child{margin-top:0}
.bad b{display:block;font-weight:500;color:#ffc2ca}
.bad span{font-size:11px;color:#a8d4bd}
@media (max-width:560px){.stat.wide{display:none}.card{width:min(320px,calc(100vw - 24px))}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
`;

const TONE: Record<string, string> = {
  excellent: '#7fe0a2', good: '#8fbf9f', 'needs-work': '#f2c66d', poor: '#ff9f5a', critical: '#ff7a8a',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const num = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100));
const vec = (v: object | undefined): string => (v ? Object.values(v).map((n) => num(n as number)).join(', ') : '');

/** The selection as plain text a person can paste to a coding agent. */
export function describeSelection(m: ObjectMetadata): string {
  const lines: string[] = [];
  const mat = m.material ?? m.materials?.[0];
  lines.push(`${m.typeName} "${m.type}"${mat?.type ? ` (${mat.type}${mat.color ? ` ${mat.color}` : ''})` : ''}`);
  const file = m.originalSource ?? m.sourceFile;
  const line = m.originalLine ?? m.sourceLine;
  if (file) lines.push(`created at ${file}${line ? `:${line}` : ''}`);
  if (m.originalSourceLine) lines.push(`  ${m.originalSourceLine.trim()}`);
  lines.push(`position ${vec(m.position)}${m.rotation ? ` | rotation ${vec(m.rotation)}` : ''} | scale ${vec(m.scale)}`);
  lines.push(`visible ${m.visible}${m.active === false ? ' (off in a parent)' : ''} | children ${m.childCount} | parent ${m.parentLabel || 'none'}`);
  if (m.texture) lines.push(`texture ${m.texture}`);
  if (m.tint && m.tint !== '#ffffff') lines.push(`tint ${m.tint}`);
  if (m.components?.length) lines.push(`parts ${m.components.map((c) => (c.enabled === false ? `${c.name} (off)` : c.name)).join(', ')}`);
  if (m.userData) lines.push(`userData ${JSON.stringify(m.userData)}`);
  return lines.join('\n');
}

type View = 'object' | 'scene' | 'perf' | 'errors';

export interface PanelOptions {
  /** The key that starts and stops picking. Default the backquote, as a game console; false for none. */
  hotkey?: string | false;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Math.abs(r) >= 1000 ? Math.round(r).toLocaleString('en-US') : String(r);
};
const short = (v: number): string => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : fmt(v));

export class Panel {
  private readonly host: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly mark: HTMLSpanElement;
  private readonly nums: Record<'fps' | 'ms' | 'draws' | 'tris', HTMLSpanElement>;
  private readonly errBadge: HTMLButtonElement;
  private readonly pick: HTMLButtonElement;
  private readonly card: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly untap: () => void;
  private readonly hotkey: string | false;

  private view: View | null = null;
  private paused = false;
  private selected: ObjectMetadata | null = null;
  private tree: SceneTreeNode | null = null;
  private stats: FrameStats | null = null;
  private history: number[] = [];
  private errors: RuntimeError[] = [];
  private filter = '';
  private readonly closed = new Set<string>();

  constructor(options: PanelOptions = {}) {
    this.hotkey = options.hotkey === undefined ? '`' : options.hotkey;
    this.host = el('div');
    this.host.id = id('panel');
    this.host.setAttribute(ATTR_CHROME, '');
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('style', undefined, CSS));
    const wrap = el('div', 'wrap');

    // The bar.
    this.hud = el('div', 'hud glass');
    this.mark = el('span', 'mark');
    this.mark.title = NAME;
    const stats = el('button', 'stats');
    stats.title = 'Performance';
    const stat = (unit: string, wide = false): HTMLSpanElement => {
      const box = el('span', wide ? 'stat wide' : 'stat');
      const n = el('span', 'n', '–');
      box.append(n, el('span', 'u', unit));
      stats.append(box);
      return n;
    };
    this.nums = { fps: stat('fps'), ms: stat('ms', true), draws: stat('draws', true), tris: stat('tris', true) };
    stats.onclick = () => this.show(this.view === 'perf' ? null : 'perf');
    this.errBadge = el('button', 'err');
    this.errBadge.hidden = true;
    this.errBadge.onclick = () => this.show(this.view === 'errors' ? null : 'errors');
    this.pick = el('button', 'pick');
    this.pick.onclick = () => this.togglePick();
    this.hud.append(this.mark, stats, this.errBadge, this.pick);

    // The card.
    this.card = el('div', 'card glass');
    this.card.hidden = true;
    this.tabs = el('div', 'tabs');
    this.body = el('div', 'view');
    this.card.append(this.tabs, this.body);

    wrap.append(this.hud, this.card);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(this.host);

    this.renderPick();
    this.makeDraggable();
    window.addEventListener('keydown', this.onKey, true);
    this.untap = tap((message) => this.onMessage(message));
    this.send('DETECT_ENGINE');
    this.send('GET_SCENE_TREE');
  }

  /** A command, sent the way any host sends one. */
  private send(type: string, extra: Record<string, unknown> = {}): void {
    window.postMessage({ type, ...extra }, window.location.origin === 'null' ? '*' : window.location.origin);
  }

  private togglePick(): void {
    this.send(this.paused ? 'INSPECTOR_RESUME' : 'INSPECTOR_PAUSE');
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.composedPath().some((n) => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || (n instanceof HTMLElement && n.isContentEditable));
    if (this.hotkey && e.key === this.hotkey && !typing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.togglePick();
    } else if (e.key === 'Escape' && this.paused && !this.selected) {
      // Escape drops the selection first (the inspector does that); with none, it leaves.
      e.stopImmediatePropagation();
      this.send('INSPECTOR_RESUME');
    }
  };

  private onMessage(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'INSPECTOR_READY':
        this.send('GET_SCENE_TREE');
        break;
      case 'GAME_PAUSED':
        this.paused = true;
        this.renderPick();
        this.send('GET_SCENE_TREE');
        this.show(this.selected ? 'object' : 'scene');
        break;
      case 'GAME_RESUMED':
        this.paused = false;
        this.selected = null;
        this.renderPick();
        if (this.view === 'object' || this.view === 'scene') this.show(null);
        break;
      case 'OBJECT_SELECTED':
        this.selected = m.metadata as ObjectMetadata;
        this.show('object');
        break;
      case 'OBJECT_DESELECTED':
        this.selected = null;
        if (this.view === 'object') this.show(this.paused ? 'scene' : null);
        break;
      case 'SCENE_TREE':
        this.tree = m.tree as SceneTreeNode;
        if (this.view === 'scene') this.render();
        break;
      case 'PROFILER_SAMPLE':
        this.onSample(m.stats as FrameStats);
        break;
      case 'RUNTIME_ERROR':
        if (this.errors.length < 50) this.errors.push(m.error as RuntimeError);
        this.errBadge.hidden = false;
        this.errBadge.textContent = `${this.errors.length} error${this.errors.length > 1 ? 's' : ''}`;
        if (this.view === 'errors') this.render();
        break;
    }
  }

  private onSample(s: FrameStats): void {
    this.stats = s;
    this.history.push(s.fps.avg);
    if (this.history.length > 40) this.history.shift();
    this.nums.fps.textContent = String(Math.round(s.fps.avg));
    this.nums.ms.textContent = (Math.round(s.frameTime.avg * 10) / 10).toFixed(1);
    this.nums.draws.textContent = short(s.drawCalls);
    this.nums.tris.textContent = short(s.triangles);
    const tone = TONE[s.performanceScore?.grade ?? 'good'] ?? TONE.good;
    this.host.style.setProperty('--tone', tone);
    this.mark.style.setProperty('--tone', tone);
    if (this.view === 'perf') this.render();
  }

  private renderPick(): void {
    this.pick.classList.toggle('on', this.paused);
    this.pick.replaceChildren(this.paused ? 'Resume' : 'Pick');
    if (this.hotkey) this.pick.append(el('kbd', undefined, this.paused ? 'esc' : this.hotkey));
    this.pick.title = this.paused ? 'Let the game run' : 'Pause the game and click anything in it';
  }

  private show(view: View | null): void {
    this.view = view;
    this.card.hidden = view === null;
    if (view !== null) this.render();
  }

  private render(): void {
    const tab = (view: View, label: string): HTMLButtonElement => {
      const b = el('button', 'tab', label);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.view === view));
      b.onclick = () => this.show(view);
      return b;
    };
    const close = el('button', 'x', '×');
    close.title = 'Close';
    close.onclick = () => this.show(null);
    const tabs: Node[] = [];
    if (this.selected) tabs.push(tab('object', 'Object'));
    tabs.push(tab('scene', 'Scene'), tab('perf', 'Perf'));
    if (this.errors.length) tabs.push(tab('errors', 'Errors'));
    this.tabs.replaceChildren(...tabs, close);

    const keep = this.view === 'scene' ? this.body.scrollTop : 0;
    if (this.view === 'object') this.body.replaceChildren(...this.objectView());
    else if (this.view === 'scene') this.body.replaceChildren(...this.sceneView());
    else if (this.view === 'perf') this.body.replaceChildren(...this.perfView());
    else this.body.replaceChildren(...this.errorsView());
    this.body.scrollTop = keep;
  }

  // -- Object ---------------------------------------------------------------

  private objectView(): Node[] {
    const m = this.selected;
    if (!m) return [el('div', 'hint', 'Nothing selected.')];
    const out: Node[] = [];
    const head = el('div', 'head');
    head.append(el('span', 'title', m.type), el('span', 'chip', m.isDomComponent ? 'HUD' : m.typeName));
    out.push(head);

    const file = m.originalSource ?? m.sourceFile;
    const line = m.originalLine ?? m.sourceLine;
    if (file) {
      const where = `${file}${line ? `:${line}` : ''}`;
      const src = el('button', 'src');
      src.title = 'Copy the place';
      src.append(where, el('i', undefined, 'copy'));
      src.onclick = () => this.copy(where, src.lastElementChild as HTMLElement, 'copy');
      out.push(src);
    }
    if (m.originalSourceLine) out.push(el('pre', undefined, m.originalSourceLine.trim()));

    const rows = el('div', 'rows');
    const row = (k: string, v: Node | string): void => {
      const cell = el('div', 'v');
      cell.append(v);
      rows.append(el('div', 'k', k), cell);
    };
    const xyz = (v: object): HTMLDivElement => {
      const box = el('div', 'xyz');
      for (const [axis, n] of Object.entries(v)) {
        const span = el('span', undefined, fmt(n as number));
        span.dataset.a = axis === 'rotation' ? 'r' : axis;
        box.append(span);
      }
      return box;
    };
    row('pos', xyz(m.position));
    if (m.rotation) row('rot', xyz(m.rotation));
    row('scale', xyz(m.scale));
    for (const mat of m.material ? [m.material] : m.materials ?? []) row('mat', this.material(mat));
    if (m.texture) row('tex', m.texture);
    if (m.tint && m.tint !== '#ffffff') row('tint', m.tint);
    if (m.components?.length) row('parts', m.components.map((c) => (c.enabled === false ? `${c.name} (off)` : c.name)).join(' · '));
    if (m.cssClass) row('class', m.cssClass);
    if (m.parentLabel) row('in', m.parentLabel);
    if (m.childCount) row('holds', `${m.childCount} ${m.childCount === 1 ? 'child' : 'children'}`);
    if (!m.visible || m.active === false) {
      const off = el('span', 'off', m.visible ? 'hidden by a parent' : 'hidden');
      row('state', off);
    }
    for (const [k, v] of Object.entries(m.userData ?? m.componentProps ?? {})) {
      row(k, el('span', 'mono', typeof v === 'string' ? v : JSON.stringify(v)));
    }
    out.push(rows);

    const actions = el('div', 'actions');
    const copy = el('button', 'btn main', 'Copy for agent');
    copy.title = 'What it is and the line that made it, as text';
    copy.onclick = () => this.copy(describeSelection(m), copy, 'Copy for agent');
    actions.append(copy);
    if (!m.isDomComponent) {
      const frame = el('button', 'btn', 'Frame');
      frame.title = 'Move the camera to it';
      frame.onclick = () => this.send('FOCUS_OBJECT', { target: m.type });
      actions.append(frame);
    }
    out.push(actions);
    return out;
  }

  private material(mat: MaterialInfo): Node {
    const frag = document.createDocumentFragment();
    if (mat.color) {
      const sw = el('span', 'sw');
      sw.style.background = mat.color;
      frag.append(sw);
    }
    frag.append([mat.name, mat.type?.replace(/^Mesh|Material$/g, ''), mat.color, mat.map && `map ${mat.map}`].filter(Boolean).join(' · '));
    return frag;
  }

  private copy(text: string, label: HTMLElement, back: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      label.textContent = 'Copied';
      setTimeout(() => { label.textContent = back; }, 1100);
    });
  }

  // -- Scene ----------------------------------------------------------------

  private sceneView(): Node[] {
    if (!this.tree) return [el('div', 'hint', 'Waiting for the scene…')];
    const find = el('input', 'find');
    find.placeholder = 'Find an object';
    find.value = this.filter;
    find.spellcheck = false;
    const list = el('ul', 'tree');
    const fill = (): void => { list.replaceChildren(...this.treeRows()); };
    find.oninput = () => { this.filter = find.value.trim().toLowerCase(); fill(); };
    fill();
    const out: Node[] = [find, list];
    if (!this.paused) {
      const hint = el('div', 'hint');
      hint.append('Choose one here, or ', el('b', undefined, 'Pick'), ' and click it in the game.');
      out.push(hint);
    }
    return out;
  }

  private treeRows(): HTMLLIElement[] {
    let budget = 500;
    const want = this.filter;
    const matches = (n: SceneTreeNode): boolean =>
      !want || n.name.toLowerCase().includes(want) || n.type.toLowerCase().includes(want) || n.children.some(matches);

    const build = (node: SceneTreeNode, path: number[] | null, key: string): HTMLLIElement | null => {
      if (budget-- <= 0 || !matches(node)) return null;
      const li = el('li');
      const row = el('div', 'row');
      const open = !!want || !this.closed.has(key);
      const tw = el('button', `tw ${node.children.length ? (open ? 'open' : '') : 'none'}`, '▶');
      tw.onclick = (e) => {
        e.stopPropagation();
        if (this.closed.has(key)) this.closed.delete(key); else this.closed.add(key);
        this.render();
      };
      row.append(tw, el('span', 'nm', node.name));
      if (node.type && node.type !== node.name) row.append(el('span', 'ty', node.type));
      if (this.selected && node.name === this.selected.type) row.classList.add('sel');
      row.onclick = () => {
        if (!this.paused) this.send('INSPECTOR_PAUSE');
        this.send('SELECT_OBJECT', path?.length ? { target: node.name, path } : { target: node.name });
      };
      li.append(row);
      if (open && node.children.length) {
        const ul = el('ul');
        // A place only inside the engine's scene: the HUD is found by name.
        node.children.forEach((child, i) => {
          const built = build(child, path ? [...path, i] : null, `${key}/${i}`);
          if (built) ul.append(built);
        });
        li.append(ul);
      }
      return li;
    };

    // The root is a wrapper: show the scene and the HUD as the top rows.
    return this.tree!.children
      .map((child, i) => build(child, child.layer === 'canvas' ? [] : null, String(i)))
      .filter((li): li is HTMLLIElement => li !== null);
  }

  // -- Perf -----------------------------------------------------------------

  private perfView(): Node[] {
    const s = this.stats;
    if (!s) return [el('div', 'hint', 'Measuring…')];
    const out: Node[] = [];

    const big = el('div', 'big');
    big.append(el('span', 'fps', String(Math.round(s.fps.avg))), el('span', 'lab', `fps · ${fmt(s.frameTime.avg)} ms`));
    big.append(this.sparkline());
    out.push(big);

    const score = s.performanceScore;
    if (score) {
      const line = el('div', 'score');
      const pill = el('i', undefined, `${Math.round(score.score)} · ${score.gradeLabel}`);
      pill.style.background = TONE[score.grade] ?? TONE.good;
      line.append(pill, el('span', undefined, s.bottleneck?.type ? String(s.bottleneck.type).replace(/-/g, ' ') : ''));
      out.push(line);
    }

    const grid = el('div', 'grid');
    const cell = (value: string, label: string): void => {
      const c = el('div', 'cell');
      c.append(el('b', undefined, value), el('span', undefined, label));
      grid.append(c);
    };
    cell(short(s.drawCalls), 'draw calls');
    cell(short(s.triangles), 'triangles');
    cell(String(s.programCount), 'shaders');
    cell(`${fmt(s.cpuTime.avg)} ms`, 'cpu');
    cell(s.gpuTime === null ? '–' : `${fmt(s.gpuTime)} ms`, 'gpu');
    cell(`${fmt(s.frameTime.max)} ms`, 'worst frame');
    cell(`${fmt(s.textureMemoryMB)} MB`, `${s.textureCount} textures`);
    cell(`${fmt(s.geometryMemoryMB)} MB`, `${s.geometryCount} geometries`);
    cell(s.jsHeapUsedMB === null ? '–' : `${Math.round(s.jsHeapUsedMB)} MB`, 'js heap');
    out.push(grid);

    for (const issue of score?.issues.slice(0, 3) ?? []) {
      const box = el('div', 'issue');
      box.append(el('b', undefined, issue.title), el('span', undefined, issue.description));
      out.push(box);
    }

    const actions = el('div', 'actions');
    const copy = el('button', 'btn main', 'Copy report');
    copy.title = 'The full profile as Markdown, for an agent or an issue';
    copy.onclick = () => {
      const api = globalSlot().profiler as { getReport?: () => string } | undefined;
      this.copy(api?.getReport?.() ?? '', copy, 'Copy report');
    };
    actions.append(copy);
    out.push(actions);
    return out;
  }

  private sparkline(): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 34');
    const h = this.history;
    if (h.length < 2) return svg;
    // The band the last samples moved in, never tighter than 10 fps: a steady game draws a calm line.
    const hi = Math.max(...h), lo = Math.min(...h);
    const pad = Math.max(0, 10 - (hi - lo)) / 2;
    const top = hi + pad + 1, bottom = Math.max(0, lo - pad - 1);
    const pts = h.map((v, i) => `${((i / (h.length - 1)) * 120).toFixed(1)},${(33 - ((v - bottom) / (top - bottom)) * 30).toFixed(1)}`);
    const tone = TONE[this.stats?.performanceScore?.grade ?? 'good'] ?? TONE.good;
    const area = document.createElementNS(NS, 'polygon');
    area.setAttribute('points', `0,34 ${pts.join(' ')} 120,34`);
    area.setAttribute('fill', tone);
    area.setAttribute('opacity', '0.14');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', tone);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linejoin', 'round');
    svg.append(area, line);
    return svg;
  }

  // -- Errors ---------------------------------------------------------------

  private errorsView(): Node[] {
    return this.errors.slice(-20).reverse().map((e) => {
      const box = el('div', 'bad');
      const where = e.originalSource ? `${e.originalSource}:${e.originalLine ?? ''}` : e.filename ? `${e.filename}:${e.line ?? ''}` : '';
      box.append(el('b', undefined, e.message));
      if (where) box.append(el('span', 'mono', where));
      return box;
    });
  }

  // -- The bar moves where you put it ---------------------------------------

  private makeDraggable(): void {
    const key = `${id('panel')}:at`;
    const place = (right: number, top: number): void => {
      this.host.style.right = `${Math.max(4, Math.min(window.innerWidth - 60, right))}px`;
      this.host.style.top = `${Math.max(4, Math.min(window.innerHeight - 44, top))}px`;
    };
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as [number, number] | null;
      if (saved) place(saved[0], saved[1]);
    } catch { /* no storage: it stays where it starts */ }

    this.hud.addEventListener('pointerdown', (down) => {
      if ((down.target as Element).closest('button')) return;
      const box = this.host.getBoundingClientRect();
      const from = { x: down.clientX, y: down.clientY, right: window.innerWidth - box.right, top: box.top };
      this.hud.setPointerCapture(down.pointerId);
      const move = (e: PointerEvent): void => place(from.right - (e.clientX - from.x), from.top + (e.clientY - from.y));
      const up = (): void => {
        this.hud.removeEventListener('pointermove', move);
        try {
          const at = this.host.getBoundingClientRect();
          localStorage.setItem(key, JSON.stringify([Math.round(window.innerWidth - at.right), Math.round(at.top)]));
        } catch { /* no storage */ }
      };
      this.hud.addEventListener('pointermove', move);
      this.hud.addEventListener('pointerup', up, { once: true });
      this.hud.addEventListener('pointercancel', up, { once: true });
    });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.untap();
    this.host.remove();
  }
}
