// Interaction and preset geometry adapted from GPT Image Canvas (MIT); see THIRD_PARTY_NOTICES.md.
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
export const standardSizes: SizePreset[] = [
  ...tierSizes.flatMap(([tier, sizes]) =>
    sizes.map(([width, height], i) => ({
      tier,
      ratio: ratios[i]!,
      width,
      height,
    })),
  ),
  { tier: "720p", ratio: "16:9", width: 1280, height: 720 },
  { tier: "720p", ratio: "9:16", width: 720, height: 1280 },
];
