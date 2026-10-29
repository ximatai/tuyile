import {
  favoriteInput,
  type Principal,
  type FavoriteInput,
  type Favorite,
  type GalleryAsset,
  type AssetReference,
  type PromptTemplate,
} from "@tuyile/contracts";
export interface LibraryRepository {
  assets(p: Principal, offset: number): Promise<GalleryAsset[]>;
  favorites(p: Principal, offset: number, group?: string): Promise<Favorite[]>;
  groups(p: Principal): Promise<string[]>;
  saveFavorite(p: Principal, input: FavoriteInput): Promise<Favorite>;
  removeFavorite(p: Principal, id: string): Promise<void>;
  references(p: Principal, assetId: string): Promise<AssetReference[]>;
}
export interface LibraryStore {
  read<T>(run: (r: LibraryRepository) => Promise<T>): Promise<T>;
  write<T>(
    owner: string,
    run: (r: LibraryRepository) => Promise<T>,
  ): Promise<T>;
}
// Original product templates: no remote assets, user content or executable instructions.
export const promptTemplates: readonly PromptTemplate[] = Object.freeze([
  {
    id: "product-studio",
    title: "简洁商品展示",
    category: "商品",
    prompt:
      "为参考商品设计简洁的棚拍展示图，保持主体形状、材质与标识，使用柔和侧光和干净背景。不要虚构商品功能或添加无关文字。",
  },
  {
    id: "brand-banner",
    title: "品牌宣传构图",
    category: "宣传",
    prompt:
      "设计一张主体突出、留白充足的品牌宣传图。先明确核心视觉与画面层次，在右侧预留标题区域；保持参考主体一致。",
  },
  {
    id: "illustration-scene",
    title: "叙事插画场景",
    category: "插画",
    prompt:
      "围绕我描述的主题创作叙事插画，明确主体动作、环境和光线，采用统一配色与清楚的前中后景。画面中不添加无关文字。",
  },
]);
export class LibraryService {
  constructor(private readonly store: LibraryStore) {}
  assets(p: Principal, offset = 0) {
    return this.store.read((r) => r.assets(p, offset));
  }
  favorites(p: Principal, offset = 0, group?: string) {
    return this.store.read((r) => r.favorites(p, offset, group));
  }
  groups(p: Principal) {
    return this.store.read((r) => r.groups(p));
  }
  saveFavorite(p: Principal, input: FavoriteInput) {
    const parsed = favoriteInput.parse(input);
    return this.store.write(p.id, (r) => r.saveFavorite(p, parsed));
  }
  removeFavorite(p: Principal, id: string) {
    return this.store.write(p.id, (r) => r.removeFavorite(p, id));
  }
  references(p: Principal, assetId: string) {
    return this.store.read((r) => r.references(p, assetId));
  }
}
