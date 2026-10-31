import {
  styleInput,
  type StyleInput,
  type SavedStyle,
  promptPickerQuery,
  type PromptPickerQuery,
  type PromptPickerItem,
  favoriteInput,
  promptTemplateInput,
  promptCategoryFilter,
  type PromptTemplateInput,
  type ManagedPromptTemplate,
  type Principal,
  type FavoriteInput,
  type Favorite,
  type GalleryAsset,
  type AssetReference,
  type PromptTemplate,
} from "@tuyile/contracts";
export interface LibraryRepository {
  pickerItems(
    p: Principal,
    input: PromptPickerQuery,
  ): Promise<PromptPickerItem[]>;
  pickerGroups(
    p: Principal,
    source: PromptPickerQuery["source"],
  ): Promise<string[]>;
  styles(p: Principal, managed: boolean): Promise<SavedStyle[]>;
  saveStyle(
    p: Principal,
    input: StyleInput,
    shared: boolean,
  ): Promise<SavedStyle>;
  removeStyle(p: Principal, id: string, revision: number): Promise<void>;
  prompts(
    p: Principal,
    offset: number,
    categories: string[],
  ): Promise<PromptTemplate[]>;
  promptCategories(p: Principal): Promise<string[]>;
  managedPrompts(
    p: Principal,
    offset: number,
    search: string,
  ): Promise<ManagedPromptTemplate[]>;
  savePrompt(
    p: Principal,
    input: PromptTemplateInput,
  ): Promise<ManagedPromptTemplate>;

  assets(p: Principal, offset: number): Promise<GalleryAsset[]>;
  favorites(
    p: Principal,
    offset: number,
    group?: string | string[],
  ): Promise<Favorite[]>;
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
export class LibraryService {
  constructor(private readonly store: LibraryStore) {}
  promptPicker(p: Principal, input: PromptPickerQuery) {
    const parsed = promptPickerQuery.parse(input);
    return this.store.read(async (r) => {
      const rows = await r.pickerItems(p, parsed);
      return {
        items: rows.slice(0, 50),
        hasMore: rows.length > 50,
        groups: await r.pickerGroups(p, parsed.source),
      };
    });
  }
  styles(p: Principal, managed = false) {
    return this.store.read((r) => r.styles(p, managed));
  }
  saveStyle(p: Principal, input: StyleInput, shared = false) {
    const parsed = styleInput.parse(input);
    return this.store.write(p.id, (r) => r.saveStyle(p, parsed, shared));
  }
  removeStyle(p: Principal, id: string, revision: number) {
    return this.store.write(p.id, (r) => r.removeStyle(p, id, revision));
  }
  prompts(p: Principal, offset = 0, categories: string[] = []) {
    const parsed = promptCategoryFilter.parse(categories);
    return this.store.read((r) => r.prompts(p, offset, parsed));
  }
  promptPage(p: Principal, offset = 0, categories: string[] = []) {
    const parsed = promptCategoryFilter.parse(categories);
    return this.store.read(async (r) => {
      const rows = await r.prompts(p, offset, parsed);
      return {
        prompts: rows.slice(0, 50),
        hasMore: rows.length > 50,
        categories: await r.promptCategories(p),
      };
    });
  }
  managedPrompts(p: Principal, offset = 0, search = "") {
    return this.store.read((r) => r.managedPrompts(p, offset, search));
  }
  savePrompt(p: Principal, input: PromptTemplateInput) {
    const parsed = promptTemplateInput.parse(input);
    return this.store.write(p.id, (r) => r.savePrompt(p, parsed));
  }
  assets(p: Principal, offset = 0) {
    return this.store.read((r) => r.assets(p, offset));
  }
  favorites(p: Principal, offset = 0, group?: string | string[]) {
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
