import { createApp } from "./app";
import { handleIngestionQueue } from "./queue";
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
     * Dispatches Cloudflare Queue batches through the tenant-reconciling ingestion consumer.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    async queue(batch: MessageBatch<unknown>, env: SmartServiceBindings): Promise<void>
    {
        await handleIngestionQueue(batch, env);
    },
} satisfies ExportedHandler<SmartServiceBindings>;
