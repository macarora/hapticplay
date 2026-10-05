import { useState, useRef } from "react";
import { useHapticPlayer } from "./useHapticPlayer.js";
import "./App.css";

const supportsHaptics = typeof navigator !== "undefined" && "vibrate" in navigator;
const AUDIO_EXTS = /\.(mp3|wav|ogg|flac|aac|m4a|opus|weba)$/i;

function isAudioFile(file) {
  return file.type.startsWith("audio/") || AUDIO_EXTS.test(file.name);
}

function formatTime(secs) {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const audioRef     = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  const { analyze, ready, loading, error, intensity, muted, toggleMuted } =
    useHapticPlayer(audioRef);

  const [trackName,   setTrackName]   = useState(null);
  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [dragging,    setDragging]    = useState(false);

  async function loadFile(file) {
    if (!file || !isAudioFile(file)) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setTrackName(file.name.replace(/\.[^.]+$/, ""));
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.load();
    }

    const buffer = await file.arrayBuffer();
    await analyze(buffer);
  }

  function handleFileInput(e) {
    loadFile(e.target.files[0]);
    e.target.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }

  async function togglePlay() {
    if (!audioRef.current || !ready) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      await audioRef.current.play();
    }
  }

  function handleSeek(e) {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  }

  const pulseScale  = 1 + intensity * 0.55;
  const glowOpacity = 0.08 + intensity * 0.55;
  const progress    = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="app">
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      {!trackName ? (
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
        >
          <div className="drop-blob">🎵</div>
          <p className="drop-title">Drop audio here</p>
          <p className="drop-sub">or tap to browse</p>
          <p className="drop-formats">MP3 · WAV · FLAC · OGG</p>
          {!supportsHaptics && (
            <p className="no-haptics-note">Haptic feedback requires Android Chrome</p>
          )}
        </div>
      ) : (
        <div className="player">
          <div className="player-top">
            <div className="orb-wrap">
              <div
                className="orb-glow"
                style={{
                  opacity:   playing ? glowOpacity : 0.06,
                  transform: `scale(${playing ? pulseScale : 1})`,
                }}
              />
              <div className="orb-core">
                {loading ? <div className="spinner" /> : <span className="orb-icon">🎵</span>}
              </div>
            </div>

            <p className="track-name">{trackName}</p>
            {loading && <p className="status-text">Analyzing audio…</p>}
            {error   && <p className="status-text error">{error}</p>}
          </div>

          <div className="player-bottom">
            <div className="seek-wrap">
              <div className="seek-track">
                <div className="seek-fill" style={{ width: `${progress}%` }} />
                <input
                  type="range"
                  className="seek-input"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                />
              </div>
              <div className="seek-times">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <button
              className="btn-play"
              onClick={togglePlay}
              disabled={!ready || loading}
            >
              {playing ? "⏸" : "▶"}
            </button>

            <div className="bottom-row">
              {supportsHaptics && (
                <button
                  className={`btn-secondary ${muted ? "" : "active"}`}
                  onClick={toggleMuted}
                >
                  {muted ? "📵 Haptics off" : "📳 Haptics on"}
                </button>
              )}
              <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                Change track
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
