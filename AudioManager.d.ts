/**
 * lite-audio-manager — Howler.js wrapper with unlock, categories, and mute events
 */

import { Howl } from 'howler';

export interface SoundConfig {
    /** Audio file source(s). */
    src: string[];
    /** Sound category for group stopping (e.g. 'sfx', 'music', 'outcome'). */
    category?: string;
    /** Default pitch variation range for this sound. */
    pitchVar?: number;
    /** Whether to loop by default. */
    loop?: boolean;
    /** Default volume (0–1). */
    volume?: number;
    /** Use HTML5 Audio instead of Web Audio (better for long tracks). */
    html5?: boolean;
    /** Howl pool size. */
    pool?: number;
    /** Any additional Howl options. */
    [key: string]: any;
}

export interface PlayOptions {
    /** Volume (0–1). Default: 1 */
    volume?: number;
    /** Loop the sound. Default: false */
    loop?: boolean;
    /** Random pitch variation range (e.g. 0.1 = ±10%). Default: 0 */
    pitchVar?: number;
    /** Explicit pitch override (ignores pitchVar). Default: null */
    pitch?: number | null;
}

export interface StopOptions {
    /** Fade-out duration in ms (0 = instant). Default: 120 */
    fade?: number;
}

export interface MuteChangeEvent extends CustomEvent {
    detail: { isMuted: boolean };
}

export class AudioManager extends EventTarget {
    /** Whether the Web Audio context has been unlocked via user interaction. */
    isUnlocked: boolean;
    /** Current global mute state. */
    isMuted: boolean;

    constructor();

    /**
     * Initialize with a sound configuration map.
     * Each key is a sound name, each value contains Howl options + optional `category`.
     */
    init(config: Record<string, SoundConfig>): void;

    /**
     * Play a sound by name.
     * @returns Howl play id, or null if skipped.
     */
    play(name: string, options?: PlayOptions): number | null;

    /**
     * Play a sound exclusively — stops all sounds in the 'outcome' category first.
     * @returns Howl play id, or null if skipped.
     */
    playExclusive(name: string, options?: PlayOptions): number | null;

    /**
     * Play a sound only if it hasn't been played within `threshold` ms.
     * @returns Howl play id, or null if skipped/throttled.
     */
    playUnique(name: string, threshold?: number): number | null;

    /**
     * Stop a sound by name with an optional fade-out.
     */
    stop(name: string, options?: StopOptions): void;

    /**
     * Stop all sounds in a category.
     */
    stopCategory(categoryName: string, options?: StopOptions): void;

    /**
     * Stop all sounds in multiple categories.
     */
    stopCategories(categories: string[], options?: StopOptions): void;

    /**
     * Set global mute state. Persists to localStorage and emits 'mutechange'.
     */
    setMuted(state?: boolean): void;

    /**
     * Stop all sounds, remove listeners, release resources. Idempotent.
     */
    destroy(): void;

    // EventTarget overrides for type-safe event listening
    addEventListener(
        type: 'mutechange',
        listener: (event: MuteChangeEvent) => void,
        options?: boolean | AddEventListenerOptions
    ): void;
    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ): void;
}

/** Default singleton instance for plug-and-play use. */
export const audioManager: AudioManager;

export default AudioManager;
