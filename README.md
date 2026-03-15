# lite-audio-manager

[![npm version](https://img.shields.io/npm/v/lite-audio-manager.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/lite-audio-manager)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/lite-audio-manager?style=for-the-badge)](https://bundlephobia.com/result?p=lite-audio-manager)
[![npm downloads](https://img.shields.io/npm/dm/lite-audio-manager?style=for-the-badge&color=blue)](https://www.npmjs.com/package/lite-audio-manager)
[![npm total downloads](https://img.shields.io/npm/dt/lite-audio-manager?style=for-the-badge&color=blue)](https://www.npmjs.com/package/lite-audio-manager)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

A robust audio manager built on [Howler.js](https://howlerjs.com) with iOS/mobile unlock, category-based stopping, pitch variation, fade-safe teardown, and mute persistence.

Unlike using Howler directly, this manager handles the platform edge cases that break audio in real apps — suspended `AudioContext` on mobile, background tab suspension in Chrome, ghost plays when the context isn't running, and the entire fade/stop race condition surface.

## Features

- **iOS/mobile audio unlock** — silent buffer pulse + `ctx.resume()` on first user interaction
- **Background tab resume** — re-activates `AudioContext` on `visibilitychange`
- **Category-based stopping** — stop all sounds in a category (e.g. `'sfx'`, `'music'`) with one call
- **Fade-safe stopping** — fade guard prevents double-stop race conditions
- **Queued sound handling** — force-kills sounds that are queued but not yet playing
- **Multi-instance tracking** — concurrent plays of the same sound are all tracked and stoppable
- **Pitch variation** — random or explicit pitch for natural-sounding repeated SFX
- **Mute persistence** — saves to `localStorage`, restores on next session
- **EventTarget events** — emits `'mutechange'` for framework-agnostic UI binding
- **Clean teardown** — `AbortController`-based listener cleanup, `destroy()` is idempotent

## Installation

```bash
npm install lite-audio-manager
```

## Quick Start

```javascript
import { audioManager } from 'lite-audio-manager';

audioManager.init({
    bgm:   { src: ['/audio/music.mp3'], loop: true, volume: 0.5, category: 'music', html5: true },
    hit:   { src: ['/audio/hit.wav'], category: 'sfx' },
    coin:  { src: ['/audio/coin.wav'], category: 'sfx', pitchVar: 0.15 },
    win:   { src: ['/audio/fanfare.mp3'], category: 'outcome' },
    lose:  { src: ['/audio/sad.mp3'], category: 'outcome' },
});

// Play a sound
audioManager.play('hit', { volume: 0.8 });

// Play with random pitch variation (±10%)
audioManager.play('coin', { pitchVar: 0.1 });

// Start background music
audioManager.play('bgm', { loop: true, volume: 0.3 });

// Stop all SFX with a 200ms fade
audioManager.stopCategory('sfx', { fade: 200 });

// Play a win sound, stopping any current outcome audio first
audioManager.playExclusive('win');
```

## API

### `audioManager.init(config)`

Initialize with a sound configuration map. Call once at app startup.

```javascript
audioManager.init({
    soundName: {
        src: ['/path/to/file.mp3'],  // Required: Howl source(s)
        category: 'sfx',             // Optional: for stopCategory()
        loop: false,                 // Optional: Howl option
        volume: 1,                   // Optional: Howl option
        html5: false,                // Optional: true for long tracks
        // ...any other Howl options
    }
});
```

### Playback

| Method | Description |
|--------|-------------|
| `.play(name, options?)` | Play a sound. Returns Howl id or `null` if skipped. |
| `.playExclusive(name, options?)` | Stop `'outcome'` category, then play. |
| `.playUnique(name, threshold?)` | Play only if not played within `threshold` ms. |

**Play options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `volume` | `number` | `1` | Volume (0–1) |
| `loop` | `boolean` | `false` | Loop the sound |
| `pitchVar` | `number` | `0` | Random pitch variation (e.g. `0.1` = ±10%) |
| `pitch` | `number \| null` | `null` | Explicit pitch override (ignores `pitchVar`) |

### Stopping

| Method | Description |
|--------|-------------|
| `.stop(name, options?)` | Stop a sound with optional fade. |
| `.stopCategory(category, options?)` | Stop all sounds in a category. |
| `.stopCategories(categories, options?)` | Stop multiple categories at once. |

**Stop options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fade` | `number` | `120` | Fade-out duration in ms (0 = instant) |

### Global State

```javascript
// Toggle mute
audioManager.setMuted(!audioManager.isMuted);

// Listen for mute changes (framework-agnostic)
audioManager.addEventListener('mutechange', (e) => {
    console.log('Muted:', e.detail.isMuted);
});
```

| Property | Type | Description |
|----------|------|-------------|
| `.isMuted` | `boolean` | Current mute state |
| `.isUnlocked` | `boolean` | Whether AudioContext has been unlocked |

### Lifecycle

| Method | Description |
|--------|-------------|
| `.destroy()` | Unload all sounds, remove listeners. Idempotent. |

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| iOS/Android first interaction | Silent buffer + `ctx.resume()` unlocks AudioContext |
| Chrome background tab | `visibilitychange` listener resumes suspended context |
| Play while context suspended | Silently returns `null` (no queued ghost plays) |
| `stop()` during fade | `#fadingIds` guard prevents double-stop crash |
| `stop()` on queued sound | Force-kills instantly (no fade on silence) |
| Two `play('hit')` calls | Both ids tracked, both stoppable independently |
| Looped sound cleanup | No orphaned `'end'` listener (only added for non-looped) |
| Safari private mode | `localStorage.setItem` wrapped in try/catch |
| SSR / Service Worker | `localStorage` read wrapped in try/catch |
| Double `destroy()` | Idempotent — second call is a no-op |

## TypeScript

Full type definitions included with typed event listener overrides:

```typescript
import { audioManager, type SoundConfig, type PlayOptions } from 'lite-audio-manager';

const config: Record<string, SoundConfig> = {
    hit: { src: ['/hit.wav'], category: 'sfx' },
};

audioManager.init(config);
audioManager.play('hit', { volume: 0.5, pitchVar: 0.1 });

audioManager.addEventListener('mutechange', (e) => {
    console.log(e.detail.isMuted); // fully typed
});
```

## License

MIT
