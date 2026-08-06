import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * readDemoAdminCredentials
 * ----------------
 * Reads the fictional local Admin identity from ignored configuration without logging or attaching either value.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Playwright Flow
 */
async function readDemoAdminCredentials(): Promise<{
    email: string;
    password: string;
}>
{
    const text = await readFile(resolve("../../.env.local"), "utf8");
    const email = /^DEMO_ADMIN_EMAIL=(.+)$/mu.exec(text)?.[1]?.trim();
    const password = /^DEMO_ADMIN_PASSWORD=(.+)$/mu.exec(text)?.[1]?.trim();

    if (email === undefined || password === undefined)
    {
        throw new Error("The ignored fictional Admin credentials are not configured.");
    }

    return {
        email,
        password,
    };
}

test("renders the Smart Service foundation shell", async ({ page }) =>
{
    await page.goto("/");

    await expect(page).toHaveTitle("Smart Service");
    await expect(page.getByRole("heading", { name: /Sign in to Smart Service/u })).toBeVisible();
    await expect(page.getByText(/Tenant isolated/u)).toBeVisible();
    await expect(page.getByRole("button", { name: /Sign in/u })).toBeVisible();
});

test("renders the responsive public customer chat and evidence panel", async ({ page }) =>
{
    await page.goto("/chat");

    await expect(page.getByRole("heading", { name: /Smart Service Customer Service/u })).toBeVisible();
    await expect(page.getByText("Customer service online")).toBeVisible();
    await expect(page.getByLabel(/Ask Smart Service customer service/u)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Supporting source/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ask a support specialist/u })).toHaveCount(0);
    await page.getByRole("button", { name: "中文" }).click();
    await expect(page.getByText("在线客服").nth(1)).toBeVisible();
    await expect(page.getByLabel(/咨询 Smart Service 在线客服/u)).toBeVisible();
    await expect(page.getByRole("heading", { name: /引用来源/u })).toBeVisible();
    await expect(page.getByText("Customer service online")).toHaveCount(0);

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

test("never asks the browser reporter to enter an update email", async ({ page }) =>
{
    await page.route("**/api/public-config", async (route) =>
    {
        await route.fulfill({
            body: JSON.stringify({
                feedbackInstallationKey: `hxf_live_${"a".repeat(48)}`,
                feedbackTurnstileSiteKey: "0x4AAAAAA-feedback-browser-test",
            }),
            contentType: "application/json",
            status: 200,
        });
    });

    await page.goto("/chat");
    const feedback = page.locator("hellox-feedback");
    await feedback.locator("[data-action='open']").click();

    const anonymous = feedback.locator("[data-role='anonymous']");
    await expect(anonymous).toBeChecked();
    await anonymous.uncheck();

    await expect(feedback.locator("[data-role='email']")).toHaveCount(0);
    await expect(feedback).not.toContainText("Email for updates");
});

