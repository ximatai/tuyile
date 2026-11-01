import { test } from "@playwright/test";
import { loginAdmin } from "./admin-session";
import {
  verifyProjectSidebar,
  verifyTextControls,
  verifyDirectTextCreation,
  verifyAgentTextCreation,
} from "../text-browser-flow";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAdmin(page);
});

for (const [name, verify] of [
  ["project sidebar keeps long names readable", verifyProjectSidebar],
  ["text palette and edge toolbar placement", verifyTextControls],
  [
    "direct text references, editing, lineage and immutable outputs",
    verifyDirectTextCreation,
  ],
  [
    "Agent text references reject stale previews and freeze confirmation inputs",
    verifyAgentTextCreation,
  ],
] as const) {
  test(name, async ({ page }) => verify(page));
}
