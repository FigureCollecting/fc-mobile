/**
 * Haptic feedback utilities using the Vibration API.
 * No-ops gracefully on unsupported devices.
 */

/** Light tap — UI selection, toggle, nav */
export function hapticLight(): void {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

/** Medium press — confirmation, action complete */
export function hapticMedium(): void {
  if ('vibrate' in navigator) navigator.vibrate(25);
}

/** Heavy press — destructive action, error */
export function hapticHeavy(): void {
  if ('vibrate' in navigator) navigator.vibrate([25, 50, 25]);
}
