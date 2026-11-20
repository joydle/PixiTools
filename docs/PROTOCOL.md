# The host protocol

The tools talk to a host over `window.postMessage`. In an iframe the host is
the page around the game; in a page of its own the host is the page itself
(which is how the built-in panel works: `src/panel/Panel.ts` is a complete
host in one file).

Every message is a plain object with a `type`.

- Messages **from** the tools carry `source: "pixitools"`, the `engine`
  (`"pixi"`), and from the inspector the `engineVersion` (`"8.23.0"`).
- Commands **to** the tools carry no `source`.

```js
// to the tools
frame.contentWindow.postMessage({ type: 'INSPECTOR_PAUSE' }, gameOrigin);

// from the tools
addEventListener('message', (e) => {
  if (e.data?.source !== 'pixitools') return;
  // e.data.type, ...
});
```

## Trust

Unset, messages are posted to any parent (`'*'`) and commands are taken from
any window. That is right for a local dev page and wrong for a page other
sites can frame: a screenshot is a picture of the game. Name the host:

```js
attach({ host: { origin: 'https://editor.example' } });
```

Then messages go to that origin only, and commands are accepted from it and
from the page's own window only. With the script tag, `data-origin` does the
same.

## Inspector

### Commands

| type | fields | |
|---|---|---|
| `INSPECTOR_PAUSE` | | Pause the game and start picking. Also `PAUSE_GAME`, `ENABLE_INSPECTOR`. Asked before the scene exists, it pauses as soon as there is one. |
| `INSPECTOR_RESUME` | | Stop picking and let the game run. Also `RESUME_GAME`. |
| `CLEAR_SELECTION` | | Drop the selection, stay paused. |
| `GET_SCENE_TREE` | | Answered with `SCENE_TREE`. |
| `SELECT_OBJECT` | `target`, `path?` | Select as a click would. `path` is the place on the stage as child indexes from it (`[2, 0]`: the third child's first child); names repeat, places do not. Without a `path`, by name: a HUD element first, then a scene object. |
| `FOCUS_OBJECT` | `target` | Pan and zoom the stage so the named object is in the middle of the view. It moves the stage's own position and scale: a game that sets them each frame takes them back on resume. |
| `REQUEST_SCREENSHOT` | `requestId?` | Answered with `SCREENSHOT_RESULT`. |
| `REQUEST_AREA_SCREENSHOT` | `requestId?` | The person drags a rectangle (Escape cancels); answered with `SCREENSHOT_RESULT`. |
| `DETECT_ENGINE` | | Answered with `ENGINE_DETECTED`. |

### Messages

| type | fields | |
|---|---|---|
| `INSPECTOR_READY` | | The scene has been found. |
| `ENGINE_DETECTED` | `engine` | |
| `GAME_PAUSED` / `GAME_RESUMED` | | |
| `OBJECT_SELECTED` | `metadata`, `clickX?`, `clickY?`, `screenshot?` | `metadata` is an `ObjectMetadata` (below). `screenshot` is a PNG data URL of the object's bounds, for scene objects picked by click. |
| `OBJECT_DESELECTED` | | |
| `SCENE_TREE` | `tree` | A root named `Game` with up to two children: the stage (`layer: "canvas"`) and `UI Layer` (`layer: "hud"`). Nodes are `{ name, type, children, layer? }`. |
| `SCREENSHOT_RESULT` | `dataUrl?`, `error?`, `hud?`, `requestId?` | JPEG at most 1280 px wide (PNG when the canvas has transparency). `hud` is `"included"` when the HUD was composited over the canvas, `"missing"` when only the canvas could be captured. |
| `RUNTIME_ERROR` | `error` | `{ type: "error" \| "unhandledrejection" \| "console_error", message, filename?, line?, column?, stack?, timestamp, originalSource?, originalLine?, originalColumn?, originalSourceLine? }` |
| `CONSOLE_LOG` | `entry` | `{ level, message, timestamp }`. Only with `inspector: { captureConsole: true }`. |

### ObjectMetadata

| field | |
|---|---|
| `type` | Its name: the object's `label`, else the one the hook gave it (the texture's name, `text:"Score 0"`, `Sprite_14`). |
| `typeName` | The constructor: `Sprite`, `Graphics`, `Container`, `Text`. |
| `position`, `rotation`, `scale` | `position` and `scale` are `{x, y}`; `rotation` is `{ rotation }` in radians. |
| `visible`, `alpha`, `childCount`, `parentLabel`, `layer`, `bounds` | `bounds` is the object's box on the canvas, in canvas pixels. |
| `sourceFile`, `sourceLine`, `sourceColumn` | Where it was made, as the browser ran it. |
| `originalSource`, `originalLine`, `originalSourceLine` | The same place in the code as written, through source maps, with the text of the line. |
| `active` | Drawn: `visible` and `renderable` here and in every parent, and not destroyed. |
| `texture` | The texture it draws, by file name or label (`"embedded"` for a data: or blob: picture). |
| `tint` | `#rrggbb`; `#ffffff` is no tint. |
| `components` | What is attached: its filters by class name (`{ name, enabled }`) and `{ name: "Mask" }` when it has a mask. |
| `isDomComponent`, `cssClass`, `componentProps` | For a HUD element. |

