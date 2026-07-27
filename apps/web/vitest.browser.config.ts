import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    envDir: "../../",
    plugins: [
        react(),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        browser: {
            enabled: true,
            headless: true,
            instances: [{
                browser: "chromium",
            }],
            provider: playwright(),
        },
        include: ["src/**/*.browser.test.ts"],
    },
});
