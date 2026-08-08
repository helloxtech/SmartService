import { defineConfig, devices } from "@playwright/test";

const previewPort = process.env.SMARTSERVICE_E2E_PORT ?? "4173";
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: "html",
    use: {
        baseURL: previewUrl,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${previewPort}`,
        reuseExistingServer: !process.env.CI && process.env.SMARTSERVICE_E2E_PORT === undefined,
        timeout: 120_000,
        url: previewUrl,
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
            },
        },
    ],
});
