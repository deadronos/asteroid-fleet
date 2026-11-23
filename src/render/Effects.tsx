import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/**
 * Loaded lazily and mounted only for HQ with bloom on; otherwise the scene renders
 * straight to the canvas. The composer draws into its own target, so the canvas's
 * `antialias` doesn't reach it: `multisampling` gives that target its own MSAA,
 * scaled down at higher DPR to avoid 16x supersampling on Retina screens (#239).
 */
export default function Effects() {
  const dpr = useThree((s) => s.viewport.dpr);
  const multisampling = dpr >= 1.5 ? 0 : dpr > 1 ? 2 : 4;
  return (
    <EffectComposer multisampling={multisampling}>
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={1} luminanceSmoothing={0.2} />
      <Vignette eskil={false} offset={0.2} darkness={0.7} />
    </EffectComposer>
  );
}
