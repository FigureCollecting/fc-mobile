import { useEffect, useRef } from 'preact/hooks';

/**
 * Detect device shake gesture via DeviceMotion API.
 * Requires HTTPS and user permission on iOS 13+.
 */
export function useShakeDetect(onShake: () => void, threshold = 15) {
  const lastX = useRef(0);
  const lastY = useRef(0);
  const lastZ = useRef(0);
  const cooldown = useRef(false);

  useEffect(() => {
    const handler = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity;
      if (!accel) return;
      const { x, y, z } = accel;
      if (x == null || y == null || z == null) return;

      const deltaX = Math.abs(x - lastX.current);
      const deltaY = Math.abs(y - lastY.current);
      const deltaZ = Math.abs(z - lastZ.current);

      if (deltaX + deltaY + deltaZ > threshold && !cooldown.current) {
        cooldown.current = true;
        onShake();
        // 1s cooldown to avoid repeated triggers
        setTimeout(() => { cooldown.current = false; }, 1000);
      }

      lastX.current = x;
      lastY.current = y;
      lastZ.current = z;
    };

    window.addEventListener('devicemotion', handler);
    return () => window.removeEventListener('devicemotion', handler);
  }, [onShake, threshold]);
}