test("keeps the Feedback launcher discoverable before compacting it", async ({ page }) =>
{
    await page.route("**/api/public-config", async (route) =>
    {
        await route.fulfill({
            body: JSON.stringify({
                feedbackInstallationKey: `hxf_live_${"a".repeat(48)}`,
                feedbackTurnstileSiteKey: "0x4AAAAAA-feedback-browser-test",
            }),
            contentType: "application/json",
            status: 200,
        });
    });

    await page.goto("/chat");
    const feedback = page.locator("hellox-feedback");
    await feedback.evaluate((node) =>
    {
        const widget = node as HTMLElement & {
            config: Record<string, unknown>;
        };
        widget.config = {
            ...widget.config,
            launcherCollapseDelayMs: 100,
            launcherInitialCollapseDelayMs: 100,
        };
    });

    const launcher = feedback.locator("[data-action='open']");
    await expect(launcher).toHaveAttribute("aria-label", "Feedback");
    await expect(launcher).toHaveAttribute("data-label-expanded", "true");
    await expect(launcher).toHaveAttribute("data-label-expanded", "false");

    await launcher.hover();
    await expect(launcher).toHaveAttribute("data-label-expanded", "true");
    await page.mouse.move(8, 8);
    await expect(launcher).toHaveAttribute("data-label-expanded", "false");

    await launcher.focus();
    await expect(launcher).toHaveAttribute("data-label-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(launcher).toHaveAttribute("data-label-expanded", "false");

    await launcher.hover();
    await launcher.click();
    await feedback.locator("[data-action='minimize']").click();
    const activeLauncher = feedback.locator("[data-action='open']");
    await page.waitForTimeout(300);
    await expect(activeLauncher).toHaveAttribute("data-label-expanded", "true");
    await expect(activeLauncher).toContainText("Continue marking");
});

test("starts voice only after click and falls back cleanly when microphone is denied", async ({ page }) =>
{
    const conversationId = "20000000-0000-4000-a000-000000000006";
    const voiceSessionId = "60000000-0000-4000-a000-000000000006";
    let startupRequests = 0;

    await page.addInitScript(() =>
    {
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                /**
                 * getUserMedia
                 * ----------------
                 * Reproduces a deterministic customer permission denial without opening a real microphone in CI.
                 *
                 * July 27, 2026: Created by Forrest Zhang for SmartService Day 6 Browser Verification
                 */
                getUserMedia: async () =>
                {
                    throw new DOMException("Permission denied", "NotAllowedError");
                },
            },
        });
    });
    await page.route("**/api/v1/public/conversations", async (route) =>
    {
        startupRequests += 1;
        await route.fulfill({
            body: JSON.stringify({
                conversationId,
                conversationToken: "x".repeat(32),
                displayName: "Smart Service",
                expiresAt: "2099-07-27T08:00:00.000Z",
                welcomeMessage: "Hello! You’ve reached Smart Service customer service. How can I help today?",
            }),
            contentType: "application/json",
            status: 201,
        });
    });
    await page.route("**/api/v1/public/voice/token", async (route) =>
    {
        startupRequests += 1;
        await route.fulfill({
            body: JSON.stringify({
                agentName: "smartservice-voice-agent",
                expiresAt: "2099-07-27T08:10:00.000Z",
                provider: "mock",
                roomName: "ss-day6-browser",
                token: "mock.browser-token.signature",
                url: "https://mock-livekit.smartservice.local",
                voiceSessionId,
            }),
            contentType: "application/json",
            status: 201,
        });
    });
    await page.route(`**/api/v1/public/conversations/${conversationId}/messages?**`, async (route) =>
    {
        await route.fulfill({
            body: "",
            headers: {
                etag: 'W/"day7-voice-empty"',
            },
            status: 304,
        });
    });

    await page.goto("/voice");
    await expect(page.getByRole("heading", {
        name: /Talk when the agent is Ready/u,
    })).toBeVisible();
    expect(startupRequests).toBe(0);

    await page.getByRole("button", { name: /Start voice/u }).click();

    await expect(page.getByText(/Microphone access was denied/u)).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue by text/u })).toHaveAttribute("href", "/chat");
    expect(startupRequests).toBe(2);
});

