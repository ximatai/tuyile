import { expect, type Page } from "@playwright/test";
/** Use the published fake planner once the catalog owns configuration. */
export async function ensureTestPlanner(page: Page, legacyModel: string) {
  const origin = new URL(page.url()).origin;
  if (!["http://127.0.0.1:5180", "http://127.0.0.1:8792"].includes(origin))
    throw new Error("REFUSE_NON_SYNTHETIC_PLANNER_TARGET");
  const catalogResponse = await page.request.get(
    origin + "/api/model-admin/catalog",
  );
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json();
  if (catalog.managed) {
    const planner = catalog.entries.find(
      (entry: any) =>
        entry.kind === "conversation" && entry.enabled && entry.isDefault,
    );
    expect(planner, "published default planner").toBeTruthy();
    expect(
      catalog.services.find((service: any) => service.id === planner.serviceId)
        ?.mode,
    ).toBe("fake");
    return planner.id as string;
  }
  const session = await (
    await page.request.get(origin + "/api/auth/me")
  ).json();
  const configured = await page.request.post(
    origin + "/api/image-admin/planning-providers",
    {
      headers: { Origin: origin, "X-CSRF-Token": session.csrfToken },
      data: { mode: "fake", baseUrl: "", model: legacyModel },
    },
  );
  expect(configured.ok()).toBe(true);
  return undefined;
}
