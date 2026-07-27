import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: "supabase",
                            priority: 2,
                            test: /node_modules[\\/]@supabase/u,
                        },
                        {
                            name: "react",
                            priority: 1,
                            test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
                        },
                    ],
                },
            },
        },
    },
    envDir: "../../",
    plugins: [
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
