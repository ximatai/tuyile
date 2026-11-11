import sharp from "sharp";
import type { CanvasNode, CanvasSnapshot } from "@tuyile/contracts";
import { AppError } from "@tuyile/core";

export interface CanvasPreviewRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const maxEdge = 1200;
const maxThumbnails = 32;
const maxThumbnailEdge = 256;
let activePreviews = 0;

const noteColors = {
  plain: "#ffffff",
  yellow: "#fff6d6",
  blue: "#e8f2ff",
  green: "#e9f8ed",
  pink: "#ffeef4",
};

function overview(nodes: CanvasNode[]): CanvasPreviewRegion {
  if (!nodes.length) return { x: 0, y: 0, width: 640, height: 360 };
  const x = Math.min(...nodes.map((node) => node.x)) - 24;
  const y =
    Math.min(
      ...nodes.map((node) => node.y - (node.kind === "group" ? 18 : 0)),
    ) - 24;
  return {
    x,
    y,
    width: Math.max(...nodes.map((node) => node.x + node.width)) + 24 - x,
    height: Math.max(...nodes.map((node) => node.y + node.height)) + 24 - y,
  };
}

function visibleArea(box: CanvasPreviewRegion, width: number, height: number) {
  const visibleWidth = Math.min(width, box.x + box.width) - Math.max(0, box.x);
  const visibleHeight =
    Math.min(height, box.y + box.height) - Math.max(0, box.y);
  return Math.max(0, visibleWidth) * Math.max(0, visibleHeight);
}

function xml(text: string) {
  return text
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,
      "",
    )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function label(
  text: string,
  x: number,
  y: number,
  width: number,
  font: number,
  bold = false,
) {
  const maxChars = Math.floor(width / font);
  if (maxChars < 2 || !text) return "";
  const chars = Array.from(text.replace(/\s+/g, " "));
  const value =
    chars.length > maxChars
      ? chars.slice(0, maxChars - 1).join("") + "…"
      : chars.join("");
  return `<text x="${x}" y="${y}" font-size="${font}" font-weight="${bold ? 600 : 400}">${xml(value)}</text>`;
}

function drawNode(
  node: CanvasNode,
  box: CanvasPreviewRegion,
  thumbnail?: string,
) {
  const { x, y, width, height } = box;
  const shape = (fill: string, stroke: string) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(5, width / 4, height / 4)}" fill="${fill}" stroke="${stroke}"/>`;
  if (node.kind === "group") {
    return (
      shape("#e8f0fc", "#9bb8e3") +
      label(node.label, x + 4, y - 4, width - 8, 12, true)
    );
  }
  if (node.kind === "image") {
    if (!thumbnail) return shape("#dce6f3", "#aabdd8");
    return (
      shape("#ffffff", "#c0d0e5") +
      `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/jpeg;base64,${thumbnail}"/>`
    );
  }
  const fill = noteColors[node.tone ?? "plain"];
  const title =
    height >= 25 ? label(node.label, x + 7, y + 17, width - 14, 13, true) : "";
  const charsPerLine = Math.floor((width - 14) / 12);
  const lines: string[] = [];
  const chars = Array.from((node.text ?? "").slice(0, 320));
  if (charsPerLine >= 2) {
    const maxLines = Math.min(4, Math.floor((height - 23) / 15));
    for (let start = 0; start < chars.length && lines.length < maxLines;) {
      const remaining = chars.slice(start, start + charsPerLine);
      const newline = remaining.indexOf("\n");
      const line = newline < 0 ? remaining : remaining.slice(0, newline);
      start += newline < 0 ? remaining.length : newline + 1;
      const more = lines.length === maxLines - 1 && start < chars.length;
      lines.push(
        label(
          more ? line.slice(0, -1).join("") + "…" : line.join(""),
          x + 7,
          y + 34 + lines.length * 15,
          width - 14,
          12,
        ),
      );
    }
  }
  return shape(fill, "#aabdd8") + title + lines.join("");
}

/** Render a bounded, private snapshot. Only generated markup and re-encoded raster data reach sharp. */
export async function renderCanvasPreview(
  loadSnapshot: () => Promise<CanvasSnapshot>,
  region: CanvasPreviewRegion | undefined,
  loadPreview: (assetId: string) => Promise<Uint8Array>,
) {
  if (activePreviews >= 2) throw new AppError("CANVAS_PREVIEW_BUSY", 503);
  activePreviews++;
  try {
    const snapshot = await loadSnapshot();
    const bounds = region ?? overview(snapshot.document.nodes);
    const scale = maxEdge / Math.max(bounds.width, bounds.height);
    const cropWidth = bounds.width * scale;
    const cropHeight = bounds.height * scale;
    const width = Math.min(maxEdge, Math.ceil(cropWidth));
    const height = Math.min(maxEdge, Math.ceil(cropHeight));
    const nodes = snapshot.document.nodes
      .map((node) => {
        const box = {
          x: (node.x - bounds.x) * scale,
          y: (node.y - bounds.y) * scale,
          width: node.width * scale,
          height: node.height * scale,
        };
        return { node, box, area: visibleArea(box, cropWidth, cropHeight) };
      })
      .filter(({ area }) => area > 0);
    const imageNodes = nodes.filter(({ node }) => node.kind === "image");
    const thumbnails = new Map<string, string>();
    const candidates = imageNodes
      .filter(({ area }) => area >= 36)
      .sort((a, b) => b.area - a.area)
      .slice(0, maxThumbnails);
    for (const { node } of candidates) {
      try {
        const preview = await loadPreview(node.assetId!);
        const bytes = await sharp(preview, { limitInputPixels: 1024 * 1024 })
          .resize(maxThumbnailEdge, maxThumbnailEdge, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 75 })
          .toBuffer();
        thumbnails.set(node.id, bytes.toString("base64"));
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
      }
    }
    const groups = nodes.filter(({ node }) => node.kind === "group");
    const foreground = nodes.filter(({ node }) => node.kind !== "group");
    const elements = [...groups, ...foreground]
      .map(({ node, box }) => drawNode(node, box, thumbnails.get(node.id)))
      .join("");
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}">
      <defs><clipPath id="crop"><rect width="${cropWidth}" height="${cropHeight}"/></clipPath></defs>
      <rect width="100%" height="100%" fill="#f4f7fc"/>
      <g clip-path="url(#crop)" fill="#233754" font-family="Noto Sans CJK SC, sans-serif">${elements}</g>
    </svg>`;
    const bytes = await sharp(Buffer.from(markup), {
      limitInputPixels: maxEdge * maxEdge,
    })
      .webp({ quality: 82 })
      .toBuffer();
    return {
      bytes,
      revision: snapshot.revision,
      bounds,
      width,
      height,
      visibleNodes: nodes.length,
      imagePlaceholders: imageNodes.length - thumbnails.size,
    };
  } finally {
    activePreviews--;
  }
}
