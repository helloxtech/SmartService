import { expect, test } from "@playwright/test";

test("renders the SmartService foundation shell", async ({ page }) =>
{
    await page.goto("/");

    await expect(page).toHaveTitle("SmartService");
    await expect(page.getByRole("heading", { name: "Sign in to SmartService" })).toBeVisible();
    await expect(page.getByText("Tenant isolated")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
