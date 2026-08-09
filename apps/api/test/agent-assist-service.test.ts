import type {
    GuardrailSupervisor,
    RagAnswerProvider,
    RetrievedEvidence,
} from "@smartservice/assistant-core";
import type { EmbeddingProvider } from "@smartservice/ingestion";
import {
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { DefaultAgentAssistService } from "../src/agent-assist-service";
import type { SupabaseConversationRepository } from "../src/conversation-repository";
import type {
    AgentSuggestionAggregate,
    CompleteAgentSuggestionInput,
    SupabaseTeamRepository,
} from "../src/team-repository";
import type { SmartServiceBindings } from "../src/types";

const organizationId = "00000000-0000-4000-a000-000000000001";
const conversationId = "20000000-0000-4000-a000-000000000001";
const triggerMessageId = "30000000-0000-4000-a000-000000000001";
const suggestionId = "80000000-0000-4000-a000-000000000001";
const evidence: RetrievedEvidence = {
    chunkId: "72000000-0000-4000-a000-000000000001",
    combinedScore: 0.95,
    content: "The company offers the requested service.",
    sourceLocator: {
        title: "Approved service guide",
        url: "https://example.test/services",
    },
};
const aggregate: AgentSuggestionAggregate = {
    conversationId,
    language: "en",
    organizationId,
    question: "Do you offer the requested service?",
    recentMessages: [],
    rules: [],
    suggestionId,
    triggerMessageId,
};

interface AgentAssistHarness
{
    complete: ReturnType<typeof vi.fn<(input: CompleteAgentSuggestionInput) => Promise<boolean>>>;
    queueSend: ReturnType<typeof vi.fn>;
    retrieveEvidence: ReturnType<typeof vi.fn>;
    service: DefaultAgentAssistService;
    team: {
        loadAgentSuggestionAggregate: ReturnType<typeof vi.fn>;
        queueAgentReplySuggestion: ReturnType<typeof vi.fn>;
    };
}

/**
 * createHarness
 * ----------------
 * Creates isolated provider and repository doubles for the asynchronous grounded suggestion pipeline.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function createHarness(
    retrievedEvidence: RetrievedEvidence[] = [evidence],
): AgentAssistHarness
{
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn<(input: CompleteAgentSuggestionInput) => Promise<boolean>>()
        .mockResolvedValue(true);
    const team = {
        completeAgentReplySuggestion: complete,
        failAgentReplySuggestion: vi.fn().mockResolvedValue(undefined),
        getLatestCustomerMessageId: vi.fn().mockResolvedValue(triggerMessageId),
        loadAgentSuggestionAggregate: vi.fn().mockResolvedValue(aggregate),
        queueAgentReplySuggestion: vi.fn().mockResolvedValue({
            created: true,
            suggestionId,
        }),
    };
    const retrieveEvidence = vi.fn().mockResolvedValue(retrievedEvidence);
    const conversations = {
        retrieveEvidence,
    };
    const embeddings: EmbeddingProvider = {
        embed: vi.fn().mockResolvedValue([Array.from({ length: 1024 }, () => 0.01)]),
    };
    const answers: RagAnswerProvider = {
        generate: vi.fn().mockResolvedValue({
            answer: {
                answer: "Yes, we offer the requested service.",
                citationChunkIds: [evidence.chunkId],
                confidence: 0.95,
                decision: "answer",
                handoffReason: null,
                normalizedQuestion: "do you offer the requested service",
            },
            inputTokens: 20,
            model: "fixture-answer-v1",
            outputTokens: 10,
            provider: "fixture",
        }),
        model: "fixture-answer-v1",
        provider: "fixture",
    };
    const guardrails: GuardrailSupervisor = {
        model: "fixture-guardrail-v1",
        provider: "fixture",
        supervise: vi.fn().mockResolvedValue({
            evaluation: {
                allowed: true,
                requestHandoff: false,
                safeResponse: null,
                violations: [],
            },
            inputTokens: 5,
            outputTokens: 2,
        }),
    };
    const bindings = {
        CHAT_PROVIDER_MODE: "live",
        FINALIZE_QUEUE: {
            send: queueSend,
            sendBatch: vi.fn(),
        },
    } as unknown as SmartServiceBindings;
    const service = new DefaultAgentAssistService(
        bindings,
        conversations as unknown as SupabaseConversationRepository,
        team as unknown as SupabaseTeamRepository,
        embeddings,
        answers,
        guardrails,
    );

    return {
        complete,
        queueSend,
        retrieveEvidence,
        service,
        team,
    };
}

describe("agent reply assistance", () =>
{
    it("persists a grounded draft with only its validated approved citation", async () =>
    {
        const harness = createHarness();
        const result = await harness.service.process({
            conversationId,
            organizationId,
            suggestionId,
            triggerMessageId,
            type: "agent.reply_suggest",
            version: 1,
        }, "queue:test-grounded");

        expect(result.status).toBe("completed");
        expect(harness.complete).toHaveBeenCalledWith(expect.objectContaining({
            citations: [{
                chunkId: evidence.chunkId,
                label: "Approved service guide",
                supportingExcerpt: evidence.content,
            }],
            draftText: "Yes, we offer the requested service.",
            kind: "grounded_answer",
            suggestionId,
            triggerMessageId,
        }));
    });

    it("uses a human-owned verification draft without citations when approved knowledge is missing", async () =>
    {
        const harness = createHarness([]);
        await harness.service.process({
            conversationId,
            organizationId,
            suggestionId,
            triggerMessageId,
            type: "agent.reply_suggest",
            version: 1,
        }, "queue:test-missing");

        expect(harness.complete).toHaveBeenCalledWith(expect.objectContaining({
            citations: [],
            draftText: "I need to verify that detail before I can give you an accurate answer. Please give me a moment while I confirm it for you.",
            kind: "clarifying_question",
        }));
    });

    it("recovers a profile fact after strict filtering rejects nonempty semantic candidates", async () =>
    {
        const harness = createHarness();
        const recoveredEvidence: RetrievedEvidence = {
            ...evidence,
            combinedScore: 0.62,
            content: "Service areas: the organization serves customers across Canada and the United States.",
            sourceLocator: {
                title: "About the organization",
                url: "https://example.test/about",
            },
        };
        harness.team.loadAgentSuggestionAggregate.mockResolvedValue({
            ...aggregate,
            question: "Where do you operate?",
        });
        harness.retrieveEvidence
            .mockResolvedValueOnce([{
                ...evidence,
                chunkId: "72000000-0000-4000-a000-000000000002",
                content: "The academy offers twelve-week evening music courses.",
            }])
            .mockResolvedValueOnce([recoveredEvidence]);

        const result = await harness.service.process({
            conversationId,
            organizationId,
            suggestionId,
            triggerMessageId,
            type: "agent.reply_suggest",
            version: 1,
        }, "queue:test-post-filter-recovery");

        expect(result.status).toBe("completed");
        expect(harness.retrieveEvidence).toHaveBeenNthCalledWith(
            1,
            organizationId,
            "Where do you operate?",
            expect.any(Array),
            expect.any(Number),
            20,
        );
        expect(harness.retrieveEvidence).toHaveBeenNthCalledWith(
            2,
            organizationId,
            "Where do you operate?",
            expect.any(Array),
            0,
            100,
        );
        expect(harness.complete).toHaveBeenCalledWith(expect.objectContaining({
            citations: [expect.objectContaining({
                chunkId: recoveredEvidence.chunkId,
            })],
        }));
    });

    it("drops a queued draft as stale before making provider calls", async () =>
    {
        const harness = createHarness();
        harness.team.loadAgentSuggestionAggregate.mockResolvedValue(null);
        const result = await harness.service.process({
            conversationId,
            organizationId,
            suggestionId,
            triggerMessageId,
            type: "agent.reply_suggest",
            version: 1,
        }, "queue:test-stale");

        expect(result.status).toBe("stale");
        expect(harness.retrieveEvidence).not.toHaveBeenCalled();
        expect(harness.complete).not.toHaveBeenCalled();
    });

    it("publishes only tenant and record identifiers after the pending row is created", async () =>
    {
        const harness = createHarness();
        await harness.service.schedule(
            organizationId,
            conversationId,
            triggerMessageId,
            "request:test-schedule",
        );

        expect(harness.queueSend).toHaveBeenCalledWith({
            conversationId,
            organizationId,
            suggestionId,
            triggerMessageId,
            type: "agent.reply_suggest",
            version: 1,
        }, {
            contentType: "json",
        });
    });
});
