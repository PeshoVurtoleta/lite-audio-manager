/**
 * lite-audio-manager
 *
 * Wraps Howler.js behind a robust manager with iOS/mobile audio unlock,
 * pitch variation, category-based stopping, fade-safe teardown, and mute
 * persistence. Emits 'mutechange' events via native EventTarget.
 *
 * Usage:
 *   import { audioManager } from 'lite-audio-manager';
 *   audioManager.init({ hit: { src: ['/sfx/hit.wav'], category: 'sfx' } });
 *   audioManager.play('hit', { volume: 0.8, pitchVar: 0.1 });
 */

import { Howl, Howler } from 'howler';

export class AudioManager extends EventTarget {
    /** @type {Map<string, Howl>} */
    #sounds = new Map();

    /** @type {Object} Original config passed to init() — used by stopCategory */
    #config = {};

    /** @type {Map<string, Set<number>>} All active play ids per sound name */
    #activeIds = new Map();

    /** @type {Set<number>} Ids currently mid-fade (prevents double-stop) */
    #fadingIds = new Set();

    /** @type {Map<string, number>} Last play timestamp per name (for playUnique) */
    #lastPlayed = new Map();

    #lifecycleController = new AbortController();
    #unlockController = new AbortController();
    #destroyed = false;

    constructor() {
        super();
        this.isUnlocked = false;
        this.isMuted = false;

        // Safe localStorage read for SSR / Workers / sandboxed iframes
        try {
            const saved = localStorage.getItem('lite_audio_muted');
            if (saved !== null) this.isMuted = saved === 'true';
        } catch { /* storage unavailable */ }
    }

