# HapticPlay

A web app that turns music into phone vibration. Drop in an audio file, press play, and feel the beat through your phone's vibration motor, in the spirit of Apple Music's Haptic Music feature.

**Live demo:** https://musichaptics.vercel.app/

> **Device support:** haptics work on **Android (Chrome, Firefox, Edge)** only. iPhones (including Chrome on iOS, which uses WebKit) and desktop browsers do not implement the Web Vibration API, so there the app plays audio without vibration and shows a notice.

## How it works

Everything runs in the browser. Your audio file never leaves your device.

```
audio file → decode → band-pass 40–300 Hz → onset detection → pulse schedule → navigator.vibrate()
```

1. **Decode and filter.** The file is decoded with the Web Audio API and band-passed to 40–300 Hz in an `OfflineAudioContext`. This keeps kick drums, bass and snare body, and drops vocals and hi-hats, which would otherwise turn into a constant buzz. Below 40 Hz is also cut because a phone motor can't reproduce it.
2. **Detect onsets.** The filtered signal is split into short RMS windows (8 ms, 4 ms hop). The positive change in RMS between windows marks the moment energy rises, i.e. a hit. Peaks above a threshold, with a minimum gap between them, become beats.
3. **Build a pulse schedule.** Each beat becomes one short pulse (60–120 ms, scaled by onset strength) placed on a 16 ms frame grid.
4. **Play in sync.** A `requestAnimationFrame` loop reads the audio element's `currentTime` and fires `navigator.vibrate()` when playback reaches a scheduled pulse. Pause and seek cancel any active vibration.

The pulsing orb in the UI follows the same onset data.

### Why onsets rather than loudness

Earlier iterations followed the loudness of the audio directly. That produced one long continuous buzz through sustained bass notes, and missed kicks that landed on top of an already-loud bassline. Detecting the _rise_ in energy instead gives distinct hits with silence between them, which feels much closer to rhythm.

## Limitations

- The Vibration API is on/off with a duration only. There is no true amplitude control, unlike the Taptic Engine on iPhone, so this is an approximation of Apple's feature, not a match.
- Haptics are tied to bass and rhythm. Tracks with little low-end energy (solo vocals, some classical) will feel sparse by design.
- Timing is limited by `requestAnimationFrame` (~16 ms) and device audio latency.
- Browsers may require a tap before audio can play, so playback starts from the Play button.

## Run locally

Requires Node 18+.

```bash
npm install
npm run dev
```

Open the printed URL. To feel haptics, open the app on an Android phone (same network, or use the deployed URL).

```bash
npm run build   # production build to dist/
npm run lint
```

## Deploy

The repo is configured for Vercel (`vercel.json`). Import the repository in Vercel and deploy; Vite is auto-detected. Haptic testing needs HTTPS on a real Android device, which Vercel provides.

## Project structure

```
src/
  App.jsx             UI: upload, player, seek bar, haptics toggle
  App.css             styling
  useHapticPlayer.js  React hook wrapping the engine
  hapticEngine.js     filtering, onset detection, scheduling, vibrate loop
```

## Tuning

Constants at the top of `src/hapticEngine.js`:

| Constant | Effect |
|---|---|
| `ONSET_THRESHOLD` | Lower catches softer beats; higher cuts false triggers |
| `BASS_HI_HZ` / `BASS_LO_HZ` | Frequency band that drives haptics |
| `MIN_GAP_MS` | Minimum spacing between pulses |
| `PULSE_MS_BASE` / `PULSE_MS_BONUS` | Pulse length range |

## Tech

React 19, Vite, Web Audio API, Vibration API.

## AI disclosure

This project was co-developed with AI. The code, the haptic algorithm design and this README were built collaboratively with Anthropic's Claude (via Claude Code), with a human directing the goals, testing on a real Android device, and deciding which approaches to keep or discard. The haptic approach went through several iterations (full-spectrum analysis, bass filtering, envelope following, and finally onset detection) based on how each one felt in testing. Treat the code as AI-assisted and review it before relying on it.

## License

MIT, see [LICENSE](LICENSE).
