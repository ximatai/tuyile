/** Screen-space positioning for React Flow's unscaled, 28px-high node actions. */
export function toolbarPlacement(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport: { x: number; y: number; zoom: number };
  canvasWidth: number;
  canvasHeight: number;
  toolbarWidth: number;
  outside?: boolean;
}) {
  const {
    x,
    y,
    width,
    height,
    viewport,
    canvasWidth,
    canvasHeight,
    toolbarWidth,
    outside,
  } = input;
  const right = (x + width) * viewport.zoom + viewport.x;
  const left = right - 8 - toolbarWidth;
  const top = y * viewport.zoom + viewport.y;
  const bottom = top + height * viewport.zoom;
  const preferredTop = outside ? top - 36 : top + 8;
  // Prefer below the note when its header touches the top, keeping its palette clear.
  const desiredTop =
    outside && preferredTop < 8 && bottom + 36 <= canvasHeight
      ? bottom + 8
      : preferredTop;
  const toolbarTop = Math.max(8, Math.min(desiredTop, canvasHeight - 36));
  return {
    onScreen:
      right > 0 &&
      right - width * viewport.zoom < canvasWidth &&
      bottom > 0 &&
      top < canvasHeight,
    horizontalInset:
      -8 + Math.max(0, 8 - left) - Math.max(0, right - 8 - (canvasWidth - 8)),
    offset: top - 28 - toolbarTop,
  };
}
