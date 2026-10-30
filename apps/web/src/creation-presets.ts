// Interaction and preset geometry adapted from GPT Image Canvas (MIT); see THIRD_PARTY_NOTICES.md.
export const promptExamples = [
  {
    label: "产品海报",
    prompt:
      "为一款产品设计高端商业海报，突出产品主体，精致布光、简洁背景，预留清晰的标题空间。",
  },
  {
    label: "室内空间",
    prompt:
      "一间安静的现代工作室，清晨自然光透过窗户，木质家具与绿植，干净构图，真实空间摄影。",
  },
  {
    label: "角色头像",
    prompt:
      "一个原创角色头像，温暖自然的表情，清爽背景，细腻插画质感，突出人物个性。",
  },
  {
    label: "城市夜景",
    prompt:
      "未来城市的雨后夜景，街道倒映霓虹，富有层次的建筑与灯光，电影感构图。",
  },
];
export const stylePresets = [
  { id: "none", label: "无风格", text: "" },
  {
    id: "photo",
    label: "真实摄影",
    text: "真实摄影，自然光线，细腻材质，准确的光影与丰富细节。",
  },
  {
    id: "product",
    label: "商业产品",
    text: "高端商业产品摄影，精致棚拍布光，主体清晰，构图简洁。",
  },
  {
    id: "illustration",
    label: "精致插画",
    text: "专业编辑插画，清晰造型，丰富而协调的配色，精致完成度。",
  },
  {
    id: "poster",
    label: "海报视觉",
    text: "鲜明的海报构图，突出视觉焦点，预留排版空间，电影感配色。",
  },
  {
    id: "avatar",
    label: "头像角色",
    text: "富有表现力的角色肖像，突出面部表情，干净背景，精致头像质感。",
  },
];
export function styleParagraph(id: string) {
  const text = stylePresets.find((s) => s.id === id)?.text;
  return text ? `画面风格：${text}` : "";
}
export function applyStyle(prompt: string, previous: string, next: string) {
  const previousBlock = styleParagraph(previous),
    nextBlock = styleParagraph(next);
  const blocks = prompt
    .split("\n\n")
    .filter((block) => !previousBlock || block !== previousBlock);
  const text = blocks.join("\n\n").trimEnd();
  if (!nextBlock || blocks.includes(nextBlock)) return text;
  return `${text}${text ? "\n\n" : ""}${nextBlock}`;
}
export interface SizePreset {
  tier: string;
  ratio: string;
  width: number;
  height: number;
}
const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const tierSizes: [string, [number, number][]][] = [
  [
    "1K",
    [
      [1024, 1024],
      [1824, 1024],
      [1024, 1824],
      [1360, 1024],
      [1024, 1360],
      [1536, 1024],
      [1024, 1536],
    ],
  ],
  [
    "2K",
    [
      [2048, 2048],
      [2048, 1152],
      [1152, 2048],
      [2048, 1536],
      [1536, 2048],
      [2016, 1344],
      [1344, 2016],
    ],
  ],
  [
    "4K",
    [
      [2880, 2880],
      [3840, 2160],
      [2160, 3840],
      [2880, 2160],
      [2160, 2880],
      [3264, 2176],
      [2176, 3264],
    ],
  ],
];
export const standardSizes: SizePreset[] = tierSizes.flatMap(([tier, sizes]) =>
  sizes.map(([width, height], i) => ({
    tier,
    ratio: ratios[i]!,
    width,
    height,
  })),
);
