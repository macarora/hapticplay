// ─── Tuning ────────────────────────────────────────────────────────────────
const BASS_HI_HZ      = 300;   // low-pass cutoff — captures kick, bass guitar, snare body
const BASS_LO_HZ      = 40;    // high-pass cutoff — cuts sub-rumble phones can't reproduce
const WINDOW_MS       = 8;     // RMS window for onset detection
const HOP_MS          = 4;     // hop between windows (50% overlap)
const ONSET_THRESHOLD = 0.18;  // min normalised onset strength to fire
const MIN_GAP_MS      = 80;    // minimum silence between pulses (~750 BPM ceiling)
const PULSE_MS_BASE   = 60;    // base pulse length
const PULSE_MS_BONUS  = 60;    // extra ms added at full onset strength (total range 60–120ms)
const FRAME_MS        = 16;    // lookup grid resolution (≈ one RAF frame)

// ─── Step 1: band-pass the audio offline to isolate bass ───────────────────
async function filterBass(audioBuffer) {
  const { sampleRate, length } = audioBuffer;
  const offline = new OfflineAudioContext(1, length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;

  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = BASS_LO_HZ;
  hp.Q.value = 0.5;

  const lp1 = offline.createBiquadFilter();
  lp1.type = "lowpass";
  lp1.frequency.value = BASS_HI_HZ;
  lp1.Q.value = 0.5;

  const lp2 = offline.createBiquadFilter();
  lp2.type = "lowpass";
  lp2.frequency.value = BASS_HI_HZ;
  lp2.Q.value = 0.5;

  const gain = offline.createGain();
  gain.gain.value = 6.0;

  src.connect(hp);
  hp.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(gain);
  gain.connect(offline.destination);
  src.start(0);

  const filtered = await offline.startRendering();
  return filtered.getChannelData(0);
}

// ─── Step 2: onset detection via positive RMS derivative ───────────────────
function detectOnsets(samples, sampleRate) {
  const wSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const hSize = Math.floor(sampleRate * HOP_MS   / 1000);

  // RMS per hop window
  const rms = [];
  for (let i = 0; i + wSize <= samples.length; i += hSize) {
    let sum = 0;
    for (let j = 0; j < wSize; j++) sum += samples[i + j] ** 2;
    rms.push(Math.sqrt(sum / wSize));
  }

  // Onset strength = positive first-order difference of RMS
  const raw = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i++) raw[i] = Math.max(0, rms[i] - rms[i - 1]);

  // 3-tap smoothing to reduce jitter
  const strength = new Float32Array(raw.length);
  for (let i = 1; i < raw.length - 1; i++) {
    strength[i] = (raw[i - 1] + raw[i] + raw[i + 1]) / 3;
  }

  // Normalise
  const peak = strength.reduce((m, v) => Math.max(m, v), 0);
  if (peak > 0) for (let i = 0; i < strength.length; i++) strength[i] /= peak;

  // Peak-pick with minimum inter-onset gap
  const minGapHops = Math.ceil(MIN_GAP_MS / HOP_MS);
  const hopSec     = hSize / sampleRate;
  const onsets     = [];
  let lastIdx      = -minGapHops;

  for (let i = 2; i < strength.length - 2; i++) {
    const s = strength[i];
    if (
      s >= ONSET_THRESHOLD &&
      s > strength[i - 1] && s > strength[i - 2] &&
      s >= strength[i + 1] && s >= strength[i + 2] &&
      i - lastIdx >= minGapHops
    ) {
      const pulseMs = Math.round(PULSE_MS_BASE + s * PULSE_MS_BONUS);
      onsets.push({ time: i * hopSec, pulseMs, strength: s });
      lastIdx = i;
    }
  }

  return onsets;
}

// ─── Step 3: map onsets to a frame-indexed lookup ──────────────────────────
// Each onset fires navigator.vibrate([onMs, offMs]) once, at one RAF frame.
function buildFrameMap(onsets, durationSec) {
  const numFrames = Math.ceil(durationSec * 1000 / FRAME_MS) + 1;
  const map       = new Array(numFrames).fill(null);

  for (const { time, pulseMs, strength } of onsets) {
    const frame   = Math.round(time * 1000 / FRAME_MS);
    const onMs    = pulseMs;
    const offMs   = Math.max(0, MIN_GAP_MS - onMs);
    map[frame]    = { pattern: offMs > 0 ? [onMs, offMs] : [onMs], strength };
  }

  return map;
}

// ─── HapticEngine ─────────────────────────────────────────────────────────
export class HapticEngine {
  _frameMap     = [];
  _bucketIntens = []; // coarse intensity per frame for UI animation
  _duration     = 0;
  _ready        = false;
  _muted        = false;
  _rafId        = 0;
  _mediaEl      = null;
  _lastFrame    = -1;
  _cleanup      = null;
  _onTick       = null;

  async analyze(arrayBuffer) {
    const ctx    = new AudioContext();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    await ctx.close();

    this._duration = buffer.duration;

    const bass   = await filterBass(buffer);
    const onsets = detectOnsets(bass, buffer.sampleRate);
    this._frameMap = buildFrameMap(onsets, buffer.duration);

    // Build a smooth intensity curve for the orb animation (envelope over onsets)
    const n = this._frameMap.length;
    this._bucketIntens = new Float32Array(n);
    const decayPerFrame = Math.exp(-1 / (400 / FRAME_MS)); // ~400ms visual decay
    let env = 0;
    for (let i = 0; i < n; i++) {
      const onset = this._frameMap[i];
      if (onset) env = Math.max(env, onset.strength);
      else env *= decayPerFrame;
      this._bucketIntens[i] = env;
    }

    this._ready = true;
  }

  attach(mediaEl, onTick) {
    this.detach();
    this._mediaEl  = mediaEl;
    this._lastFrame = -1;
    this._onTick   = onTick ?? null;

    const stop = () => { navigator.vibrate?.(0); };
    const onSeeked = () => { stop(); this._lastFrame = -1; };

    mediaEl.addEventListener("pause",  stop);
    mediaEl.addEventListener("seeked", onSeeked);
    this._cleanup = () => {
      mediaEl.removeEventListener("pause",  stop);
      mediaEl.removeEventListener("seeked", onSeeked);
    };

    const tick = () => {
      if (this._mediaEl && !this._mediaEl.paused) {
        const t     = this._mediaEl.currentTime;
        const frame = Math.floor(t * 1000 / FRAME_MS);

        // Fire onset pulse exactly once when we enter a new frame that has one
        if (frame !== this._lastFrame) {
          this._lastFrame = frame;
          const hit = this._frameMap[frame];
          if (hit && !this._muted) navigator.vibrate?.(hit.pattern);
        }

        // Smooth intensity for UI
        const intens = this._bucketIntens[frame] ?? 0;
        this._onTick?.(intens);
      } else {
        this._onTick?.(0);
      }

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  detach() {
    cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    navigator.vibrate?.(0);
    this._cleanup?.();
    this._cleanup = null;
    this._mediaEl = null;
    this._lastFrame = -1;
    this._onTick  = null;
  }

  get ready()   { return this._ready; }
  get muted()   { return this._muted; }
  set muted(v)  { this._muted = v; if (v) navigator.vibrate?.(0); }
  toggleMuted() { this.muted = !this._muted; }
}
