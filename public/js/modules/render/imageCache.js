function createImageRecord(src, onChange) {
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  const record = {
    image,
    src,
    status: 'loading',
  };
  image.addEventListener('load', () => {
    record.status = 'loaded';
    if (typeof onChange === 'function') {
      onChange(src, record);
    }
  }, { once: true });
  image.addEventListener('error', () => {
    record.status = 'error';
    if (typeof onChange === 'function') {
      onChange(src, record);
    }
  }, { once: true });
  image.src = src;
  return record;
}

export function createImageCache({ onChange } = {}) {
  const records = new Map();

  function ensure(src) {
    if (!src) return null;
    if (!records.has(src)) {
      records.set(src, createImageRecord(src, onChange));
    }
    return records.get(src);
  }

  function get(src) {
    return ensure(src);
  }

  function getLoadedImage(src) {
    const record = ensure(src);
    if (!record || record.status !== 'loaded') {
      return null;
    }
    return record.image;
  }

  return {
    get,
    getLoadedImage,
  };
}
