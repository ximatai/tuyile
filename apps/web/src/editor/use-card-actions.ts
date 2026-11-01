import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
/** A short shared grace period bridges the gap between a card and its portal toolbar. */
export function useCardActions() {
  const [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enter = useCallback(() => {
    clearTimeout(timer.current);
    setHovered(true);
  }, []);
  const leave = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(false), 180);
  }, []);
  const focus = useCallback(
    (event: FocusEvent<HTMLElement>) =>
      setFocused(
        event.target instanceof HTMLElement &&
          event.target.matches(":focus-visible"),
      ),
    [],
  );
  const key = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.matches(":focus-visible")
    )
      setFocused(true);
  }, []);
  const blur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (
      event.relatedTarget instanceof globalThis.Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    setFocused(false);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    visible: hovered || focused,
    events: {
      onMouseEnter: enter,
      onMouseLeave: leave,
      onFocusCapture: focus,
      onKeyDownCapture: key,
      onBlurCapture: blur,
    },
  };
}
