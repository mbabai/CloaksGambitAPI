function getAssetVersion() {
  if (typeof window === 'undefined') return '';
  const version = typeof window.__CG_ASSET_VERSION__ === 'string'
    ? window.__CG_ASSET_VERSION__.trim()
    : '';
  return version;
}

// Temporary modular wrapper that preserves existing behavior by importing the legacy script
// and exposing an init function. We can progressively migrate functions into modules.
export function initApp() {
  const assetVersion = getAssetVersion();
  const suffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
  // Dynamically import the legacy script to avoid execution before DOM ready
  import(`../../index.js${suffix}`);
}
