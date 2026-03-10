function getAssetVersion() {
  if (typeof window === 'undefined') return '';
  const version = typeof window.__CG_ASSET_VERSION__ === 'string'
    ? window.__CG_ASSET_VERSION__.trim()
    : '';
  return version;
}

async function bootstrap() {
  const assetVersion = getAssetVersion();
  const suffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
  const { initApp } = await import(`./modules/app.js${suffix}`);
  initApp();
}

bootstrap();
