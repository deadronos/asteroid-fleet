import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

/**
 * Loaded lazily and mounted only for HQ with bloom on; otherwise the scene renders
 * straight to the canvas. The composer draws into its own target, so the canvas's
 * `antialias` doesn't reach it: `multisampling` gives that target its own MSAA.
 */
export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={1} luminanceSmoothing={0.2} />
      <Vignette eskil={false} offset={0.2} darkness={0.7} />
    </EffectComposer>
  );
}
