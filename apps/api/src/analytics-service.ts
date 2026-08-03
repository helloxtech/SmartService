import {
    createSafeHandoff,
    detectConversationLanguage,
    evaluateDeterministicGuardrails,
    guardrailPromptVersion,
    ragPromptVersion,
    selectCitedGuardrailEvidence,
    validateGroundedAnswer,
    type GuardrailSupervisor,
    type RagAnswerProvider,
    type RetrievedEvidence,
} from "@smartservice/assistant-core";
import {
    dashboardSummarySchema,
    knowledgeGapRetestResponseSchema,
    knowledgeGapSchema,
    resolveKnowledgeGapResponseSchema,
    type DashboardSummary,
    type KnowledgeGap,
    type KnowledgeGapAction,
    type KnowledgeGapRetestResponse,
    type KnowledgeGapStatus,
    type KnowledgeIngestMessage,
    type ResolveKnowledgeGapRequest,
    type ResolveKnowledgeGapResponse,
} from "@smartservice/contracts";
import {
    calculateStandardPages,
    sha256Text,
    type EmbeddingProvider,
} from "@smartservice/ingestion";
import { z } from "zod";

import type { SupabaseConversationRepository } from "./conversation-repository";
import { ApiError } from "./errors";
import { createServiceClient } from "./supabase";
import type {
    AdminIdentity,
    AnalyticsService,
    KnowledgeObjectStore,
    KnowledgeRepository,
    SmartServiceBindings,
} from "./types";

const dashboardRowSchema = z.object({
    ai_contained_conversations: z.union([z.number(), z.string()]),
    ai_containment_rate: z.union([z.number(), z.string()]),
    handed_off_conversations: z.union([z.number(), z.string()]),
    handoff_rate: z.union([z.number(), z.string()]),
    open_knowledge_gap_count: z.union([z.number(), z.string()]),
    total_conversations: z.union([z.number(), z.string()]),
});

const knowledgeGapRowSchema = z.object({
    created_at: z.string(),
    example_question: z.string(),
    first_conversation_id: z.uuid().nullable(),
    id: z.uuid(),
    last_seen_at: z.string(),
    normalized_question: z.string(),
    occurrence_count: z.number().int().positive(),
    reason: z.string(),
    resolved_source_id: z.uuid().nullable(),
    status: z.enum(["open", "resolved", "ignored"]),
    updated_at: z.string(),
});

const resolutionSourceRowSchema = z.object({
    chunk_count: z.number().int().nonnegative(),
    id: z.uuid(),
    name: z.string(),
    status: z.enum([
        "uploaded",
        "extracting",
        "chunking",
        "embedding",
        "ready",
        "failed",
        "disabled",
    ]),
});

const manualIntakeRowSchema = z.object({
    gap_id: z.uuid(),
    job_id: z.uuid(),
    source_id: z.uuid(),
    status: z.enum([
        "uploaded",
        "extracting",
        "chunking",
        "embedding",
        "ready",
        "failed",
        "disabled",
    ]),
});

const retrievedEvidenceRowSchema = z.object({
    chunk_id: z.uuid(),
    combined_score: z.number(),
    content: z.string().min(1),
    lexical_score: z.number(),
    semantic_similarity: z.number(),
    source_locator: z.record(z.string(), z.unknown()),
});

interface AnalyticsDependencies
{
    answers: RagAnswerProvider;
    conversationRepository: SupabaseConversationRepository;
    embeddings: EmbeddingProvider;
    guardrails: GuardrailSupervisor;
    knowledgeRepository: KnowledgeRepository;
    objects: KnowledgeObjectStore;
    queue: Queue<KnowledgeIngestMessage>;
}

/**
 * readNumber
 * ----------------
 * Converts PostgreSQL bigint/numeric output into a finite JavaScript number within a caller-provided boundary.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
 */
function readNumber(
    input: number | string,
    minimum: number,
    maximum: number,
): number
{
    const value = typeof input === "number" ? input : Number(input);

    if (!Number.isFinite(value) || value < minimum || value > maximum)
    {
        throw new ApiError(500, "DASHBOARD_SHAPE_INVALID", "Stored dashboard metrics are invalid.");
    }

    return value;
}

