import { createApp } from "./app";
import { handleQueue } from "./queue";
import type { SmartServiceBindings } from "./types";

const app = createApp();

export default {
    /**
     * fetch
     * ----------------
     * Dispatches HTTP traffic through the validated Hono application.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    fetch: app.fetch,

    /**
     * queue
     * ----------------
     * Dispatches Cloudflare Queue batches through tenant-reconciling ingestion and finalization consumers.
     *
     * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Conversation Finalization
     */
    async queue(batch: MessageBatch<unknown>, env: SmartServiceBindings): Promise<void>
    {
        await handleQueue(batch, env);
    },
} satisfies ExportedHandler<SmartServiceBindings>;
