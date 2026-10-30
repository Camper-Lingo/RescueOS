import { useEffect, useState } from 'react';
import type { ReplayResponse } from '../types/api.ts';
import { advance, seek } from './replay.ts';
import type { Cursor } from './replay.ts';

export function useReplay(replay: ReplayResponse) {
  const [cursor, setCursor] = useState<Cursor>({ index: replay.events.length, elapsedUs: BigInt(replay.duration_us), playing: false, speed: 1 });
  useEffect(() => {
    if (!cursor.playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), delta = now - last; last = now;
      setCursor(current => advance(replay, current, delta));
    }, 100); // Interface a 10 Hz; animações 3D usam refs, sem setState por frame.
    return () => window.clearInterval(timer);
  }, [cursor.playing, cursor.speed, replay]);
  return {
    cursor, frame: replay.frames[cursor.index],
    jump: (index: number) => setCursor(current => seek(replay, index, current)),
    speed: (speed: number) => setCursor(current => ({ ...current, speed })),
    toggle: () => setCursor(current => current.playing ? { ...current, playing: false }
      : { ...(current.index === replay.events.length ? seek(replay, 0, current) : current), playing: replay.events.length > 0 }),
  };
}
