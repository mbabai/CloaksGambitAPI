const path = require('path');
const { pathToFileURL } = require('url');

describe('audio manager', () => {
  let createAudioManager;
  let normalizeAudioVolume;

  beforeAll(async () => {
    ({ createAudioManager, normalizeAudioVolume } = await import(
      pathToFileURL(path.resolve(__dirname, '../public/js/modules/audio/audioManager.js')).href
    ));
  });

  function createDocumentHarness() {
    const listeners = new Map();
    return {
      addEventListener: jest.fn((eventName, handler) => {
        listeners.set(eventName, handler);
      }),
      removeEventListener: jest.fn((eventName, handler) => {
        if (listeners.get(eventName) === handler) {
          listeners.delete(eventName);
        }
      }),
      dispatch(eventName) {
        const handler = listeners.get(eventName);
        if (handler) handler();
      },
      listenerCount() {
        return listeners.size;
      },
    };
  }

  test('normalizes volume values into the master range', () => {
    expect(normalizeAudioVolume(0.4)).toBe(0.4);
    expect(normalizeAudioVolume(2)).toBe(1);
    expect(normalizeAudioVolume(-1)).toBe(0);
    expect(normalizeAudioVolume(null)).toBe(0.5);
    expect(normalizeAudioVolume('')).toBe(0.5);
    expect(normalizeAudioVolume('bad', 0.25)).toBe(0.25);
  });

  test('starts one loop per key and applies master volume to active audio', () => {
    const instances = [];
    class MockAudio {
      constructor(src) {
        this.src = src;
        this.volume = 0;
        this.loop = false;
        this.currentTime = 0;
        this.play = jest.fn(() => Promise.resolve());
        this.pause = jest.fn();
        instances.push(this);
      }
    }

    const manager = createAudioManager({
      AudioCtor: MockAudio,
      documentRef: null,
      logger: null,
      defaultVolume: 0.5,
    });
    manager.registerSound('matchFound', {
      src: '/assets/sounds/MatchFound.mp3',
      volume: 0.8,
    });

    manager.startLoop('matchFound', { key: 'accept:game-1' });
    manager.startLoop('matchFound', { key: 'accept:game-1' });

    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe('/assets/sounds/MatchFound.mp3');
    expect(instances[0].loop).toBe(true);
    expect(instances[0].volume).toBeCloseTo(0.4);
    expect(instances[0].play).toHaveBeenCalledTimes(2);

    manager.setVolume(0.25);
    expect(instances[0].volume).toBeCloseTo(0.2);

    expect(manager.stopLoop('accept:game-1')).toBe(true);
    expect(instances[0].pause).toHaveBeenCalledTimes(1);
    expect(instances[0].currentTime).toBe(0);
  });

  test('plays one-shot sounds with master volume and independent audio instances', () => {
    const instances = [];
    class MockAudio {
      constructor(src) {
        this.src = src;
        this.volume = 0;
        this.loop = false;
        this.currentTime = 12;
        this.play = jest.fn(() => Promise.resolve());
        this.pause = jest.fn();
        this.addEventListener = jest.fn();
        this.removeEventListener = jest.fn();
        instances.push(this);
      }
    }

    const manager = createAudioManager({
      AudioCtor: MockAudio,
      documentRef: null,
      logger: null,
      defaultVolume: 0.5,
    });
    manager.registerSound('move', { src: '/assets/sounds/Move.mp3' });

    const first = manager.play('move');
    manager.setVolume(0.25);
    const second = manager.play('move');

    expect(first).toEqual(expect.objectContaining({ audio: instances[0] }));
    expect(second).toEqual(expect.objectContaining({ audio: instances[1] }));
    expect(instances).toHaveLength(2);
    expect(instances[0].src).toBe('/assets/sounds/Move.mp3');
    expect(instances[0].loop).toBe(false);
    expect(instances[0].volume).toBeCloseTo(0.25);
    expect(instances[0].currentTime).toBe(0);
    expect(instances[0].play).toHaveBeenCalledTimes(1);
    expect(instances[1].volume).toBeCloseTo(0.25);
    expect(instances[1].play).toHaveBeenCalledTimes(1);

    first.stop();
    expect(instances[0].pause).toHaveBeenCalledTimes(1);
  });

  test('retries blocked loop playback on the next user gesture', async () => {
    const documentRef = createDocumentHarness();
    const playResults = [
      Promise.reject(new Error('NotAllowedError')),
      Promise.resolve(),
    ];
    class MockAudio {
      constructor() {
        this.volume = 0;
        this.loop = false;
        this.currentTime = 0;
        this.play = jest.fn(() => playResults.shift() || Promise.resolve());
        this.pause = jest.fn();
      }
    }

    const manager = createAudioManager({
      AudioCtor: MockAudio,
      documentRef,
      logger: null,
    });
    manager.registerSound('matchFound', { src: '/assets/sounds/MatchFound.mp3' });
    const handle = manager.startLoop('matchFound', { key: 'accept:game-2' });

    await Promise.resolve();

    expect(documentRef.listenerCount()).toBeGreaterThan(0);
    documentRef.dispatch('pointerdown');
    await Promise.resolve();

    expect(handle).toEqual(expect.objectContaining({ key: 'accept:game-2' }));
    expect(documentRef.listenerCount()).toBe(0);
  });
});
