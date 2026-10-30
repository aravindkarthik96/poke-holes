import { test, expect } from "@playwright/test";
import { plate } from "../fixture.js";
import { parseSTL } from "../../src/mesh.js";
import fs from "node:fs/promises";
test("import, shrink, enlarge, download, and reject an invalid diameter", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "test-plate.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(plate()),
  });
  await expect(page.locator(".hole")).toHaveCount(1);
  await page.locator(".hole input").check();
  await expect(page.locator("#export")).toBeEnabled();
  await expect(page.locator("#change-info")).toContainText("4.80 → 4.30");
  for (const direction of ["-1", "1"]) {
    await page.locator("#direction").selectOption(direction);
    await expect(page.locator("#export")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export").click(),
    ]);
    const bytes = await fs.readFile(await download.path());
    const model = parseSTL(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(model.holes).toHaveLength(1);
    expect(model.holes[0].diameter).toBeCloseTo(
      direction === "-1" ? 4.3 : 5.3,
      2,
    );
  }
  await page.locator("#direction").selectOption("-1");
  await page.locator("#reduction").fill("5");
  await expect(page.locator("#export")).toBeDisabled();
  await page.locator("#reduction").fill("0.5");
  await expect(page.locator("#export")).toBeEnabled();
  await page.locator("#clear").click();
  await expect(page.locator("#export")).toBeDisabled();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  // The generated fixture has a visible blue cylinder rim at this position
  // in the fixed 1440 × 1000 top view. Check real raycast selection too.
  const canvas = await page.locator("canvas").boundingBox();
  await page.mouse.click(
    canvas.x + canvas.width / 2 + 50,
    canvas.y + canvas.height / 2,
  );
  await expect(page.locator(".hole input")).toBeChecked();
  await expect(page.locator("#export")).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("shows invalid and unsupported STL states", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles({
    name: "bad.stl",
    mimeType: "model/stl",
    buffer: Buffer.from("invalid model data"),
  });
  await expect(page.locator("#status")).toContainText(
    "valid binary or ASCII STL",
  );
  await expect(page.locator("#export")).toBeDisabled();
  const stl =
    "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle";
  await page.locator("#file").setInputFiles({
    name: "triangle.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(stl),
  });
  await expect(page.locator("#status")).toContainText(
    "No complete cylindrical holes",
  );
});
