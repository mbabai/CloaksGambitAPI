export const DEFAULT_AUDIO_VOLUME = 0.5;

export function normalizeAudioVolume(value, fallback = DEFAULT_AUDIO_VOLUME) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, normalized));
}

function isPromiseLike(value) {
  return value && typeof value.then === 'function';
}

function safeCall(fn) {
  try {
    return { value: fn(), error: null };
  } catch (err) {
    return { value: undefined, error: err };
  }
}

export function createAudioManager({
  AudioCtor = typeof Audio !== 'undefined' ? Audio : null,
  documentRef = typeof document !== 'undefined' ? document : null,
  logger = typeof console !== 'undefined' ? console : null,
  defaultVolume = DEFAULT_AUDIO_VOLUME,
  unlockEvents = ['pointerdown', 'keydown', 'touchstart', 'mousedown'],
} = {}) {
  const sounds = new Map();
  const loops = new Map();
  const oneShots = new Set();
  let masterVolume = normalizeAudioVolume(defaultVolume, DEFAULT_AUDIO_VOLUME);
  let unlockListenersBound = false;
  let disposed = false;

  function applyVolume(audio, soundVolume = 1) {
    if (!audio) return;
    audio.volume = normalizeAudioVolume(masterVolume, DEFAULT_AUDIO_VOLUME)
      * normalizeAudioVolume(soundVolume, 1);
  }

  function getBlockedLoopCount() {
    let count = 0;
    loops.forEach((entry) => {
      if (entry.blocked) count += 1;
    });
    return count;
  }

  function removeUnlockListeners() {
    if (!unlockListenersBound || !documentRef?.removeEventListener) return;
    unlockEvents.forEach((eventName) => {
      documentRef.removeEventListener(eventName, handleUnlockGesture, true);
    });
    unlockListenersBound = false;
  }

  function ensureUnlockListeners() {
    if (unlockListenersBound || !documentRef?.addEventListener) return;
    unlockEvents.forEach((eventName) => {
      documentRef.addEventListener(eventName, handleUnlockGesture, true);
    });
    unlockListenersBound = true;
  }

  function handlePlayBlocked(entry, err) {
    if (!entry || entry.stopped || loops.get(entry.key) !== entry) return;
    entry.blocked = true;
    entry.lastError = err || null;
    ensureUnlockListeners();
    if (logger && typeof logger.debug === 'function') {
      logger.debug('[audio] playback blocked; waiting for user gesture', {
        soundId: entry.soundId,
        key: entry.key,
        error: err?.message || err?.name || String(err || ''),
      });
    }
  }

  function tryPlay(entry) {
    if (disposed || !entry || entry.stopped || !entry.audio) return;
    entry.blocked = false;
    entry.lastError = null;
    applyVolume(entry.audio, entry.sound?.volume);
    const result = safeCall(() => entry.audio.play());
    if (result.error) {
      handlePlayBlocked(entry, result.error);
      return;
    }
    if (isPromiseLike(result.value)) {
      result.value.catch((err) => handlePlayBlocked(entry, err));
    }
  }

  function retryBlockedLoops() {
    if (disposed) return;
    loops.forEach((entry) => {
      if (entry.blocked) {
        tryPlay(entry);
      }
    });
    if (getBlockedLoopCount() === 0) {
      removeUnlockListeners();
    }
  }

  function handleUnlockGesture() {
    retryBlockedLoops();
  }

  function registerSound(id, options = {}) {
    const soundId = id ? String(id) : '';
    const src = typeof options.src === 'string' ? options.src.trim() : '';
    if (!soundId) {
      throw new Error('Sound id is required');
    }
    if (!src) {
      throw new Error(`Sound source is required for ${soundId}`);
    }
    sounds.set(soundId, {
      src,
      loop: Boolean(options.loop),
      preload: options.preload || 'auto',
      volume: options.volume === undefined ? 1 : normalizeAudioVolume(options.volume, 1),
    });
    return soundId;
  }

  function createAudio(sound) {
    if (!AudioCtor) return null;
    const audio = new AudioCtor(sound.src);
    audio.preload = sound.preload;
    audio.loop = Boolean(sound.loop);
    applyVolume(audio, sound.volume);
    return audio;
  }

  function stopLoop(key) {
    const loopKey = key ? String(key) : '';
    if (!loopKey) return false;
    const entry = loops.get(loopKey);
    if (!entry) return false;
    loops.delete(loopKey);
    entry.stopped = true;
    if (entry.audio) {
      safeCall(() => entry.audio.pause());
      safeCall(() => {
        entry.audio.currentTime = 0;
      });
    }
    if (getBlockedLoopCount() === 0) {
      removeUnlockListeners();
    }
    return true;
  }

  function startLoop(id, {
    key = id,
    restart = false,
  } = {}) {
    const soundId = id ? String(id) : '';
    const loopKey = key ? String(key) : soundId;
    if (!soundId || !loopKey || disposed) {
      return null;
    }
    if (loops.has(loopKey)) {
      const existing = loops.get(loopKey);
      applyVolume(existing.audio, existing.sound?.volume);
      if (restart && existing.audio) {
        safeCall(() => {
          existing.audio.currentTime = 0;
        });
      }
      tryPlay(existing);
      return {
        key: loopKey,
        stop: () => stopLoop(loopKey),
      };
    }

    const sound = sounds.get(soundId);
    if (!sound) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[audio] sound not registered: ${soundId}`);
      }
      return null;
    }
    const audio = createAudio({ ...sound, loop: true });
    const entry = {
      key: loopKey,
      soundId,
      sound,
      audio,
      blocked: false,
      stopped: false,
      lastError: null,
    };
    loops.set(loopKey, entry);
    tryPlay(entry);
    return {
      key: loopKey,
      stop: () => stopLoop(loopKey),
    };
  }

  function play(id, { restart = true } = {}) {
    const soundId = id ? String(id) : '';
    if (!soundId || disposed) {
      return null;
    }
    const sound = sounds.get(soundId);
    if (!sound) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[audio] sound not registered: ${soundId}`);
      }
      return null;
    }
    const audio = createAudio({ ...sound, loop: false });
    if (!audio) return null;
    const entry = {
      audio,
      sound,
      stopped: false,
    };
    const cleanup = () => {
      oneShots.delete(entry);
      if (audio && typeof audio.removeEventListener === 'function') {
        safeCall(() => audio.removeEventListener('ended', cleanup));
        safeCall(() => audio.removeEventListener('error', cleanup));
      }
    };
    oneShots.add(entry);
    if (typeof audio.addEventListener === 'function') {
      safeCall(() => audio.addEventListener('ended', cleanup, { once: true }));
      safeCall(() => audio.addEventListener('error', cleanup, { once: true }));
    }
    if (restart) {
      safeCall(() => {
        audio.currentTime = 0;
      });
    }
    const result = safeCall(() => audio.play());
    const handlePlayError = (err) => {
      if (logger && typeof logger.debug === 'function') {
        logger.debug('[audio] one-shot playback skipped', {
          soundId,
          error: err?.message || err?.name || String(err || ''),
        });
      }
    };
    if (result.error) {
      handlePlayError(result.error);
    } else if (isPromiseLike(result.value)) {
      result.value.catch(handlePlayError);
    }
    return {
      audio,
      stop: () => {
        if (entry.stopped) return;
        entry.stopped = true;
        cleanup();
        safeCall(() => audio.pause());
        safeCall(() => {
          audio.currentTime = 0;
        });
      },
    };
  }

  function setVolume(value) {
    masterVolume = normalizeAudioVolume(value, masterVolume);
    loops.forEach((entry) => {
      applyVolume(entry.audio, entry.sound?.volume);
    });
    oneShots.forEach((entry) => {
      applyVolume(entry.audio, entry.sound?.volume);
    });
    return masterVolume;
  }

  function getVolume() {
    return masterVolume;
  }

  function stopAll() {
    Array.from(loops.keys()).forEach((key) => stopLoop(key));
    Array.from(oneShots).forEach((entry) => {
      oneShots.delete(entry);
      if (entry.audio) {
        safeCall(() => entry.audio.pause());
        safeCall(() => {
          entry.audio.currentTime = 0;
        });
      }
    });
  }

  function dispose() {
    disposed = true;
    stopAll();
    sounds.clear();
    removeUnlockListeners();
  }

  return {
    dispose,
    getVolume,
    play,
    registerSound,
    retryBlockedLoops,
    setVolume,
    startLoop,
    stopAll,
    stopLoop,
  };
}
