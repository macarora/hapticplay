import { useRef, useState, useEffect } from "react";
import { HapticEngine } from "./hapticEngine.js";

export function useHapticPlayer(audioRef) {
  const engine  = useRef(new HapticEngine());
  const [ready,     setReady]     = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [intensity, setIntensity] = useState(0);
  const [muted,     setMuted]     = useState(false);

  useEffect(() => {
    const eng = engine.current;
    if (ready && audioRef.current) {
      eng.attach(audioRef.current, setIntensity);
    }
    return () => eng.detach();
  }, [ready, audioRef]);

  async function analyze(arrayBuffer) {
    setLoading(true);
    setError(null);
    setReady(false);
    setIntensity(0);
    try {
      await engine.current.analyze(arrayBuffer);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleMuted() {
    engine.current.toggleMuted();
    setMuted(engine.current.muted);
  }

  return { analyze, ready, loading, error, intensity, muted, toggleMuted };
}
