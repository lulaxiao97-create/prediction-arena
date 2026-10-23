/**
 * Touch feedback.
 *
 * The visual half of "native feel" is CSS (`active:scale-*` — already on every control).
 * This is the other half: a short haptic tick where the platform exposes one. Android
 * Chrome and Samsung Internet fire `navigator.vibrate`; iOS Safari ignores it, which is
 * why the call is optional and silent rather than feature-detected with a fallback path.
 */

export function tap(pattern: VibratePattern = 8): void {
  if (typeof window === "undefined") return;
  const vibrate = navigator.vibrate ? navigator.vibrate.bind(navigator) : undefined;
  if (!vibrate) return;
  try {
    vibrate(pattern);
  } catch {
    /* never let feedback break an interaction */
  }
}

/** A slightly firmer tick for committing a choice (option switch, amount chip). */
export function select(): void {
  tap(12);
}

/** Two-part pattern for a completed action; still short enough not to feel buzzy. */
export function success(): void {
  tap([10, 40, 18]);
}
