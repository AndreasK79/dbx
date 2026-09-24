import { describe, expect, it, vi } from "vitest";
import { createDoubleShiftGestureDetector, DOUBLE_SHIFT_DEFAULT_INTERVAL_MS } from "@/lib/keyboard/doubleShiftGesture";

function keyEvent(key: string, at: number, modifiers: Partial<Pick<KeyboardEvent, "repeat" | "ctrlKey" | "altKey" | "metaKey">> = {}): KeyboardEvent {
  return { key, timeStamp: at, repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...modifiers } as KeyboardEvent;
}

describe("createDoubleShiftGestureDetector", () => {
  it("triggers on two bare Shift presses within the interval", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    expect(onTrigger).not.toHaveBeenCalled();
    detector.handleKeyDown(keyEvent("Shift", 300));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when the interval elapsed between presses", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    detector.handleKeyDown(keyEvent("Shift", 600));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not trigger when another key intervenes (typing capitals never trips it)", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    detector.handleKeyDown(keyEvent("A", 120));
    detector.handleKeyDown(keyEvent("Shift", 200));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not count Shift pressed as part of a combo", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    // Second press happens while Ctrl is held (Ctrl+Shift+... chord).
    detector.handleKeyDown(keyEvent("Shift", 200, { ctrlKey: true }));
    detector.handleKeyDown(keyEvent("Shift", 300));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat Shift keydowns while Shift is held", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    detector.handleKeyDown(keyEvent("Shift", 150, { repeat: true }));
    detector.handleKeyDown(keyEvent("Shift", 250, { repeat: true }));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("resets the pending press after triggering, so a third press starts over", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    detector.handleKeyDown(keyEvent("Shift", 300));
    expect(onTrigger).toHaveBeenCalledTimes(1);
    // The triggering press must not linger as a pending first press.
    detector.handleKeyDown(keyEvent("Shift", 400));
    expect(onTrigger).toHaveBeenCalledTimes(1);
    detector.handleKeyDown(keyEvent("Shift", 500));
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("reset() drops a pending press", () => {
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger, 400);
    detector.handleKeyDown(keyEvent("Shift", 100));
    detector.reset();
    detector.handleKeyDown(keyEvent("Shift", 200));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("uses the default interval when none is given", () => {
    expect(DOUBLE_SHIFT_DEFAULT_INTERVAL_MS).toBeGreaterThan(0);
    const onTrigger = vi.fn();
    const detector = createDoubleShiftGestureDetector(onTrigger);
    detector.handleKeyDown(keyEvent("Shift", 1000));
    detector.handleKeyDown(keyEvent("Shift", 1000 + DOUBLE_SHIFT_DEFAULT_INTERVAL_MS));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
