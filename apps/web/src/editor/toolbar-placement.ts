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
  } = input;
  const right = (x + width) * viewport.zoom + viewport.x;
  const left = right - 8 - toolbarWidth;
  const top = y * viewport.zoom + viewport.y;
  const bottom = top + height * viewport.zoom;
  // Both card kinds prefer the lower-right outside corner; flip above at the bottom edge.
  const preferredTop = bottom + 8;
  const desiredTop =
    preferredTop + 28 > canvasHeight - 8 && top - 36 >= 8
      ? top - 36
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
    offset: toolbarTop - bottom,
  };
}
