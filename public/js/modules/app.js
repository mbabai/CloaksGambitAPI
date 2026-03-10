function getAssetVersion() {
  try {
    const url = new URL(import.meta.url);
    const version = url.searchParams.get('v');
    return typeof version === 'string' ? version.trim() : '';
  } catch (_) {
    return '';
  }
}

// Temporary modular wrapper that preserves existing behavior by importing the legacy script
// and exposing an init function. We can progressively migrate functions into modules.
export function initApp() {
  const assetVersion = getAssetVersion();
  const suffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
  // Dynamically import the legacy script to avoid execution before DOM ready
  import(`../../index.js${suffix}`);
}
