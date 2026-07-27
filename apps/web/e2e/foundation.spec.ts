import { expect, test } from "@playwright/test";

test("renders the SmartService foundation shell", async ({ page }) =>
{
    await page.goto("/");

    await expect(page).toHaveTitle("SmartService");
    await expect(page.getByRole("heading", { name: "Sign in to SmartService" })).toBeVisible();
    await expect(page.getByText("Tenant isolated")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("renders the responsive public customer chat and evidence panel", async ({ page }) =>
{
    await page.goto("/chat");

    await expect(page.getByRole("heading", { name: "NovaFlow Support" })).toBeVisible();
    await expect(page.getByText("AI ready · AI 已就绪")).toBeVisible();
    await expect(page.getByLabel("Ask NovaFlow support")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supporting source" })).toBeVisible();

    await page.setViewportSize({
        height: 844,
        width: 390,
    });
    const horizontalOverflow = await page.evaluate(() =>
    {
        return document.documentElement.scrollWidth
            - document.documentElement.clientWidth;
    });

    expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
