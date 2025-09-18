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
