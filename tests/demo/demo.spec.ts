import { expect, test } from "@playwright/test";

test("shows the Horizon app shell and sample-data screens without external requests", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  const appOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  page.context().on("request", (request) => {
    if (new URL(request.url()).origin !== appOrigin) externalRequests.push(request.url());
  });

  await page.goto("/");
  await expect(page).toHaveURL(`${appOrigin}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Horizon" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New entry" })).toBeVisible();
  await expect(page.getByText("Total wealth")).toBeVisible();
  await expect(page.getByText("Value over time")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("demo-overview.png") });

  await page.getByRole("link", { name: "Positions" }).first().click();
  await expect(page).toHaveURL(/\/positions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Positions" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Securities and other instruments" })).toBeVisible();

  await page.getByRole("link", { name: "Transactions" }).first().click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Long-term savings" }).first()).toBeVisible();

  for (const [path, title] of [
    ["/accounts", "Accounts"],
    ["/instruments", "Instruments"],
    ["/prices", "Prices and FX rates"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("This preview uses fictional data and is read-only.")).toBeVisible();
  }

  expect(await page.context().cookies()).toEqual([]);

  await page.context().addCookies([{ name: "horizon_ccy", value: "EUR", url: appOrigin }]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "EUR" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page).toHaveURL(`${appOrigin}/`);
  expect(await page.context().cookies()).toEqual([]);
  await page.reload();
  await expect(page.getByRole("button", { name: "HUF" })).toHaveAttribute("aria-pressed", "true");

  const blockedWrite = await page.request.post(`${appOrigin}/transactions`, { data: { kind: "buy" } });
  expect(blockedWrite.status()).toBe(405);
  expect(externalRequests).toEqual([]);
});
