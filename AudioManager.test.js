import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ──────────────────────────────────────────────
//  Mock Howler.js
// ──────────────────────────────────────────────

const mockCtx = {
    state: 'running',
    createBuffer: vi.fn(() => ({})),
    createBufferSource: vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
    })),
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
};

const { HowlMock, HowlerMock } = vi.hoisted(() => {
    const HowlerMock = {
        ctx: null, // set per test
        mute: vi.fn(),
    };

    const instances = [];

    const HowlMock = vi.fn(function (opts) {
        this.opts = opts;
        this._playing = new Map();
        this._listeners = new Map();
        this._nextId = 1;

        this.play = vi.fn(() => {
            const id = this._nextId++;
            this._playing.set(id, true);
            return id;
        });
        this.stop = vi.fn((id) => { this._playing.delete(id); });
        this.volume = vi.fn((vol, id) => vol !== undefined ? vol : 1);
        this.rate = vi.fn();
        this.loop = vi.fn();
        this.fade = vi.fn();
        this.playing = vi.fn((id) => this._playing.has(id));
        this.unload = vi.fn();

        this.once = vi.fn((event, cb, id) => {
            this._listeners.set(`${event}:${id}`, cb);
        });

        // Helper to fire a listener from tests
        this._fire = (event, id) => {
            const cb = this._listeners.get(`${event}:${id}`);
            if (cb) cb();
        };

        instances.push(this);
    });

    HowlMock._instances = instances;

    return { HowlMock, HowlerMock };
});

vi.mock('howler', () => ({
    Howl: HowlMock,
    Howler: HowlerMock,
}));

import { AudioManager } from './AudioManager.js';

// ──────────────────────────────────────────────

