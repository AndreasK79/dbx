/**
 * JetBrains-style double-Shift gesture detection (Search Everywhere).
 *
 * The gesture is two bare Shift presses within `intervalMs` with no other
 * keydown in between — so typing capitals (letter keydowns sit between the
 * Shift presses) never triggers it. Shift pressed as part of a combo
 * (Ctrl+Shift+…) does not count and resets the pending press.
 */
export interface DoubleShiftGestureDetector {
  /** Feed every window keydown (capture phase recommended — stopped events must still reset). */
  handleKeyDown(event: KeyboardEvent): void;
  /** Drop a pending first press (window blur, dialog opened by other means). */
  reset(): void;
}

export const DOUBLE_SHIFT_DEFAULT_INTERVAL_MS = 400;

export function createDoubleShiftGestureDetector(onTrigger: () => void, intervalMs: number = DOUBLE_SHIFT_DEFAULT_INTERVAL_MS): DoubleShiftGestureDetector {
  let lastShiftDownAt = 0;

  function reset(): void {
    lastShiftDownAt = 0;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Shift") {
      // Any other key breaks the double-press sequence. Repeats of held
      // modifier-free keys still count: a key held across both Shift presses
      // (e.g. pausing on a letter) is not a clean double press.
      reset();
      return;
    }
    // Holding Shift fires repeated keydowns; only real presses advance the gesture.
    if (event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      reset();
      return;
    }
    const now = event.timeStamp;
    if (lastShiftDownAt > 0 && now - lastShiftDownAt <= intervalMs) {
      reset();
      onTrigger();
      return;
    }
    lastShiftDownAt = now;
  }

  return { handleKeyDown, reset };
}
