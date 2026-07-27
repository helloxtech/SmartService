import { processIngestionMessage } from "@smartservice/ingestion";

import { ApiError } from "./errors";
import { processFinalizationMessage } from "./finalization-queue";
import { createRuntimeServices } from "./services";
import type {
    RuntimeServiceFactory,
    SmartServiceBindings,
} from "./types";

/**
 * readQueueMessageType
 * ----------------
 * Reads only the routing discriminator from an untrusted Queue body before a full handler validates it.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Queue Dispatch
 */
function readQueueMessageType(input: unknown): string | null
{
    if (
        typeof input !== "object"
        || input === null
        || !("type" in input)
        || typeof input.type !== "string"
    )
    {
        return null;
    }

    return input.type;
}

/**
 * handleQueue
 * ----------------
 * Dispatches ID-only ingestion/finalization messages, acknowledges success or duplicates, and applies bounded Queue retries.
 *
 * July 26, 2026: Updated by Forrest Zhang for SmartService Day 4 Conversation Finalization
 */
export async function handleQueue(
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
            const messageType = readQueueMessageType(message.body);
            let result: unknown;

            if (messageType === "knowledge.ingest")
            {
                result = await processIngestionMessage(message.body, {
                    embeddings: services.embeddings,
                    payloads: services.crawl,
                    repository: services.repository,
                });
            }
            else if (messageType === "conversation.finalize")
            {
                result = await processFinalizationMessage(
                    message.body,
                    services,
                    `queue:${message.id}`,
                );
            }
            else
            {
                throw new ApiError(
                    422,
                    "QUEUE_MESSAGE_UNSUPPORTED",
                    "The Queue message type is not supported.",
                );
            }

            message.ack();

            console.log(JSON.stringify({
                event: "queue.message.completed",
                messageId: message.id,
                messageType,
                result,
            }));
        }
        catch (error: unknown)
        {
            const errorName = error instanceof Error ? error.name : "UnknownError";

            console.error(JSON.stringify({
                attempt: message.attempts,
                errorName,
                event: "queue.message.failed",
                messageId: message.id,
                messageType: readQueueMessageType(message.body),
            }));
            message.retry({
                delaySeconds: Math.min(30, 5 * Math.max(1, message.attempts)),
            });
        }
    }
}
