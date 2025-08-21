// Temporary modular wrapper that preserves existing behavior by importing the legacy script
// and exposing an init function. We can progressively migrate functions into modules.

export function initApp() {
  // Dynamically import the legacy script to avoid execution before DOM ready
  import('../../index.js');
}
