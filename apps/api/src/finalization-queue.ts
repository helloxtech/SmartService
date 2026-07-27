import {
    conversationFinalizeMessageSchema,
    conversationFinalizationSchema,
} from "@smartservice/contracts";

import { ApiError } from "./errors";
import type { RuntimeServices } from "./types";

export interface FinalizationProcessingResult
{
    conversationId: string;
    status: "completed" | "duplicate";
}

/**
 * processFinalizationMessage
 * ----------------
 * Reconciles an ID-only Queue command, skips completed work, generates the required final record, and persists its AI audit.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 4 Conversation Finalization
 */
export async function processFinalizationMessage(
    input: unknown,
    services: RuntimeServices,
    requestId: string,
): Promise<FinalizationProcessingResult>
{
    const message = conversationFinalizeMessageSchema.parse(input);
    const aggregate = await services.team.loadFinalizationAggregate(
        message.organizationId,
        message.conversationId,
    );

    if (aggregate.alreadyFinalized)
    {
        return {
            conversationId: aggregate.conversationId,
            status: "duplicate",
        };
    }

    const startedAt = Date.now();
    const result = await services.finalizer.finalize({
        includeTicketClassification: false,
        language: aggregate.language,
        messages: aggregate.messages,
    });
    const finalization = conversationFinalizationSchema.parse(result.finalization);

    if (finalization.ticket !== null)
    {
        throw new ApiError(
            502,
            "OPTIONAL_SCOPE_FORBIDDEN",
            "Ticket classification is disabled before G3.",
        );
    }

    await services.team.completeFinalization(
        aggregate,
        finalization,
        services.finalizer.provider,
        services.finalizer.model,
        result.inputTokens,
        result.outputTokens,
        Date.now() - startedAt,
        requestId,
    );

    return {
        conversationId: aggregate.conversationId,
        status: "completed",
    };
}
