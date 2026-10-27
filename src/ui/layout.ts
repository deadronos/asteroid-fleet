import { useEffect } from 'react';

/**
 * Keep the panels below the HUD. The HUD wraps onto a second row when the window is
 * narrow (or the UI scale large), and the carrier bar only shows with two or more
 * carriers, so fixed offsets let them cover the side panel's tabs. This publishes, in
 * screen pixels, `--hud-bottom` (below the HUD) and `--stack-bottom` (below the HUD and
 * the carrier bar, when shown) for the CSS to place the rest.
 */
export function useStackLayout() {
  useEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const hud = document.querySelector('.hud');
      const bar = document.querySelector<HTMLElement>('.carrier-bar');
      const hudBottom = hud ? hud.getBoundingClientRect().bottom : 73;
      // The bar sits 4px under the HUD and is not zoomed, so its height is in screen pixels.
      const stackBottom = bar ? hudBottom + 4 + bar.offsetHeight : hudBottom;
      root.style.setProperty('--hud-bottom', `${hudBottom}px`);
      root.style.setProperty('--stack-bottom', `${stackBottom}px`);
    };
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      for (const el of document.querySelectorAll('.hud, .carrier-bar')) sizes.observe(el);
      measure();
    };
    // The carrier bar mounts and unmounts as carriers are bought or reset away.
    const children = new MutationObserver(watch);
    children.observe(document.querySelector('.app') ?? document.body, { childList: true });
    watch();
    addEventListener('resize', measure);
    return () => {
      sizes.disconnect();
      children.disconnect();
      removeEventListener('resize', measure);
    };
  }, []);
}
