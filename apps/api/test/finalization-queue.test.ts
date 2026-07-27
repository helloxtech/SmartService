import { describe, expect, it, vi } from "vitest";

import { processFinalizationMessage } from "../src/finalization-queue";
import type { RuntimeServices } from "../src/types";

const organizationId = "00000000-0000-4000-a000-000000000001";
const conversationId = "20000000-0000-4000-a000-000000000001";
const message = {
    conversationId,
    includeTicketClassification: false as const,
    organizationId,
    type: "conversation.finalize" as const,
    version: 1 as const,
};

describe("conversation finalization queue", () =>
{
    it("skips an already finalized conversation before making another model call", async () =>
    {
        const finalize = vi.fn();
        const services = {
            finalizer: {
                finalize,
                model: "deterministic-finalization-v1",
                provider: "deterministic",
            },
            team: {
                loadFinalizationAggregate: vi.fn().mockResolvedValue({
                    alreadyFinalized: true,
                    conversationId,
                    language: "en",
                    messages: [],
                    organizationId,
                }),
            },
        } as unknown as RuntimeServices;

        await expect(processFinalizationMessage(
            message,
            services,
            "queue:fixture",
        )).resolves.toEqual({
            conversationId,
            status: "duplicate",
        });
        expect(finalize).not.toHaveBeenCalled();
    });

    it("persists a validated no-ticket final record with its model audit", async () =>
    {
        const completeFinalization = vi.fn().mockResolvedValue(undefined);
        const services = {
            finalizer: {
                finalize: vi.fn().mockResolvedValue({
                    finalization: {
                        customerFacts: [],
                        followUpActions: [],
                        intentLevel: "unknown",
                        outcome: "resolved_human",
                        primaryIntent: "Warranty help",
                        suggestedScript: "Please reply if you need more help.",
                        summary: "A human reviewed the warranty question.",
                        ticket: null,
                    },
                    inputTokens: null,
                    outputTokens: null,
                }),
                model: "deterministic-finalization-v1",
                provider: "deterministic",
            },
            team: {
                completeFinalization,
                loadFinalizationAggregate: vi.fn().mockResolvedValue({
                    alreadyFinalized: false,
                    conversationId,
                    language: "en",
                    messages: [{
                        id: "30000000-0000-4000-a000-000000000001",
                        senderType: "customer",
                        text: "Please explain the warranty.",
                    }],
                    organizationId,
                }),
            },
        } as unknown as RuntimeServices;

        const result = await processFinalizationMessage(
            message,
            services,
            "queue:fixture",
        );

        expect(result.status).toBe("completed");
        expect(completeFinalization).toHaveBeenCalledOnce();
        expect(completeFinalization.mock.calls[0]?.[1]).toMatchObject({
            ticket: null,
        });
    });
});