A field the engine has no concept of is absent, never `null`, `0`, `false` or `[]`.

## Profiler

The profiler starts by itself when it finds the renderer and posts one
`PROFILER_SAMPLE` a second.

### Commands

| type | fields | |
|---|---|---|
| `PROFILER_START` | `config?` | Also `START_PROFILER`. |
| `PROFILER_STOP` | | Also `STOP_PROFILER`. |
| `PROFILER_REQUEST_SNAPSHOT` | | Answered with `PROFILER_SNAPSHOT`. |
| `PROFILER_SET_CONFIG` | `config` | `{ sampleInterval?, bufferSize?, thresholds?, debug? }` |

### Messages

| type | fields | |
|---|---|---|
| `PROFILER_READY` | | |
| `PROFILER_ENGINE_DETECTED` | `engine` | |
| `PROFILER_SAMPLE` | `stats`, `warnings` | `stats` is a `FrameStats`: `fps`, `frameTime` and `cpuTime` as `{ current, min, max, avg }`; `drawCalls`, `triangles`, `points`, `lines` (counted at the WebGL calls); `textureCount` and an estimated `textureMemoryMB`; object counts; `gpuTime`; `jsHeapUsedMB`; program, texture and framebuffer switches; `framePacing`; `bottleneck`; `performanceScore` (`score` 0–100, `grade`, per-category scores, `issues`). Pixi has no geometry pool and does not expose its shader count: `geometryCount`, `geometryMemoryMB` and `programCount` are 0. |
| `PROFILER_WARNING` | `warning` | `{ id, severity, category, message, value, threshold, timestamp, suggestion }`, once per warning. |
| `PROFILER_SNAPSHOT` | `snapshot` | Stats, recent frames, warnings, engine info (version, renderer, canvas size, resolution) and the containers with the most children. |

The TypeScript types for all of these are exported from the package
(`ObjectMetadata`, `SceneTreeNode`, `RuntimeError`, and `profiling.FrameStats`,
`profiling.ProfilerSnapshot`, ...).

## A host with other names

A host that already speaks another vocabulary maps it, with no fork:

```js
attach({
  host: {
    aliases: {
      in: { EDITOR_PAUSE: 'INSPECTOR_PAUSE' },      // what it sends -> ours
      out: { INSPECTOR_READY: 'EDITOR_READY' },     // ours -> what it listens for
    },
  },
});
```

## The page contract

| global | |
|---|---|
| `window.__pixitools` | `{ inspector, profiler }`, each present while it runs. |
| `window.__PIXI_APP__`, `window.PIXI` | Where the tools look for the app. `attach({ PIXI, app })` sets them; the hooked `pixi.js` build sets them as the game constructs its `Application`. Without either, an `Application` on `window.app`, `window.game` or `window.pixiApp` is found too. |
| `window.__PIXITOOLS_TRACK__(object, name)` | Called by the hooked build for each object it makes. |
| `window.__PIXITOOLS_TRACK_BUFFER__` | Objects the hooked build made before the inspector started (at most 5,000); the inspector drains it. |
| `window.__GAME_STATE__.isPaused` | Set while paused, if the game defines `__GAME_STATE__`: a game with its own clock can read it. |

DOM the tools add has an id starting `pixitools-` or the attribute
`data-pixitools-chrome`; neither is ever picked or screenshotted.
