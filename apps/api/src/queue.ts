import { processIngestionMessage } from "@smartservice/ingestion";

import { createRuntimeServices } from "./services";
import type {
    RuntimeServiceFactory,
    SmartServiceBindings,
} from "./types";

/**
 * handleIngestionQueue
 * ----------------
 * Processes Queue messages sequentially, acknowledges success/duplicates, and schedules bounded retry handling on failure.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function handleIngestionQueue(
    batch: MessageBatch<unknown>,
    bindings: SmartServiceBindings,
    serviceFactory: RuntimeServiceFactory = createRuntimeServices,
): Promise<void>
{
    const services = serviceFactory(bindings);

    for (const message of batch.messages)
    {
        try
        {
            const result = await processIngestionMessage(message.body, {
                embeddings: services.embeddings,
                payloads: services.crawl,
                repository: services.repository,
            });
            message.ack();

            console.log(JSON.stringify({
                event: "ingestion.queue.completed",
                messageId: message.id,
                result,
            }));
        }
        catch (error: unknown)
        {
            const errorName = error instanceof Error ? error.name : "UnknownError";

            console.error(JSON.stringify({
                attempt: message.attempts,
                errorName,
                event: "ingestion.queue.failed",
                messageId: message.id,
            }));
            message.retry({
                delaySeconds: Math.min(30, 5 * Math.max(1, message.attempts)),
            });
        }
    }
}
