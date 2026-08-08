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
    listRecentMessages: ReturnType<typeof vi.fn>;
    persistedTurns: CompleteTurnInput[];
    retrieveEvidence: ReturnType<typeof vi.fn>;
    service: DefaultPublicConversationService;
}

/**
 * createFailureHarness
 * ----------------
 * Builds a zero-network voice-turn harness that can complete normally or fail query embedding or answer generation while capturing the persisted audit.
 *
 * August 06, 2026: Created by Forrest Zhang for Tenant-Generic Answer Reliability
 */
function createFailureHarness(
    failurePoint: "answer_generation" | "query_embedding" | null,
): FailureHarness
{
    const persistedTurns: CompleteTurnInput[] = [];
    const listRecentMessages = vi.fn().mockResolvedValue([]);
    const retrieveEvidence = vi.fn().mockResolvedValue([{
        chunkId: evidenceChunkId,
        combinedScore: 0.93,
        content: "Appointments may be rescheduled without a fee at least 24 hours in advance.",
        sourceLocator: {
            title: "Appointment policy",
        },
    }]);
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
        listRecentMessages,
        loadResponse: vi.fn().mockImplementation(async () =>
        {
            const turn = persistedTurns[0];

            if (turn === undefined)
            {
                throw new Error("Expected a persisted turn before loading its response.");
            }

            return {
                answer: turn.answer,
                citations: turn.citations.map((citation) => ({
                    citationId: citation.chunkId,
                    label: citation.label,
                    sourceType: "url" as const,
                    sourceUrl: null,
                    supportingExcerpt: citation.supportingExcerpt,
                })),
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
        retrieveEvidence,
    } as unknown as SupabaseConversationRepository;
    const embeddings: EmbeddingProvider = {
        embed: vi.fn().mockImplementation(async (texts: readonly string[]) =>
        {
            if (failurePoint === "query_embedding")
            {
                throw new ApiError(
                    502,
                    "EMBEDDING_PROVIDER_FAILED",
                    "The embedding provider request failed.",
                );
            }

            return texts.map(() => Array.from({ length: 1_024 }, () => 0));
        }),
    };
    const answers: RagAnswerProvider = {
        generate: vi.fn().mockImplementation(async () =>
        {
            if (failurePoint === "answer_generation")
            {
                throw new ApiError(
                    502,
                    "WORKERS_AI_PROVIDER_FAILED",
                    "The primary answer provider request failed.",
                );
            }

            return {
                answer: {
                    answer: "I can confirm the appointment policy with a support specialist if needed.",
                    citationChunkIds: [],
                    confidence: 0.4,
                    decision: "clarify",
                    handoffReason: "missing_knowledge",
                    normalizedQuestion: "can i move my appointment",
                },
                inputTokens: 80,
                model: "@cf/meta/llama-3.1-8b-instruct-fast",
                outputTokens: 20,
                provider: "cloudflare-workers-ai",
            };
        }),
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        provider: "cloudflare-workers-ai",
    };
    const guardrails: GuardrailSupervisor = {
        model: "gpt-5-nano",
        provider: "openai",
        supervise: vi.fn().mockResolvedValue({
            evaluation: {
                allowed: true,
                requestHandoff: false,
                safeResponse: null,
                violations: [],
            },
            inputTokens: 30,
            outputTokens: 10,
        }),
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
        listRecentMessages,
        persistedTurns,
        retrieveEvidence,
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
    it("answers a voice channel check without retrieval, generation, citations, or escalation", async () =>
    {
        const harness = createFailureHarness(null);
        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "Can you hear me?",
            },
            "request-conversation-act-test",
        );
        const turn = harness.persistedTurns[0];

        expect(response).toMatchObject({
            answer: "Yes, I can hear you. What would you like help with?",
            citations: [],
            decision: "acknowledge",
            handoff: null,
        });
        expect(harness.embeddings.embed).not.toHaveBeenCalled();
        expect(harness.retrieveEvidence).not.toHaveBeenCalled();
        expect(harness.answers.generate).not.toHaveBeenCalled();
        expect(turn).toMatchObject({
            citations: [],
            createGap: false,
            decision: "acknowledge",
            handoffReason: null,
            model: "conversation-act-v1",
            provider: "deterministic",
            retrievedChunkIds: [],
        });
    });

    it("answers a customer-service capability question without treating it as missing company knowledge", async () =>
    {
        const harness = createFailureHarness(null);
        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "那你能答复什么问题？",
            },
            "request-capability-act-test",
        );

        expect(response).toMatchObject({
            answer: expect.stringContaining("产品或服务"),
            citations: [],
            decision: "acknowledge",
            handoff: null,
        });
        expect(harness.embeddings.embed).not.toHaveBeenCalled();
        expect(harness.retrieveEvidence).not.toHaveBeenCalled();
        expect(harness.answers.generate).not.toHaveBeenCalled();
        expect(harness.persistedTurns[0]).toMatchObject({
            createGap: false,
            decision: "acknowledge",
            model: "conversation-act-v1",
            provider: "deterministic",
        });
    });

    it("keeps an anaphoric profile follow-up on the prior subject and drops another industry's result", async () =>
    {
        const harness = createFailureHarness(null);
        const relevantEvidence = {
            chunkId: evidenceChunkId,
            combinedScore: 0.81,
            content: "太阳能板安装工程师 Maria Chen 拥有十年现场安装经验。",
            sourceLocator: {
                title: "安装团队简介",
            },
        };
        const unrelatedEvidence = {
            chunkId: "40000000-0000-4000-a000-000000000021",
            combinedScore: 0.94,
            content: "前端工程师张健负责响应式网页排版。",
            sourceLocator: {
                title: "软件开发团队",
            },
        };
        harness.listRecentMessages.mockResolvedValue([{
            senderType: "customer",
            text: "太阳能板的安装工程师是谁？",
        }, {
            senderType: "ai",
            text: "安装负责人是 Maria Chen。",
        }]);
        harness.retrieveEvidence.mockResolvedValue([
            unrelatedEvidence,
            relevantEvidence,
        ]);

        await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "可以看看他们的资料吗？",
            },
            "request-context-relevance-test",
        );

        expect(harness.answers.generate).toHaveBeenCalledWith(expect.objectContaining({
            evidence: [relevantEvidence],
            question: "可以看看他们的资料吗？",
            recentMessages: expect.arrayContaining([expect.objectContaining({
                text: "太阳能板的安装工程师是谁？",
            })]),
        }));
    });

    it("uses the smaller single-question evidence window and records successful stage timings", async () =>
    {
        const harness = createFailureHarness(null);
        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "Can I move my appointment?",
            },
            "request-success-timing-test",
        );
        const turn = harness.persistedTurns[0];

        expect(response).toMatchObject({
            decision: "clarify",
            handoff: null,
        });
        expect(harness.retrieveEvidence).toHaveBeenCalledWith(
            organizationId,
            expect.any(String),
            expect.any(Array),
            expect.any(Number),
            5,
        );
        expect(harness.answers.generate).toHaveBeenCalledWith(expect.objectContaining({
            questionParts: ["Can I move my appointment?"],
        }));
        expect(turn?.retrievalMetadata).toMatchObject({
            processing: {
                failedStage: null,
                stageDurationsMs: expect.objectContaining({
                    answer_generation: expect.any(Number),
                    knowledge_retrieval: expect.any(Number),
                    output_supervision: expect.any(Number),
                    query_embedding: expect.any(Number),
                }),
            },
        });
    });

    it("widens only stable organization-fact retrieval before strict evidence filtering", async () =>
    {
        const harness = createFailureHarness(null);
        harness.retrieveEvidence.mockResolvedValue([]);

        await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "你们公司是什么时候成立的？",
            },
            "request-organization-fact-window-test",
        );

        expect(harness.retrieveEvidence).toHaveBeenNthCalledWith(
            1,
            organizationId,
            expect.stringContaining("founded in"),
            expect.any(Array),
            expect.any(Number),
            20,
        );
        expect(harness.retrieveEvidence).toHaveBeenNthCalledWith(
            2,
            organizationId,
            expect.stringContaining("founded in"),
            expect.any(Array),
            0,
            100,
        );
        expect(harness.answers.generate).not.toHaveBeenCalled();
        expect(harness.persistedTurns[0]?.retrievalMetadata).toMatchObject({
            candidateCounts: [0],
            filteredCounts: [0],
            profileRecoveryUsed: [true],
            threshold: 0,
        });
    });

    it("projects one retrieved founding fact as a complete sentence without answer-model latency", async () =>
    {
        const harness = createFailureHarness(null);
        harness.retrieveEvidence.mockResolvedValue([{
            chunkId: evidenceChunkId,
            combinedScore: 0.82,
            content: "The company was founded by two industry specialists in 2018.",
            sourceLocator: {
                title: "About Us",
            },
        }]);

        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "When was the company founded?",
            },
            "request-single-founding-projection-test",
        );

        expect(response).toMatchObject({
            answer: "We were established in 2018.",
            decision: "answer",
        });
        expect(response.citations).toHaveLength(1);
        expect(harness.answers.generate).not.toHaveBeenCalled();
        expect(harness.persistedTurns[0]).toMatchObject({
            model: "stable-fact-v1",
            provider: "deterministic",
        });
    });

    it("preserves every server-planned part through retrieval and answer generation", async () =>
    {
        const harness = createFailureHarness(null);
        vi.mocked(harness.answers.generate).mockImplementation(async (generationInput) => ({
            answer: generationInput.question.includes("warranty")
                ? {
                    answer: "The warranty is one year.",
                    citationChunkIds: [evidenceChunkId],
                    confidence: 0.8,
                    decision: "answer" as const,
                    handoffReason: null,
                    normalizedQuestion: "warranty",
                }
                : {
                    answer: "I cannot confirm the price yet.",
                    citationChunkIds: [],
                    confidence: 0.4,
                    decision: "clarify" as const,
                    handoffReason: "missing_knowledge" as const,
                    normalizedQuestion: "price",
                },
            inputTokens: 40,
            model: "@cf/meta/llama-3.1-8b-instruct-fast",
            outputTokens: 20,
            provider: "cloudflare-workers-ai",
        }));

        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "What is the warranty? What does it cost?",
            },
            "request-multipart-coverage-test",
        );

        expect(harness.answers.generate).toHaveBeenCalledTimes(2);
        expect(harness.answers.generate).toHaveBeenNthCalledWith(1, expect.objectContaining({
            question: "What is the warranty",
            questionPartEvidenceIds: [[evidenceChunkId]],
            questionParts: ["What is the warranty"],
        }));
        expect(harness.answers.generate).toHaveBeenNthCalledWith(2, expect.objectContaining({
            question: "What does it cost",
            questionPartEvidenceIds: [[evidenceChunkId]],
            questionParts: ["What does it cost"],
        }));
        expect(harness.retrieveEvidence).toHaveBeenCalledTimes(2);
        expect(response.answer).toContain("1. The warranty is one year.");
        expect(response.answer).toContain("2. I cannot confirm “What does it cost” yet.");
        expect(response.answer).toContain("support specialist");
    });

    it("composes explicit stable facts without asking the model to embellish them", async () =>
    {
        const harness = createFailureHarness(null);
        harness.retrieveEvidence.mockResolvedValue([{
            chunkId: evidenceChunkId,
            combinedScore: 0.93,
            content: "The company was founded in 2001. Address: 2335-8888 Odlin Cres, Richmond, B.C.",
            sourceLocator: {
                title: "Company profile",
            },
        }]);
        const response = await harness.service.sendTrusted(
            organizationId,
            conversationId,
            {
                clientMessageId: crypto.randomUUID(),
                text: "When was the company founded? What is the address?",
            },
            "request-stable-fact-test",
        );

        expect(harness.answers.generate).not.toHaveBeenCalled();
        expect(response.answer).toContain("1. We were established in 2001.");
        expect(response.answer).toContain("2. Our address is 2335-8888 Odlin Cres.");
        expect(response.answer).not.toContain("Richmond");
        expect(response.citations).toHaveLength(1);
    });

    it.each([{
        errorCode: "EMBEDDING_PROVIDER_FAILED",
        expectedModel: "text-embedding-3-large",
        expectedProvider: "openai",
        failurePoint: "query_embedding" as const,
    }, {
        errorCode: "WORKERS_AI_PROVIDER_FAILED",
        expectedModel: "@cf/meta/llama-3.1-8b-instruct-fast",
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
                stageDurationsMs: expect.objectContaining({
                    conversation_context: expect.any(Number),
                    guardrail_configuration: expect.any(Number),
                    input_guardrail: expect.any(Number),
                }),
            },
        });
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining(
            `"failedStage":"${failurePoint}"`,
        ));
        expect(errorMock).not.toHaveBeenCalledWith(expect.stringContaining(question));
    });
});
