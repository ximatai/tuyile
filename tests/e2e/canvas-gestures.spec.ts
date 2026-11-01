import { test } from "@playwright/test";
import { loginAdmin } from "./admin-session";
import { verifyCanvasGestures } from "../canvas-gesture-flow";
test("trackpad pinch passes through text while native long-copy scrolling stays local", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAdmin(page);
  await verifyCanvasGestures(page);
});