/**
 * vectorToPostgres
 * ----------------
 * Serializes one finite 1024-dimension query embedding for the source-scoped re-test RPC.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
 */
function vectorToPostgres(vector: readonly number[]): string
{
    if (vector.length !== 1024 || vector.some((value) => !Number.isFinite(value)))
    {
        throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The re-test embedding is invalid.");
    }

    return `[${vector.join(",")}]`;
}

/**
 * readLocator
 * ----------------
 * Reads one bounded display string from untrusted source-locator metadata.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
 */
function readLocator(
    locator: Record<string, unknown>,
    key: string,
): string | null
{
    const value = locator[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim().slice(0, 240)
        : null;
}

/**
 * buildRetestCitations
 * ----------------
 * Maps only model-selected chunks from the exact source-scoped retrieval set into non-internal citation DTOs.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
 */
function buildRetestCitations(
    citationChunkIds: readonly string[],
    evidence: readonly RetrievedEvidence[],
): Array<{
    citationId: string;
    label: string;
    sourceType: "manual";
    sourceUrl: null;
    supportingExcerpt: string;
}>
{
    const evidenceById = new Map(evidence.map((item) => [item.chunkId, item]));

    return citationChunkIds.map((chunkId) =>
    {
        const item = evidenceById.get(chunkId);

        if (item === undefined)
        {
            throw new ApiError(502, "CITATION_VALIDATION_FAILED", "The re-test citation is invalid.");
        }

        const title = readLocator(item.sourceLocator, "title") ?? "Manual knowledge";
        const section = readLocator(item.sourceLocator, "section");
        const normalizedExcerpt = item.content.replace(/\s+/gu, " ").trim();

        return {
            citationId: crypto.randomUUID(),
            label: section === null ? title : `${title} — ${section}`.slice(0, 240),
            sourceType: "manual",
            sourceUrl: null,
            supportingExcerpt: normalizedExcerpt.length <= 900
                ? normalizedExcerpt
                : `${normalizedExcerpt.slice(0, 897).trimEnd()}…`,
        };
    });
}

/**
 * createManualPayload
 * ----------------
 * Builds a bounded manual knowledge document containing the original question, approved answer, and optional provenance note.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Resolution
 */
function createManualPayload(
    gap: KnowledgeGap,
    input: ResolveKnowledgeGapRequest,
): {
    payload: {
        documents: Array<{
            sections: Array<{
                heading: string;
                text: string;
            }>;
            title: string;
        }>;
        schemaVersion: 1;
        sourceType: "manual";
        standardPageCount: number;
        title: string;
    };
    standardPageCount: number;
}
{
    const sourceNote = input.sourceNote === undefined
        ? ""
        : `\n\nSource note: ${input.sourceNote}`;
    const text = `Question: ${gap.exampleQuestion}\n\nAnswer: ${input.answer}${sourceNote}`;
    const standardPageCount = calculateStandardPages(text);

    return {
        payload: {
            documents: [{
                sections: [{
                    heading: "Approved manual answer",
                    text,
                }],
                title: input.title,
            }],
            schemaVersion: 1,
            sourceType: "manual",
            standardPageCount,
            title: input.title,
        },
        standardPageCount,
    };
}

/**
 * parseThreshold
 * ----------------
 * Uses the live calibrated threshold and a zero threshold only for deterministic local fixture embeddings.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
 */
function parseThreshold(bindings: SmartServiceBindings): number
{
    const value = bindings.RAG_MATCH_THRESHOLD === undefined
        ? bindings.CHAT_PROVIDER_MODE === "live" ? 0.35 : 0
        : Number(bindings.RAG_MATCH_THRESHOLD);

    if (!Number.isFinite(value) || value < -1 || value > 1)
    {
        throw new ApiError(503, "RAG_CONFIGURATION_INVALID", "The retrieval threshold is invalid.");
    }

    return value;
}

export class SupabaseAnalyticsService implements AnalyticsService
{
    /**
     * SupabaseAnalyticsService
     * ----------------
     * Creates the tenant-scoped dashboard and knowledge-gap application service over shared ingestion and guarded RAG adapters.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard and Knowledge Gaps
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly dependencies: AnalyticsDependencies,
    )
    {
    }

    /**
     * getDashboard
     * ----------------
     * Loads exact closed-conversation, containment, handoff, and open-gap metrics for one bounded date range.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Dashboard
     */
    public async getDashboard(
        organizationId: string,
        from: string,
        to: string,
    ): Promise<DashboardSummary>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("get_dashboard_summary", {
            p_from: from,
            p_organization_id: organizationId,
            p_to: to,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(503, "DASHBOARD_UNAVAILABLE", "Dashboard metrics could not be loaded.");
        }

        const row = dashboardRowSchema.parse(data[0]);

        return dashboardSummarySchema.parse({
            aiContainedConversations: readNumber(
                row.ai_contained_conversations,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
            aiContainmentRate: readNumber(row.ai_containment_rate, 0, 1),
            from,
            handedOffConversations: readNumber(
                row.handed_off_conversations,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
            handoffRate: readNumber(row.handoff_rate, 0, 1),
            openKnowledgeGapCount: readNumber(
                row.open_knowledge_gap_count,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
            to,
            totalConversations: readNumber(
                row.total_conversations,
                0,
                Number.MAX_SAFE_INTEGER,
            ),
        });
    }

    /**
     * loadResolutionSources
     * ----------------
     * Loads only source summary rows referenced by already tenant-filtered knowledge gaps.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Listing
     */
    private async loadResolutionSources(
        organizationId: string,
        sourceIds: readonly string[],
    ): Promise<Map<string, z.infer<typeof resolutionSourceRowSchema>>>
    {
        if (sourceIds.length === 0)
        {
            return new Map();
        }

        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("knowledge_sources")
            .select("id, name, status, chunk_count")
            .eq("organization_id", organizationId)
            .in("id", [...new Set(sourceIds)]);

        if (error !== null)
        {
            throw new ApiError(503, "KNOWLEDGE_GAP_SOURCE_FAILED", "Gap resolution status could not be loaded.");
        }

        const sources = (data ?? []).map((row: unknown) => resolutionSourceRowSchema.parse(row));
        return new Map(sources.map((source) => [source.id, source]));
    }

    /**
     * mapKnowledgeGaps
     * ----------------
     * Maps validated gap rows and their tenant-scoped manual-source summaries into the public contract.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Listing
     */
    private async mapKnowledgeGaps(
        organizationId: string,
        input: readonly unknown[],
    ): Promise<KnowledgeGap[]>
    {
        const rows = input.map((row) => knowledgeGapRowSchema.parse(row));
        const sourceIds = rows
            .map((row) => row.resolved_source_id)
            .filter((sourceId): sourceId is string => sourceId !== null);
        const sources = await this.loadResolutionSources(organizationId, sourceIds);

        return rows.map((row) =>
        {
            const source = row.resolved_source_id === null
                ? undefined
                : sources.get(row.resolved_source_id);

            return knowledgeGapSchema.parse({
                createdAt: row.created_at,
                exampleQuestion: row.example_question,
                firstConversationId: row.first_conversation_id,
                id: row.id,
                lastSeenAt: row.last_seen_at,
                normalizedQuestion: row.normalized_question,
                occurrenceCount: row.occurrence_count,
                reason: row.reason,
                resolutionSource: source === undefined
                    ? null
                    : {
                        chunkCount: source.chunk_count,
                        id: source.id,
                        name: source.name,
                        status: source.status,
                    },
                status: row.status,
                updatedAt: row.updated_at,
            });
        });
    }

    /**
     * listKnowledgeGaps
     * ----------------
     * Lists grouped tenant gaps in priority order with an optional validated status filter.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Listing
     */
    public async listKnowledgeGaps(
        organizationId: string,
        status?: KnowledgeGapStatus,
    ): Promise<KnowledgeGap[]>
    {
        const client = createServiceClient(this.bindings);
        let query = client
            .from("knowledge_gaps")
            .select(
                "id, normalized_question, example_question, first_conversation_id, occurrence_count, reason, status, resolved_source_id, last_seen_at, created_at, updated_at",
            )
            .eq("organization_id", organizationId)
            .order("occurrence_count", { ascending: false })
            .order("last_seen_at", { ascending: false })
            .limit(200);

        if (status !== undefined)
        {
            query = query.eq("status", status);
        }

        const { data, error } = await query;

        if (error !== null)
        {
            throw new ApiError(503, "KNOWLEDGE_GAP_LIST_FAILED", "Knowledge gaps could not be loaded.");
        }

        return this.mapKnowledgeGaps(organizationId, data ?? []);
    }

    /**
     * getKnowledgeGap
     * ----------------
     * Loads one exact tenant-owned gap and its current resolution-source status.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Detail
     */
    public async getKnowledgeGap(
        organizationId: string,
        gapId: string,
    ): Promise<KnowledgeGap | null>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("knowledge_gaps")
            .select(
                "id, normalized_question, example_question, first_conversation_id, occurrence_count, reason, status, resolved_source_id, last_seen_at, created_at, updated_at",
            )
            .eq("organization_id", organizationId)
            .eq("id", gapId)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "KNOWLEDGE_GAP_LOOKUP_FAILED", "The knowledge gap could not be loaded.");
        }

        if (data === null)
        {
            return null;
        }

        return (await this.mapKnowledgeGaps(organizationId, [data]))[0] ?? null;
    }

    /**
     * manageKnowledgeGap
     * ----------------
     * Applies the narrow ignore/reopen state machine through the service-only audited database function.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Management
     */
    public async manageKnowledgeGap(
        identity: AdminIdentity,
        gapId: string,
        action: KnowledgeGapAction,
        requestId: string,
    ): Promise<KnowledgeGap>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("manage_knowledge_gap", {
            p_action: action,
            p_actor_user_id: identity.userId,
            p_gap_id: gapId,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
        });

        if (error !== null)
        {
            throw new ApiError(409, "KNOWLEDGE_GAP_ACTION_FAILED", "The knowledge-gap action is not valid now.");
        }

        const gap = await this.getKnowledgeGap(identity.organizationId, gapId);

        if (gap === null)
        {
            throw new ApiError(404, "KNOWLEDGE_GAP_NOT_FOUND", "The knowledge gap does not exist.");
        }

        return gap;
    }

    /**
     * resolveKnowledgeGap
     * ----------------
     * Stores a manual payload, atomically creates its source/job, queues shared embedding, and links the gap for completion.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 One-click Knowledge
     */
    public async resolveKnowledgeGap(
        identity: AdminIdentity,
        gapId: string,
        input: ResolveKnowledgeGapRequest,
        idempotencyKey: string,
        requestId: string,
    ): Promise<ResolveKnowledgeGapResponse>
    {
        const gap = await this.getKnowledgeGap(identity.organizationId, gapId);

        if (gap === null)
        {
            throw new ApiError(404, "KNOWLEDGE_GAP_NOT_FOUND", "The knowledge gap does not exist.");
        }

        const { payload, standardPageCount } = createManualPayload(gap, input);
        const idempotencyHash = await sha256Text(idempotencyKey);
        const objectKey = [
            "org",
            identity.organizationId,
            "manual-gaps",
            gapId,
            `${idempotencyHash}.json`,
        ].join("/");
        await this.dependencies.objects.putExtractedJson(
            objectKey,
            identity.organizationId,
            payload,
        );

        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("create_manual_gap_resolution", {
            p_created_by: identity.userId,
            p_extracted_object_key: objectKey,
            p_gap_id: gapId,
            p_idempotency_key: idempotencyKey,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
            p_standard_page_count: standardPageCount,
            p_title: input.title,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "KNOWLEDGE_GAP_RESOLUTION_FAILED", "Manual knowledge could not be created.");
        }

        const intake = manualIntakeRowSchema.parse(data[0]);

        if (intake.status !== "ready")
        {
            const message: KnowledgeIngestMessage = {
                idempotencyKey,
                inputObjectKey: objectKey,
                jobId: intake.job_id,
                organizationId: identity.organizationId,
                sourceId: intake.source_id,
                type: "knowledge.ingest",
                version: 1,
            };

            try
            {
                await this.dependencies.queue.send(message, {
                    contentType: "json",
                });
            }
            catch
            {
                const aggregate = await this.dependencies.knowledgeRepository
                    .findAggregate(intake.job_id);

                if (aggregate !== null)
                {
                    await this.dependencies.knowledgeRepository.fail(
                        aggregate,
                        "QUEUE_PUBLISH_FAILED",
                        "The manual knowledge job could not be queued. Retry the source.",
                    );
                }

                throw new ApiError(503, "QUEUE_PUBLISH_FAILED", "Manual knowledge could not be queued.");
            }
        }

        return resolveKnowledgeGapResponseSchema.parse({
            gapId: intake.gap_id,
            jobId: intake.job_id,
            sourceId: intake.source_id,
            status: intake.status,
        });
    }

    /**
     * retrieveResolvedEvidence
     * ----------------
     * Searches only the ready manual source linked to a resolved gap, preventing unrelated evidence from proving the repair.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
     */
    private async retrieveResolvedEvidence(
        organizationId: string,
        sourceId: string,
        question: string,
        queryEmbedding: readonly number[],
    ): Promise<RetrievedEvidence[]>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("match_knowledge_chunks_for_source", {
            p_match_count: 8,
            p_match_threshold: parseThreshold(this.bindings),
            p_organization_id: organizationId,
            p_query_embedding: vectorToPostgres(queryEmbedding),
            p_query_text: question,
            p_source_id: sourceId,
        });

        if (error !== null)
        {
            throw new ApiError(503, "RETEST_RETRIEVAL_FAILED", "The resolved knowledge could not be searched.");
        }

        return (data ?? []).map((input: unknown) =>
        {
            const row = retrievedEvidenceRowSchema.parse(input);
            return {
                chunkId: row.chunk_id,
                combinedScore: row.combined_score,
                content: row.content,
                sourceLocator: row.source_locator,
            };
        });
    }

    /**
     * recordRetest
     * ----------------
     * Persists one validated re-test AI run and audit link without storing an unvalidated answer artifact.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
     */
    private async recordRetest(
        identity: AdminIdentity,
        gapId: string,
        provider: string,
        model: string,
        inputTokens: number | null,
        outputTokens: number | null,
        latencyMs: number,
        decision: "answer" | "clarify" | "handoff",
        retrievedChunkIds: string[],
        citationChunkIds: string[],
        requestId: string,
        supervisor: {
            inputTokens: number | null;
            latencyMs: number;
            model: string;
            outputTokens: number | null;
            provider: string;
        } | null,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("record_knowledge_gap_retest", {
            p_actor_user_id: identity.userId,
            p_citation_chunk_ids: citationChunkIds,
            p_decision: decision,
            p_gap_id: gapId,
            p_input_tokens: inputTokens,
            p_latency_ms: latencyMs,
            p_model: model,
            p_organization_id: identity.organizationId,
            p_output_tokens: outputTokens,
            p_prompt_version: ragPromptVersion,
            p_provider: provider,
            p_request_id: requestId,
            p_retrieved_chunk_ids: retrievedChunkIds,
            p_supervisor_input_tokens: supervisor?.inputTokens ?? null,
            p_supervisor_latency_ms: supervisor?.latencyMs ?? null,
            p_supervisor_model: supervisor?.model ?? null,
            p_supervisor_output_tokens: supervisor?.outputTokens ?? null,
            p_supervisor_prompt_version: supervisor === null
                ? null
                : guardrailPromptVersion,
            p_supervisor_provider: supervisor?.provider ?? null,
        });

        if (error !== null)
        {
            throw new ApiError(503, "RETEST_AUDIT_FAILED", "The knowledge-gap re-test could not be audited.");
        }
    }

    /**
     * retestKnowledgeGap
     * ----------------
     * Re-runs the original question against only its ready manual source and returns a guarded cited preview.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 5 Knowledge Gap Re-test
     */
    public async retestKnowledgeGap(
        identity: AdminIdentity,
        gapId: string,
        requestId: string,
    ): Promise<KnowledgeGapRetestResponse>
    {
        const gap = await this.getKnowledgeGap(identity.organizationId, gapId);

        if (
            gap === null
            || gap.status !== "resolved"
            || gap.resolutionSource?.status !== "ready"
        )
        {
            throw new ApiError(409, "KNOWLEDGE_GAP_NOT_READY", "Complete manual knowledge embedding before re-testing.");
        }

        const startedAt = Date.now();
        const language = detectConversationLanguage(gap.exampleQuestion);
        const rules = await this.dependencies.conversationRepository
            .listGuardrailRules(identity.organizationId);
        const inputEvaluation = evaluateDeterministicGuardrails({
            candidateAnswer: null,
            evidence: [],
            language,
            rules,
            userMessage: gap.exampleQuestion,
        });
        let evidence: RetrievedEvidence[] = [];
        let provider: string;
        let model: string;
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let supervisor: {
            inputTokens: number | null;
            latencyMs: number;
            model: string;
            outputTokens: number | null;
            provider: string;
        } | null = null;
        let answer = inputEvaluation.allowed
            ? null
            : createSafeHandoff(gap.exampleQuestion, language, "guardrail");

        if (answer === null)
        {
            const vectors = await this.dependencies.embeddings.embed([gap.exampleQuestion]);
            const queryEmbedding = vectors[0];

            if (queryEmbedding === undefined)
            {
                throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The re-test embedding is invalid.");
            }

            evidence = await this.retrieveResolvedEvidence(
                identity.organizationId,
                gap.resolutionSource.id,
                gap.exampleQuestion,
                queryEmbedding,
            );

            if (evidence.length === 0)
            {
                provider = "retrieval-gate";
                model = "no-evidence-v1";
                answer = createSafeHandoff(gap.exampleQuestion, language, "missing_knowledge");
            }
            else
            {
                const generated = await this.dependencies.answers.generate({
                    evidence,
                    language,
                    question: gap.exampleQuestion,
                    recentMessages: [],
                });
                inputTokens = generated.inputTokens;
                model = generated.model;
                outputTokens = generated.outputTokens;
                provider = generated.provider;
                answer = validateGroundedAnswer(generated.answer, evidence);
                const outputEvaluation = evaluateDeterministicGuardrails({
                    candidateAnswer: answer.answer,
                    evidence: selectCitedGuardrailEvidence(
                        evidence,
                        answer.citationChunkIds,
                    ),
                    language,
                    rules,
                    userMessage: gap.exampleQuestion,
                });

                if (!outputEvaluation.allowed)
                {
                    answer = createSafeHandoff(gap.exampleQuestion, language, "guardrail");
                }
                else
                {
                    const supervisionStartedAt = Date.now();
                    const supervision = await this.dependencies.guardrails.supervise({
                        candidateAnswer: answer.answer,
                        evidence: selectCitedGuardrailEvidence(
                            evidence,
                            answer.citationChunkIds,
                        ),
                        language,
                        rules,
                        userMessage: gap.exampleQuestion,
                    });
                    supervisor = {
                        inputTokens: supervision.inputTokens,
                        latencyMs: Date.now() - supervisionStartedAt,
                        model: this.dependencies.guardrails.model,
                        outputTokens: supervision.outputTokens,
                        provider: this.dependencies.guardrails.provider,
                    };

                    if (!supervision.evaluation.allowed)
                    {
                        answer = createSafeHandoff(gap.exampleQuestion, language, "guardrail");
                    }
                }
            }
        }
        else
        {
            provider = "deterministic";
            model = "deterministic-guardrail-v1";
        }

        const citations = buildRetestCitations(answer.citationChunkIds, evidence);
        await this.recordRetest(
            identity,
            gapId,
            provider,
            model,
            inputTokens,
            outputTokens,
            Date.now() - startedAt,
            answer.decision,
            evidence.map((item) => item.chunkId),
            answer.citationChunkIds,
            requestId,
            supervisor,
        );

        return knowledgeGapRetestResponseSchema.parse({
            answer: answer.answer,
            citations,
            decision: answer.decision,
            gapId,
            testedAt: new Date().toISOString(),
        });
    }
}
