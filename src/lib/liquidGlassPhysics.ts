/**
 * Organic Liquid Glass Light Physics Engine
 *
 * Drives `--lg-angle` and `--lg-angle-alt` CSS variables on `:root` using:
 * 1. Device tilt (gyroscope / DeviceOrientationEvent on mobile phones)
 * 2. Scroll position (smooth specular shift as the user scrolls)
 * 3. Pointer / touch movement (light subtly follows finger/cursor)
 * 4. Multi-harmonic organic breathing (pendulum rock & figure-8 sway — never robotic looping spin)
 *
 * Respects `prefers-reduced-motion` and uses damped interpolation for 60fps fluidity.
 */
export function startLiquidGlassPhysics(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const prefersReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.documentElement;
  if (prefersReduced) {
    root.style.setProperty('--lg-angle', '38deg');
    root.style.setProperty('--lg-angle-alt', '212deg');
    return () => {};
  }

  let tiltOffset = 0;
  let tiltAltOffset = 0;
  let pointerOffset = 0;
  let scrollOffset = 0;

  let currentAngle = 35;
  let currentAltAngle = 215;
  let rafId = 0;
  const startTime = performance.now();

  const onOrientation = (event: DeviceOrientationEvent) => {
    const gamma = typeof event.gamma === 'number' ? event.gamma : 0; // left-right tilt (-90..90)
    const beta = typeof event.beta === 'number' ? event.beta - 45 : 0; // front-back tilt
    tiltOffset = Math.max(-75, Math.min(75, gamma * 1.35 + beta * 0.45));
    tiltAltOffset = Math.max(-75, Math.min(75, -gamma * 1.1 + beta * 0.7));
  };

  const onPointerMove = (event: PointerEvent) => {
    const nx = event.clientX / Math.max(window.innerWidth, 1) - 0.5;
    const ny = event.clientY / Math.max(window.innerHeight, 1) - 0.5;
    pointerOffset = nx * 58 + ny * 36;
  };

  const onScroll = () => {
    // Organic non-linear scroll reflection shift
    scrollOffset = Math.sin(window.scrollY * 0.008) * 48;
  };

  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  const tick = (now: number) => {
    const t = (now - startTime) * 0.001;

    // Multi-harmonic organic sway (rocks, pauses, catches corners — never monotonous 0->360 spin)
    const organicWaveA =
      Math.sin(t * 0.62) * 52 +
      Math.sin(t * 1.37 + 0.8) * 24 +
      Math.cos(t * 0.29) * 34;

    const organicWaveB =
      210 +
      Math.cos(t * 0.54 + 1.2) * 58 +
      Math.sin(t * 1.19 + 2.4) * 22;

    const targetAngle = 28 + organicWaveA + tiltOffset + pointerOffset + scrollOffset;
    const targetAltAngle = organicWaveB + tiltAltOffset - pointerOffset * 0.75 - scrollOffset * 0.6;

    // Smooth critically-damped lerp
    currentAngle += (targetAngle - currentAngle) * 0.08;
    currentAltAngle += (targetAltAngle - currentAltAngle) * 0.075;

    root.style.setProperty('--lg-angle', `${currentAngle.toFixed(2)}deg`);
    root.style.setProperty('--lg-angle-alt', `${currentAltAngle.toFixed(2)}deg`);

    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('scroll', onScroll);
  };
}
