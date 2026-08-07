import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type {
    GuardrailSupervisor,
    RagAnswerProvider,
} from "@smartservice/assistant-core";
import type { EmbeddingProvider } from "@smartservice/ingestion";

import {
    DefaultPublicConversationService,
    isExplicitHandoffRequest,
} from "../src/conversation-service";
import {
    type CompleteTurnInput,
    type SupabaseConversationRepository,
} from "../src/conversation-repository";
import { ApiError } from "../src/errors";
import type { SmartServiceBindings } from "../src/types";
import type { TurnstileVerifier } from "../src/turnstile";

const organizationId = "10000000-0000-4000-a000-000000000001";
const conversationId = "20000000-0000-4000-a000-000000000001";
const customerMessageId = "30000000-0000-4000-a000-000000000001";
const assistantMessageId = "30000000-0000-4000-a000-000000000002";
const evidenceChunkId = "40000000-0000-4000-a000-000000000020";

afterEach(() =>
{
    vi.restoreAllMocks();
});

interface FailureHarness
{
    answers: RagAnswerProvider;
    embeddings: EmbeddingProvider;
    persistedTurns: CompleteTurnInput[];
    service: DefaultPublicConversationService;
}

/**
 * createFailureHarness
 * ----------------
 * Builds a zero-network voice-turn harness that can fail either query embedding or answer generation and capture the persisted fail-closed audit.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
function createFailureHarness(
    failurePoint: "answer_generation" | "query_embedding",
): FailureHarness
{
    const persistedTurns: CompleteTurnInput[] = [];
    const repository = {
        completeTurn: vi.fn().mockImplementation(async (input: CompleteTurnInput) =>
        {
            persistedTurns.push(input);
            return assistantMessageId;
        }),
        getConversation: vi.fn().mockResolvedValue({
            channel: "voice",
            id: conversationId,
            language: "en",
            organizationId,
            status: "active_ai",
        }),
        listGuardrailRules: vi.fn().mockResolvedValue([]),
        listRecentMessages: vi.fn().mockResolvedValue([]),
        loadResponse: vi.fn().mockImplementation(async () =>
        {
            const turn = persistedTurns[0];

            if (turn === undefined)
            {
                throw new Error("Expected a persisted turn before loading its response.");
            }

            return {
                answer: turn.answer,
                citations: [],
                decision: turn.decision,
                handoff: null,
                messageId: assistantMessageId,
            };
        }),
        recordCustomerMessage: vi.fn().mockResolvedValue({
            created: true,
            createdAt: "2026-08-06T18:00:00.000Z",
            id: customerMessageId,
        }),
        refreshIncrementalSummary: vi.fn().mockResolvedValue(undefined),
        refreshHandoffSnapshot: vi.fn().mockResolvedValue(undefined),
        retrieveEvidence: vi.fn().mockResolvedValue([{
            chunkId: evidenceChunkId,
            combinedScore: 0.93,
            content: "Appointments may be rescheduled without a fee at least 24 hours in advance.",
            sourceLocator: {
                title: "Appointment policy",
            },
        }]),
    } as unknown as SupabaseConversationRepository;
    const embeddings: EmbeddingProvider = {
        embed: vi.fn().mockImplementation(async () =>
        {
            if (failurePoint === "query_embedding")
            {
                throw new ApiError(
                    502,
                    "EMBEDDING_PROVIDER_FAILED",
                    "The embedding provider request failed.",
                );
            }

            return [Array.from({ length: 1_024 }, () => 0)];
        }),
    };
    const answers: RagAnswerProvider = {
        generate: vi.fn().mockImplementation(async () =>
        {
            throw new ApiError(
                502,
                "WORKERS_AI_PROVIDER_FAILED",
                "The primary answer provider request failed.",
            );
        }),
        model: "@cf/zai-org/glm-4.7-flash",
        provider: "cloudflare-workers-ai",
    };
    const guardrails: GuardrailSupervisor = {
        model: "gpt-5-nano",
        provider: "openai",
        supervise: vi.fn(),
    };
    const turnstile: TurnstileVerifier = {
        verify: vi.fn().mockResolvedValue(undefined),
    };
    const bindings = {
        CONVERSATION_TOKEN_SECRET: "x".repeat(32),
        EMBEDDING_PROVIDER_MODE: "live",
        ENVIRONMENT: "test",
        OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    } as SmartServiceBindings;

    return {
        answers,
        embeddings,
        persistedTurns,
        service: new DefaultPublicConversationService(
            bindings,
            repository,
            embeddings,
            answers,
            guardrails,
            turnstile,
        ),
    };
}

describe("explicit customer handoff intent", () =>
{
    it.each([
        "我要人工",
        "请转人工客服",
        "请客服专员跟进",
        "I need a human agent",
        "Please connect me with a support specialist",
        "Connect me to a representative",
        "I want to talk with a real person",
    ])("recognizes %s", (message) =>
    {
        expect(isExplicitHandoffRequest(message)).toBe(true);
    });

    it.each([
        "What are your support hours?",
        "A human sales representative must confirm the price.",
        "请介绍人工智能客服的功能。",
    ])("does not escalate an ordinary mention in %s", (message) =>
    {
        expect(isExplicitHandoffRequest(message)).toBe(false);
    });
});

describe("tenant-generic turn failure isolation", () =>
{
    it.each([{
        errorCode: "EMBEDDING_PROVIDER_FAILED",
        expectedModel: "text-embedding-3-large",
        expectedProvider: "openai",
        failurePoint: "query_embedding" as const,
    }, {
        errorCode: "WORKERS_AI_PROVIDER_FAILED",
        expectedModel: "@cf/zai-org/glm-4.7-flash",
        expectedProvider: "cloudflare-workers-ai",
        failurePoint: "answer_generation" as const,
    }])("persists the exact $failurePoint stage without a false gap or handoff", async ({
        errorCode,
        expectedModel,
        expectedProvider,
        failurePoint,
    }) =>
    {
        const harness = createFailureHarness(failurePoint);
        const errorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const question = "Can I move my appointment?";
        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: question,
            },
            "request-stage-test",
        );
        const turn = harness.persistedTurns[0];

        expect(turn).toBeDefined();

        if (turn === undefined)
        {
            throw new Error("Expected the fail-closed turn to be persisted.");
        }

        expect(response).toMatchObject({
            citations: [],
            decision: "clarify",
            handoff: null,
        });
        expect(response.answer).toContain("support specialist");
        expect(response.answer).not.toContain("try again");
        expect(response.answer).not.toContain("AI");
        expect(turn).toMatchObject({
            aiStatus: "failed",
            citations: [],
            createGap: false,
            decision: "clarify",
            errorCode,
            handoffReason: "system_error",
            model: expectedModel,
            provider: expectedProvider,
        });
        expect(turn.retrievalMetadata).toMatchObject({
            processing: {
                failedStage: failurePoint,
                generationAttempts: null,
                generationRecoveryMode: null,
            },
        });
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining(
            `"failedStage":"${failurePoint}"`,
        ));
        expect(errorMock).not.toHaveBeenCalledWith(expect.stringContaining(question));
    });
});