    /**
     * Initialize the manager with a sound configuration map.
     * Each key is a sound name, each value is a Howl options object.
     * Optionally include a `category` field for category-based stopping.
     *
     * @param {Object<string, Object>} config
     *
     * @example
     *   manager.init({
     *       bgm: { src: ['/music.mp3'], loop: true, volume: 0.5, category: 'music' },
     *       hit: { src: ['/hit.wav'], category: 'sfx' },
     *   });
     */
    init(config = {}) {
        this.#config = config;
        Howler.mute(this.isMuted);

        for (const [name, options] of Object.entries(config)) {
            if (this.#sounds.has(name)) continue;

            // Separate our custom fields from Howl options
            const { category, pitchVar, ...howlOpts } = options;

            this.#sounds.set(name, new Howl({
                preload: true,
                ...howlOpts,
                onloaderror: (_id, err) =>
                    console.error(`🚨 Audio load error [${name}]:`, err),
            }));
        }

        // Bind unlock events in browser environments
        if (typeof window !== 'undefined') {
            this.#setupUnlock();
            this.#setupVisibilityResume();
        }
    }


    // ═══════════════════════════════════════════════════════════
    //  Mobile Audio Unlock
    // ═══════════════════════════════════════════════════════════

    #setupUnlock() {
        const events = ['touchstart', 'touchend', 'mousedown', 'keydown'];

        const unlock = () => {
            if (this.isUnlocked) return;

            const ctx = Howler.ctx;
            if (!ctx) return;

            if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
                // Silent buffer pulse to force hardware pipeline open
                const buffer = ctx.createBuffer(1, 1, 22050);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(0);

                // Explicit resume — some browsers (iOS Safari) need this
                ctx.resume().then(() => {
                    this.isUnlocked = true;
                    this.#unlockController.abort();
                });
            } else {
                this.isUnlocked = true;
                this.#unlockController.abort();
            }
        };

        events.forEach(evt =>
            window.addEventListener(evt, unlock, {
                capture: true,
                signal: this.#unlockController.signal,
            })
        );
    }

    /** Resume AudioContext when tab regains visibility (Chrome suspends background tabs). */
    #setupVisibilityResume() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && Howler.ctx?.state === 'suspended') {
                Howler.ctx.resume();
            }
        }, { signal: this.#lifecycleController.signal });
    }


    // ═══════════════════════════════════════════════════════════
    //  Playback
    // ═══════════════════════════════════════════════════════════

    /**
     * Play a sound by name.
     *
     * @param {string} name
     * @param {Object} [options]
     * @param {number} [options.volume=1]    Volume (0–1)
     * @param {boolean} [options.loop=false] Loop the sound
     * @param {number} [options.pitchVar=0]  Random pitch variation range (e.g. 0.1 = ±10%)
     * @param {number|null} [options.pitch=null] Explicit pitch override (ignores pitchVar)
     * @returns {number|null} Howl play id, or null if skipped
     */
    play(name, { volume = 1, loop = false, pitchVar = 0, pitch = null } = {}) {
        if (this.#destroyed) return null;

        const howl = this.#sounds.get(name);
        if (!howl) {
            console.warn(`AudioManager: sound "${name}" not found.`);
            return null;
        }

        // Silent drop if context isn't running (avoids queuing inaudible sounds)
        if (Howler.ctx?.state !== 'running') return null;

        const id = howl.play();
        howl.volume(volume, id);
        howl.loop(loop, id);

        // Pitch: explicit override takes precedence over random variation
        if (pitch !== null) {
            howl.rate(pitch, id);
        } else if (pitchVar > 0) {
            const rate = 1.0 + (Math.random() - 0.5) * 2 * pitchVar;
            howl.rate(rate, id);
        }

        // Track active id
        if (!this.#activeIds.has(name)) {
            this.#activeIds.set(name, new Set());
        }
        this.#activeIds.get(name).add(id);

        // Auto-cleanup for non-looped sounds (looped sounds never fire 'end')
        if (!loop) {
            howl.once('end', () => this.#removeActiveId(name, id), id);
        }

        return id;
    }

    /**
     * Play a sound exclusively — stops all sounds in the 'outcome' category first.
     */
    playExclusive(name, options = {}) {
        this.stopCategory('outcome');
        return this.play(name, options);
    }

    /**
     * Play a sound only if it hasn't been played within `threshold` ms.
     * Prevents machine-gun stacking of rapid-fire SFX.
     */
    playUnique(name, threshold = 100) {
        const now = performance.now();
        const last = this.#lastPlayed.get(name) ?? 0;
        if (now - last > threshold) {
            this.#lastPlayed.set(name, now);
            return this.play(name);
        }
        return null;
    }


    // ═══════════════════════════════════════════════════════════
    //  Stopping
    // ═══════════════════════════════════════════════════════════

    /**
     * Stop a sound by name with an optional fade-out.
     *
     * @param {string} name
     * @param {Object} [options]
     * @param {number} [options.fade=120] Fade-out duration in ms (0 = instant)
     */
    stop(name, { fade = 120 } = {}) {
        if (this.#destroyed) return;

        const howl = this.#sounds.get(name);
        const ids = this.#activeIds.get(name);
        if (!howl || !ids?.size) return;

        // Snapshot — the Set mutates during iteration via callbacks
        for (const id of [...ids]) {
            this.#stopInstance(name, howl, id, fade);
        }
    }

    #stopInstance(name, howl, id, fade) {
        // Skip if already mid-fade (prevents double-stop race)
        if (this.#fadingIds.has(id)) return;

        // Queued-but-not-playing: force-kill instantly (nothing audible to fade)
        if (!howl.playing(id)) {
            howl.stop(id);
            this.#removeActiveId(name, id);
            return;
        }

        // Actively playing — fade or instant stop
        if (fade > 0) {
            this.#fadingIds.add(id);
            howl.fade(howl.volume(id), 0, fade, id);
            howl.once('fade', () => {
                howl.stop(id);
                this.#fadingIds.delete(id);
                this.#removeActiveId(name, id);
            }, id);
        } else {
            howl.stop(id);
            this.#removeActiveId(name, id);
        }
    }

    /**
     * Stop all sounds in a category.
     * Uses the config passed to init() to resolve category membership.
     *
     * @param {string} categoryName
     * @param {Object} [options]
     * @param {number} [options.fade=120] Fade-out duration in ms
     */
    stopCategory(categoryName, { fade = 120 } = {}) {
        for (const [name, settings] of Object.entries(this.#config)) {
            if (settings?.category === categoryName) {
                this.stop(name, { fade });
            }
        }
    }

    /**
     * Stop all sounds in multiple categories.
     */
    stopCategories(categories, options = {}) {
        for (const cat of categories) this.stopCategory(cat, options);
    }

    #removeActiveId(name, id) {
        const ids = this.#activeIds.get(name);
        if (!ids) return;
        ids.delete(id);
        if (ids.size === 0) this.#activeIds.delete(name);
    }


    // ═══════════════════════════════════════════════════════════
    //  Global State
    // ═══════════════════════════════════════════════════════════

    /**
     * Set the global mute state. Persists to localStorage and emits 'mutechange'.
     *
     * @param {boolean} state
     *
     * @example
     *   manager.addEventListener('mutechange', (e) => {
     *       console.log('Muted:', e.detail.isMuted);
     *   });
     */
    setMuted(state = true) {
        this.isMuted = state;
        Howler.mute(state);

        this.dispatchEvent(new CustomEvent('mutechange', {
            detail: { isMuted: state },
        }));

        try {
            localStorage.setItem('lite_audio_muted', String(state));
        } catch { /* Safari private mode / storage unavailable */ }
    }


    // ═══════════════════════════════════════════════════════════
    //  Teardown
    // ═══════════════════════════════════════════════════════════

    /**
     * Stop all sounds, remove event listeners, and release resources.
     * Idempotent — safe to call multiple times.
     */
    destroy() {
        if (this.#destroyed) return;
        this.#destroyed = true;

        this.#lifecycleController.abort();
        this.#unlockController.abort();

        this.#sounds.forEach(howl => howl.unload());
        this.#sounds.clear();
        this.#activeIds.clear();
        this.#fadingIds.clear();
        this.#lastPlayed.clear();
        this.#config = {};
    }
}

// Default singleton for plug-and-play use
export const audioManager = new AudioManager();
