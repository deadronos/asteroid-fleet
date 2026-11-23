import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { events, frame, play, unlock } from '../game/audio';
import { engine } from '../game/engine';

/** Bridges sim FX, events and button presses to the lazy audio synth; holds no state (#236). */
export function AudioBridge() {
  useEffect(() => {
    const gesture = () => unlock();
    const click = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('button')) play('ui');
    };
    const sync = () => events(engine.events, engine.epoch, engine.focusedCarrierId);
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    document.addEventListener('click', click);
    const off = engine.subscribe(sync);
    sync();
    return () => {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      document.removeEventListener('click', click);
      off();
    };
  }, []);
  useFrame(() => frame(engine.view.fx, engine.view.id));
  return null;
}