describe('🔊 AudioManager', () => {
    let manager;

    const testConfig = {
        hit:  { src: ['/hit.wav'], category: 'sfx' },
        coin: { src: ['/coin.wav'], category: 'sfx', pitchVar: 0.15 },
        bgm:  { src: ['/music.mp3'], category: 'music', loop: true, html5: true },
        win:  { src: ['/win.mp3'], category: 'outcome' },
        lose: { src: ['/lose.mp3'], category: 'outcome' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        HowlMock._instances.length = 0;
        HowlerMock.ctx = mockCtx;
        mockCtx.state = 'running';
        mockCtx.resume.mockResolvedValue(undefined);

        manager = new AudioManager();
        manager.init(testConfig);
    });

    afterEach(() => {
        manager?.destroy();
    });

    // ── Constructor ──

    describe('constructor', () => {
        it('starts unmuted by default', () => {
            expect(manager.isMuted).toBe(false);
        });

        it('starts unlocked as false', () => {
            expect(manager.isUnlocked).toBe(false);
        });

        it('extends EventTarget', () => {
            expect(manager).toBeInstanceOf(EventTarget);
        });
    });

    // ── init() ──

    describe('init()', () => {
        it('creates Howl instances for each sound', () => {
            expect(HowlMock).toHaveBeenCalledTimes(Object.keys(testConfig).length);
        });

        it('passes src to Howl', () => {
            const hitCall = HowlMock.mock.calls.find(c => c[0].src[0] === '/hit.wav');
            expect(hitCall).toBeDefined();
        });

        it('strips custom fields (category, pitchVar) from Howl options', () => {
            const hitCall = HowlMock.mock.calls.find(c => c[0].src[0] === '/hit.wav');
            expect(hitCall[0]).not.toHaveProperty('category');
            expect(hitCall[0]).not.toHaveProperty('pitchVar');
        });

        it('applies mute state on init', () => {
            expect(HowlerMock.mute).toHaveBeenCalledWith(false);
        });

        it('does not duplicate sounds on second init call', () => {
            const countBefore = HowlMock.mock.calls.length;
            manager.init(testConfig);
            expect(HowlMock.mock.calls.length).toBe(countBefore);
        });
    });

    // ── play() ──

    describe('play()', () => {
        it('returns a play id', () => {
            const id = manager.play('hit');
            expect(id).toBeTypeOf('number');
        });

        it('sets volume on the play id', () => {
            manager.play('hit', { volume: 0.5 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.volume).toHaveBeenCalledWith(0.5, expect.any(Number));
        });

        it('sets loop on the play id', () => {
            manager.play('bgm', { loop: true });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/music.mp3');
            expect(howl.loop).toHaveBeenCalledWith(true, expect.any(Number));
        });

        it('applies random pitch variation', () => {
            manager.play('hit', { pitchVar: 0.2 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.rate).toHaveBeenCalled();
            const rate = howl.rate.mock.calls[0][0];
            expect(rate).toBeGreaterThanOrEqual(0.8);
            expect(rate).toBeLessThanOrEqual(1.2);
        });

        it('explicit pitch overrides pitchVar', () => {
            manager.play('hit', { pitch: 1.5, pitchVar: 0.2 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.rate).toHaveBeenCalledWith(1.5, expect.any(Number));
        });

        it('returns null for unknown sound', () => {
            const id = manager.play('nonexistent');
            expect(id).toBeNull();
        });

        it('returns null when context is suspended', () => {
            mockCtx.state = 'suspended';
            const id = manager.play('hit');
            expect(id).toBeNull();
        });

        it('returns null after destroy', () => {
            manager.destroy();
            expect(manager.play('hit')).toBeNull();
        });

        it('registers end listener for non-looped sounds', () => {
            manager.play('hit');
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.once).toHaveBeenCalledWith('end', expect.any(Function), expect.any(Number));
        });

        it('does NOT register end listener for looped sounds', () => {
            manager.play('bgm', { loop: true });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/music.mp3');
            expect(howl.once).not.toHaveBeenCalled();
        });
    });

    // ── playExclusive() ──

    describe('playExclusive()', () => {
        it('stops outcome category then plays', () => {
            manager.play('win');
            const stopSpy = vi.spyOn(manager, 'stop');
            manager.playExclusive('lose');
            expect(stopSpy).toHaveBeenCalledWith('win', expect.any(Object));
        });
    });

    // ── playUnique() ──

    describe('playUnique()', () => {
        it('plays on first call', () => {
            const id = manager.playUnique('hit');
            expect(id).toBeTypeOf('number');
        });

        it('returns null on rapid second call', () => {
            manager.playUnique('hit', 200);
            const id2 = manager.playUnique('hit', 200);
            expect(id2).toBeNull();
        });
    });

    // ── stop() ──

    describe('stop()', () => {
        it('stops a playing sound', () => {
            const id = manager.play('hit');
            manager.stop('hit', { fade: 0 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.stop).toHaveBeenCalledWith(id);
        });

        it('fades before stopping when fade > 0', () => {
            const id = manager.play('hit');
            manager.stop('hit', { fade: 200 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.fade).toHaveBeenCalled();
            // Stop is called after fade completes
            expect(howl.once).toHaveBeenCalledWith('fade', expect.any(Function), id);
        });

        it('force-kills queued (non-playing) sounds instantly', () => {
            const id = manager.play('hit');
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            howl._playing.delete(id); // simulate queued but not playing
            howl.playing.mockReturnValue(false);

            manager.stop('hit', { fade: 200 });
            expect(howl.stop).toHaveBeenCalledWith(id);
            expect(howl.fade).not.toHaveBeenCalled();
        });

        it('skips ids that are already mid-fade', () => {
            const id = manager.play('hit');
            manager.stop('hit', { fade: 200 }); // starts fade
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');

            howl.stop.mockClear();
            howl.fade.mockClear();
            manager.stop('hit', { fade: 200 }); // should skip

            expect(howl.fade).not.toHaveBeenCalled();
        });

        it('is no-op for unknown sound', () => {
            expect(() => manager.stop('nope')).not.toThrow();
        });

        it('is no-op after destroy', () => {
            manager.play('hit');
            manager.destroy();
            expect(() => manager.stop('hit')).not.toThrow();
        });
    });

    // ── stopCategory() ──

    describe('stopCategory()', () => {
        it('stops all sounds in a category', () => {
            manager.play('hit');
            manager.play('coin');
            const stopSpy = vi.spyOn(manager, 'stop');

            manager.stopCategory('sfx', { fade: 0 });

            expect(stopSpy).toHaveBeenCalledWith('hit', { fade: 0 });
            expect(stopSpy).toHaveBeenCalledWith('coin', { fade: 0 });
        });

        it('does not stop sounds outside the category', () => {
            manager.play('bgm');
            const stopSpy = vi.spyOn(manager, 'stop');

            manager.stopCategory('sfx', { fade: 0 });

            expect(stopSpy).not.toHaveBeenCalledWith('bgm', expect.anything());
        });
    });

    // ── stopCategories() ──

    describe('stopCategories()', () => {
        it('stops multiple categories', () => {
            const stopCatSpy = vi.spyOn(manager, 'stopCategory');
            manager.stopCategories(['sfx', 'outcome']);
            expect(stopCatSpy).toHaveBeenCalledWith('sfx', expect.any(Object));
            expect(stopCatSpy).toHaveBeenCalledWith('outcome', expect.any(Object));
        });
    });

    // ── setMuted() ──

    describe('setMuted()', () => {
        it('updates isMuted property', () => {
            manager.setMuted(true);
            expect(manager.isMuted).toBe(true);
        });

        it('calls Howler.mute()', () => {
            manager.setMuted(true);
            expect(HowlerMock.mute).toHaveBeenCalledWith(true);
        });

        it('dispatches mutechange event', () => {
            const listener = vi.fn();
            manager.addEventListener('mutechange', listener);

            manager.setMuted(true);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].detail).toEqual({ isMuted: true });
        });

        it('toggles back to unmuted', () => {
            manager.setMuted(true);
            manager.setMuted(false);
            expect(manager.isMuted).toBe(false);
            expect(HowlerMock.mute).toHaveBeenLastCalledWith(false);
        });
    });

    // ── Active ID tracking ──

    describe('active id tracking', () => {
        it('tracks concurrent plays of the same sound', () => {
            const id1 = manager.play('hit');
            const id2 = manager.play('hit');
            expect(id1).not.toBe(id2);

            // Both should be stoppable
            manager.stop('hit', { fade: 0 });
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');
            expect(howl.stop).toHaveBeenCalledWith(id1);
            expect(howl.stop).toHaveBeenCalledWith(id2);
        });

        it('auto-cleans ids when non-looped sound ends', () => {
            const id = manager.play('hit');
            const howl = HowlMock._instances.find(h => h.opts.src[0] === '/hit.wav');

            // Simulate the sound ending
            howl._fire('end', id);

            // Stopping now should be a no-op (id already cleaned)
            howl.stop.mockClear();
            manager.stop('hit', { fade: 0 });
            expect(howl.stop).not.toHaveBeenCalled();
        });
    });

    // ── destroy() ──

    describe('destroy()', () => {
        it('unloads all Howl instances', () => {
            manager.destroy();
            HowlMock._instances.forEach(h => {
                expect(h.unload).toHaveBeenCalled();
            });
        });

        it('is idempotent', () => {
            manager.destroy();
            expect(() => manager.destroy()).not.toThrow();
        });

        it('prevents play after destroy', () => {
            manager.destroy();
            expect(manager.play('hit')).toBeNull();
        });

        it('prevents stop after destroy', () => {
            manager.play('hit');
            manager.destroy();
            expect(() => manager.stop('hit')).not.toThrow();
        });
    });
});
