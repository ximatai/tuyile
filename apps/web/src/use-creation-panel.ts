import { useCallback, useEffect, useRef, useState } from "react";

/** Only pinning is durable; hovering and temporary editing stay local to this view. */
export function useCreationPanel() {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem("tuyile.creation-panel-pinned") !== "false";
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(pinned);
  const [engaged, setEngaged] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => clear, [clear]);
  useEffect(() => {
    try {
      localStorage.setItem("tuyile.creation-panel-pinned", String(pinned));
    } catch {
      /* UI preferences are best effort. */
    }
  }, [pinned]);
  const show = useCallback(() => {
    clear();
    setEngaged(true);
    setOpen(true);
  }, [clear]);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
    setEngaged(false);
  }, [clear]);
  const engage = useCallback(() => {
    clear();
    setEngaged(true);
  }, [clear]);
  function togglePin() {
    clear();
    setPinned(!pinned);
    setOpen(true);
    setEngaged(true);
  }
  function toggle() {
    if (open) hide();
    else show();
  }
  function hoverStart(onOpen?: () => void) {
    clear();
    if (!pinned && (!open || !engaged))
      timer.current = setTimeout(() => {
        onOpen?.();
        setOpen(true);
        setEngaged(false);
      }, 300);
  }
  function hoverEnd() {
    clear();
    if (!pinned && !engaged) timer.current = setTimeout(hide, 200);
  }
  return {
    pinned,
    engaged,
    collapsed: !open,
    show,
    hide,
    engage,
    togglePin,
    toggle,
    hoverStart,
    cancelHover: clear,
    hoverEnd,
  };
}
