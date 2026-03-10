function getAssetVersion() {
  try {
    const url = new URL(import.meta.url);
    const version = url.searchParams.get('v');
    return typeof version === 'string' ? version.trim() : '';
  } catch (_) {
    return '';
  }
}

async function bootstrap() {
  const assetVersion = getAssetVersion();
  const suffix = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
  const { initApp } = await import(`./modules/app.js${suffix}`);
  initApp();
}

bootstrap();
