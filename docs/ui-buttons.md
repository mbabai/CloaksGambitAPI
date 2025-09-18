# UI Button Helpers

The shared button helpers exported from [`public/js/modules/ui/buttons.js`](../public/js/modules/ui/buttons.js) centralize layout math, palette management, and event wiring for overlay buttons.

## API

### `renderButton(options)`

Renders a positioned `<button>` into a container, replacing any existing element with the same `id`.

| Option | Type | Description |
| --- | --- | --- |
| `id` | `string` | Required DOM id for the button element. |
| `root` | `HTMLElement` | Parent element that receives the button. |
| `label` | `string` | Text label shown inside the button. |
| `variant` | `'primary' \| 'danger' \| 'neutral' \| 'dark'` | Named palette to apply. Custom colors can be supplied via `background`. |
| `background` | `string` | Optional CSS color to override the palette. |
| `visible` | `boolean` | When `false`, removes any existing button and stops rendering. |
| `boardLeft`, `boardTop`, `boardWidth`, `boardHeight` | `number` | Define a rectangular anchor region; the helper centers the button within this area. |
| `size` | `'auto' \| 'action' \| 'secondary' \| 'large'` | Size preset determining width/height/font ratios. |
| `sizeBasis` | `number` | Optional dimension used when computing preset sizes (e.g., stash width). |
| `width`, `height`, `fontSize` | `number` | Explicit overrides for computed measurements. |
| `zIndex` | `number` | Stack order; defaults to `5`. |
| `onClick` | `Function` | Click handler attached to the rendered button. |

### `createButton(options)`

Returns an unmounted `<button>` element with consistent styling. It is primarily used internally by `renderButton`, but can be composed in custom flows when direct control is needed.

## Presets & Variants

The helper exposes the registered presets and palette variants for QA snapshots via the named exports `BUTTON_PRESETS` and `BUTTON_VARIANTS`.

| Preset | Description |
| --- | --- |
| `auto` | General-purpose sizing driven by the anchor rectangle or parent bounds. |
| `action` | Slightly larger action buttons sized relative to stash width. |
| `secondary` | Compact buttons useful for follow-up actions (e.g., Resign/Draw). |
| `large` | Fixed 160×96 buttons for setup confirmation (Ready). |

| Variant | Background |
| --- | --- |
| `primary` | `var(--CG-purple-pressed)` |
| `danger` | `var(--CG-dark-red)` |
| `neutral` | `var(--CG-gray)` |
| `dark` | `var(--CG-black)` |

## Example Gallery (Task 8 Reference)

The snippet below mirrors our lightweight Storybook approach. Paste it into the browser console on `/public/index.html` (after loading the client bundle) to preview each variant without joining a game:

```js
import { renderButton } from '/js/modules/ui/buttons.js';

const container = document.getElementById('playArea') || document.body;
const previewRoot = document.createElement('div');
previewRoot.style.position = 'relative';
previewRoot.style.width = '400px';
previewRoot.style.height = '240px';
previewRoot.style.margin = '24px auto';
previewRoot.style.background = 'rgba(0,0,0,0.35)';
previewRoot.style.border = '1px dashed var(--CG-gold)';
container.appendChild(previewRoot);

const variants = ['primary', 'danger', 'neutral', 'dark'];
variants.forEach((variant, index) => {
  renderButton({
    id: `preview-${variant}`,
    root: previewRoot,
    boardLeft: 16 + (index % 2) * 180,
    boardTop: 24 + Math.floor(index / 2) * 120,
    boardWidth: 160,
    boardHeight: 96,
    label: `${variant} button`,
    variant,
    size: index % 2 ? 'secondary' : 'action',
    onClick: () => console.log(`${variant} clicked`)
  });
});
```

Remove the preview nodes when finished:

```js
document.querySelectorAll('[id^="preview-"]').forEach(node => node.remove());
previewRoot.remove();
```

## Banner Primitives

Player banners and score summaries share a consistent visual language (name row, dagger counters, challenge bubbles, and monospaced clocks). The helper module [`public/js/modules/ui/banners.js`](../public/js/modules/ui/banners.js) exports pure DOM factories so renderers can compose these pieces without duplicating markup.

### `createNameRow(options)`

Builds a flex row containing the player name, optional Elo badge, reconnect spinner, and victory thrones. Key options:

| Option | Type | Description |
| --- | --- | --- |
| `name` | `string` | Player label rendered in bold white text. |
| `orientation` | `'top' \| 'bottom'` | Positions victory tokens before or after the name. |
| `height` / `fontSize` | `number` | Explicit measurements in pixels. |
| `isRankedMatch` | `boolean` | When `true`, injects an Elo badge using the supplied `elo` rating. |
| `wins` | `object` | `{ count, size, gap, margin }` configure the throne icons. |
| `connection` | `object` | `{ displaySeconds, size, fontSize, color }` draws a reconnect spinner + countdown when present. |
| `assets` | `object` | Override icon factories (see below). |

### `createClockPanel(options)`

Returns a monospaced block representing the clock. Provide `text`, `height`, `fontSize`, and `isLight` to control output. Use the optional `label` for a tooltip.

### `createDaggerCounter(options)`

Creates a flex wrapper filled with dagger tokens. Pass `{ count, size, gap, alt }` to control the number of tokens, dimensions, and accessibility copy. A count of `0` returns an empty wrapper to preserve spacing.

### `createChallengeBubbleElement(options)`

Produces a positioned challenge bubble image ready to overlay on top of a name row. Useful options include `{ position, size, offsetY, zIndex }`.

### `createBannerAssets(overrides)`

Clones the default asset factories (which already read from `ASSET_MANIFEST`) and lets you override any of them. Pass the resulting object to the helpers via the `assets` option when you need to swap icon sets:

```js
import { createNameRow, createDaggerCounter, createBannerAssets } from '/js/modules/ui/banners.js';

const assets = createBannerAssets();

const nameRow = createNameRow({
  name: 'Player One',
  orientation: 'top',
  height: 28,
  fontSize: 16,
  isRankedMatch: true,
  elo: 1488,
  wins: { count: 2, size: 24, margin: 6 },
  assets
});

const daggers = createDaggerCounter({ count: 3, size: 20, gap: 4, assets });

bannerContainer.append(nameRow, daggers);
```

Because every helper is pure, the nodes can be reused in tests or composed inside higher-level renderers (`render/bars`, scoreboard summaries, admin dashboards) without implicit DOM side effects.
