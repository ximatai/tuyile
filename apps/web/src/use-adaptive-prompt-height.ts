import { useLayoutEffect, useState, type RefObject } from "react";

// Refit for viewport/panel resizing, not for reference uploads or expanded fields.
export function useAdaptivePromptHeight(
  formRef: RefObject<HTMLFormElement | null>,
  enabled: boolean,
) {
  const [height, setHeight] = useState(180);
  useLayoutEffect(() => {
    const form = formRef.current;
    const panel = form?.closest<HTMLElement>(".creation-panel");
    if (!form || !panel || !enabled) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const fields = form.querySelector("fieldset");
        const textarea = fields?.querySelector("textarea");
        const first = fields?.firstElementChild;
        const last = fields?.lastElementChild;
        const footer = form.lastElementChild;
        if (!fields || !textarea || !first || !last || !footer) return;
        const fieldBox = fields.getBoundingClientRect();
        const style = getComputedStyle(fields);
        const padding =
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const otherFields =
          last.getBoundingClientRect().bottom -
          first.getBoundingClientRect().top -
          textarea.getBoundingClientRect().height +
          padding;
        const outsideFields =
          fieldBox.top -
          form.getBoundingClientRect().top +
          footer.getBoundingClientRect().bottom -
          fieldBox.bottom;
        setHeight(
          Math.max(
            140,
            Math.min(
              280,
              Math.floor(form.clientHeight - outsideFields - otherFields),
            ),
          ),
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
    };
  }, [formRef, enabled]);
  return height;
}
