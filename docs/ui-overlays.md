# UI Overlay Shell

This release introduces a shared overlay shell that handles accessible modal
behavior for the front-end. All blocking pop-ups now mount through
`public/js/modules/ui/overlays.js`, which provides:

* ARIA-compliant dialog structure (`role="dialog"`, `aria-modal="true"`).
* An automatic focus trap and focus restoration when the modal closes.
* Configurable close controls (including ESC/backdrop support).
* A reusable content slot that each flow can populate with its own markup.

## Consumers

* **Player history / stats overlay** – opened from the account panel. The close
  button, backdrop, and Escape key all dismiss the dialog, and tab/shift+tab
  cycle through the summary/filter controls without leaving the overlay.
* **Game flow banners** – resign confirmation, draw confirmation, match-found
  countdown, game-finished summary, and match-complete summary all reuse the
  shared banner overlay. Each banner now has a consistent close affordance and
  keeps keyboard focus within the modal content.

## Manual verification checklist

1. Open the account menu → Stats. Confirm focus lands on the overlay close
   button, Tab stays within the overlay, Escape closes it, and focus returns to
   the triggering button.
2. Trigger resign and draw confirmations (from an active game) and verify the
   modal close button and keyboard focus behave consistently with the stats
   overlay.
3. Confirm match-found and post-game banners trap focus, can be dismissed via
   the shared close control, and do not allow background scrolling while open.
4. Verify that `returnToLobby()` and other queue-state transitions hide any
   active overlays and clear countdown timers.

These checks should be performed with only keyboard input to ensure the focus
trap is effective.
