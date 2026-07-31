import {
    createPublicConversationResponseSchema,
    publicMessageListResponseSchema,
    requestPublicHandoffResponseSchema,
    sendPublicMessageResponseSchema,
} from "@smartservice/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type {
    PublicConversationService,
    RuntimeServices,
    SmartServiceBindings,
} from "../src/types";

const conversationId = "20000000-0000-4000-a000-000000000001";
const messageId = "30000000-0000-4000-a000-000000000001";
const citationId = "50000000-0000-4000-a000-000000000001";

/**
 * createPublicService
 * ----------------
 * Creates a zero-network public-conversation service double for route-contract tests.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
function createPublicService(): PublicConversationService
{
    return {
        create: vi.fn().mockResolvedValue({
            conversationId,
            conversationToken: "x".repeat(32),
            displayName: "XFlow",
            expiresAt: "2026-07-26T22:00:00.000Z",
            welcomeMessage: "您好，请问有什么可以帮您？",
        }),
        list: vi.fn().mockResolvedValue({
            messages: [],
            nextCursor: null,
            status: "active_ai",
        }),
        requestHandoff: vi.fn().mockResolvedValue({
            handoff: {
                reason: "customer_requested",
                status: "handoff_requested",
            },
            messageId,
        }),
        send: vi.fn().mockResolvedValue({
            answer: "The NF-500 maximum flow rate is 300 litres per minute.",
            citations: [{
                citationId,
                label: "NF-Series Product Manual, p. 4",
                sourceType: "pdf",
                sourceUrl: null,
                supportingExcerpt: "Maximum flow | 300 litres per minute",
            }],
            decision: "answer",
            handoff: null,
            messageId,
        }),
        sendTrusted: vi.fn(),
    };
}

/**
 * requestPublicApp
 * ----------------
 * Dispatches a request through the public router with only the scoped service double reachable.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 3 Public Conversations
 */
async function requestPublicApp(
    publicConversations: PublicConversationService,
    path: string,
    init?: RequestInit,
): Promise<Response>
{
    const app = createApp(() => ({
        publicConversations,
    } as RuntimeServices));

    return app.request(
        `https://smartservice.test${path}`,
        init,
        {} as SmartServiceBindings,
    );
}

describe("public conversation routes", () =>
{
    it("requires an idempotency key and creates a validated conversation", async () =>
    {
        const service = createPublicService();
        const response = await requestPublicApp(
            service,
            "/api/v1/public/conversations",
            {
                body: JSON.stringify({
                    channel: "text",
                    customer: {
                        language: "zh-CN",
                    },
                    publicKey: "xflow-public-demo",
                    turnstileToken: "local-demo-turnstile",
                }),
                headers: {
                    "content-type": "application/json",
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(201);
        expect(createPublicConversationResponseSchema.parse(body).conversationId)
            .toBe(conversationId);
        expect(service.create).toHaveBeenCalledOnce();
    });

    it("returns an answer only with its customer-safe citation payload", async () =>
    {
        const service = createPublicService();
        const response = await requestPublicApp(
            service,
            `/v1/public/conversations/${conversationId}/messages`,
            {
                body: JSON.stringify({
                    clientMessageId: crypto.randomUUID(),
                    text: "What is the maximum flow rate of the NF-500?",
                }),
                headers: {
                    authorization: "Bearer fixture-token",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();
        const answer = sendPublicMessageResponseSchema.parse(body);

        expect(response.status).toBe(200);
        expect(answer.citations).toHaveLength(1);
        expect(JSON.stringify(answer)).not.toContain("chunkId");
    });

    it("supports cursor polling with an ETag and conditional 304", async () =>
    {
        const service = createPublicService();
        const first = await requestPublicApp(
            service,
            `/api/v1/public/conversations/${conversationId}/messages?limit=25`,
            {
                headers: {
                    authorization: "Bearer fixture-token",
                },
            },
        );
        const etag = first.headers.get("etag");
        const firstBody: unknown = await first.json();

        expect(publicMessageListResponseSchema.parse(firstBody).messages).toEqual([]);
        expect(etag).not.toBeNull();

        const second = await requestPublicApp(
            service,
            `/api/v1/public/conversations/${conversationId}/messages?limit=25`,
            {
                headers: {
                    authorization: "Bearer fixture-token",
                    "if-none-match": etag ?? "",
                },
            },
        );

        expect(second.status).toBe(304);
    });

    it("persists an idempotent explicit handoff request", async () =>
    {
        const service = createPublicService();
        const response = await requestPublicApp(
            service,
            `/v1/public/conversations/${conversationId}/request-handoff`,
            {
                headers: {
                    authorization: "Bearer fixture-token",
                    "idempotency-key": crypto.randomUUID(),
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(202);
        expect(requestPublicHandoffResponseSchema.parse(body).handoff.reason)
            .toBe("customer_requested");
    });
});
