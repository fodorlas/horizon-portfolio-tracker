import { expect, test } from "@playwright/test";

test("opens the English sample portfolio, records a trade, resets, and makes no external requests", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  const appOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  page.context().on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin) externalRequests.push(request.url());
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Interactive portfolio demo" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Sample prices").first()).toBeVisible();

  const language = page.locator("#demo-language");
  await language.selectOption("hu");
  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "hu");
  await language.selectOption("en");
  expect(await page.context().cookies()).toEqual([]);
  const secondTab = await page.context().newPage();
  await secondTab.goto("/");
  await expect(secondTab.locator("html")).toHaveAttribute("lang", "en");
  await secondTab.close();

  const total = page.getByTestId("portfolio-value");
  const cash = page.getByTestId("cash-value");
  const startingTotal = await total.textContent();
  const startingCash = await cash.textContent();
  await page.screenshot({ path: testInfo.outputPath("demo-dashboard.png") });

  await page.setViewportSize({ width: 900, height: 1200 });
  await page.getByLabel("Units (OTP)").fill("2");
  await page.getByLabel("Trade price (HUF)").fill("34000");
  await page.getByRole("heading", { level: 2, name: "Record a trade" }).locator("xpath=../..").screenshot({ path: testInfo.outputPath("demo-trade-form.png") });
  await page.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByRole("status")).toHaveText("Trade added to this demo session.");
  await expect(total).not.toHaveText(startingTotal ?? "");
  await expect(cash).not.toHaveText(startingCash ?? "");

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(total).toHaveText(startingTotal ?? "");
  await expect(cash).toHaveText(startingCash ?? "");
  await page.reload();
  await expect(total).toHaveText(startingTotal ?? "");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(externalRequests).toEqual([]);
});
