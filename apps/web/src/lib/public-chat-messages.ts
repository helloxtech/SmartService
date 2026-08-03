import type { PublicCitation } from "@smartservice/contracts";

export interface ChatMessage
{
    citations: PublicCitation[];
    id: string;
    sender: "ai" | "customer" | "human" | "system";
    text: string;
}

/**
 * mergeChatMessages
 * ----------------
 * Appends public-chat messages by authoritative ID so polling and a concurrent send response cannot render the same persisted message twice.
 *
 * August 03, 2026: Created by Forrest Zhang for SmartService Public Chat Message Race
 */
export function mergeChatMessages(
    current: readonly ChatMessage[],
    additions: readonly ChatMessage[],
): ChatMessage[]
{
    const knownIds = new Set(current.map((message) => message.id));
    const uniqueAdditions = additions.filter((message) =>
    {
        if (knownIds.has(message.id))
        {
            return false;
        }

        knownIds.add(message.id);
        return true;
    });

    return [...current, ...uniqueAdditions];
}