test("runs the authenticated dashboard and one-click gap repair flow", async ({ page }) =>
{
    test.setTimeout(60_000);

    const gapId = "70000000-0000-4000-a000-000000000001";
    const sourceId = "40000000-0000-4000-a000-000000000001";
    const timestamp = "2026-07-26T12:00:00.000Z";
    let resolved = false;

    await page.route("**/api/v1/admin/conversations**", async (route) =>
    {
        await route.fulfill({
            body: JSON.stringify({
                conversations: [],
            }),
            contentType: "application/json",
            status: 200,
        });
    });
    await page.route("**/api/v1/admin/dashboard/summary?**", async (route) =>
    {
        await route.fulfill({
            body: JSON.stringify({
                aiContainedConversations: 3,
                aiContainmentRate: 0.75,
                from: "2026-07-01T00:00:00.000Z",
                handedOffConversations: 1,
                handoffRate: 0.25,
                openKnowledgeGapCount: resolved ? 0 : 1,
                to: "2026-08-01T00:00:00.000Z",
                totalConversations: 4,
            }),
            contentType: "application/json",
            status: 200,
        });
    });
    await page.route("**/api/v1/admin/knowledge-gaps**", async (route) =>
    {
        const url = new URL(route.request().url());
        const suffix = url.pathname.split("/knowledge-gaps")[1] ?? "";
        const gap = {
            createdAt: timestamp,
            exampleQuestion: "What is the diagnostic coverage window?",
            firstConversationId: "20000000-0000-4000-a000-000000000001",
            id: gapId,
            lastSeenAt: timestamp,
            normalizedQuestion: "what is the diagnostic coverage window",
            occurrenceCount: 2,
            reason: "No sufficiently relevant approved evidence was retrieved.",
            resolutionSource: resolved
                ? {
                    chunkCount: 1,
                    id: sourceId,
                    name: "Diagnostic coverage",
                    status: "ready",
                }
                : null,
            status: resolved ? "resolved" : "open",
            updatedAt: timestamp,
        };

        if (suffix === "" && route.request().method() === "GET")
        {
            await route.fulfill({
                body: JSON.stringify({
                    gaps: [gap],
                }),
                contentType: "application/json",
                status: 200,
            });
            return;
        }

        if (suffix === `/${gapId}` && route.request().method() === "GET")
        {
            await route.fulfill({
                body: JSON.stringify(gap),
                contentType: "application/json",
                status: 200,
            });
            return;
        }

        if (suffix === `/${gapId}/resolve`)
        {
            resolved = true;
            await route.fulfill({
                body: JSON.stringify({
                    gapId,
                    jobId: "50000000-0000-4000-a000-000000000001",
                    sourceId,
                    status: "uploaded",
                }),
                contentType: "application/json",
                status: 202,
            });
            return;
        }

        if (suffix === `/${gapId}/retest`)
        {
            await route.fulfill({
                body: JSON.stringify({
                    answer: "The approved diagnostic coverage window is 14 days.",
                    citations: [{
                        citationId: "80000000-0000-4000-a000-000000000001",
                        label: "Diagnostic coverage",
                        sourceType: "manual",
                        sourceUrl: null,
                        supportingExcerpt: "Answer: The approved diagnostic coverage window is 14 days.",
                    }],
                    decision: "answer",
                    gapId,
                    testedAt: timestamp,
                }),
                contentType: "application/json",
                status: 200,
            });
            return;
        }

        await route.fulfill({
            body: JSON.stringify({
                error: {
                    code: "NOT_FOUND",
                    message: "Unmatched Day 5 fixture route.",
                },
            }),
            contentType: "application/json",
            status: 404,
        });
    });

    const credentials = await readDemoAdminCredentials();
    await page.goto("/");
    await page.getByLabel(/Email/u).fill(credentials.email);
    await page.getByLabel(/Password/u).fill(credentials.password);
    await page.getByRole("button", { name: /Sign in/u }).click();
    await page.getByRole("link", { name: /Dashboard/u }).click();

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("75%").first()).toBeVisible();
    await page.getByRole("button", { name: "Review knowledge gaps" }).click();
    await page.getByRole("button", {
        name: /what is the diagnostic coverage window/iu,
    }).click();

    await page.getByLabel("Knowledge title").fill("Diagnostic coverage");
    await page.getByLabel("Approved answer").fill(
        "The approved diagnostic coverage window is 14 days.",
    );
    await page.getByRole("button", { name: "Create and embed knowledge" }).click();
    await page.getByRole("button", { name: "Re-test original question" }).click();

    await expect(page.getByText(
        "The approved diagnostic coverage window is 14 days.",
        {
            exact: true,
        },
    ))
        .toBeVisible();
    await expect(page.getByText(
        "Answer: The approved diagnostic coverage window is 14 days.",
        {
            exact: true,
        },
    ))
        .toBeVisible();
});
