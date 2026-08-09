import {
    buildCrossLanguageRetrievalQuestion,
    buildQuestionPartEvidenceScope,
    buildRetrievalQuestions,
    classifyRetrievalIntent,
    createApprovedManualAnswer,
    createExplicitStableFactAnswer,
    enforceCustomerControlledHandoff,
    evaluateDeterministicGuardrails,
    filterEvidenceForQuestionContext,
    getOrganizationProfileRecoveryLimit,
    getRetrievalCandidateLimit,
    isDirectlyGroundedOfferingAnswer,
    mergeRetrievedEvidence,
    ragPromptVersion,
    selectCitedGuardrailEvidence,
    validateGroundedAnswer,
    type GuardrailSupervisor,
    type RagAnswerProvider,
    type RetrievedEvidence,
} from "@smartservice/assistant-core";
import type {
    AgentReplySuggestionKind,
    AgentReplySuggestionMessage,
    ConversationLanguage,
    GuardrailEvaluation,
    RagAnswer,
} from "@smartservice/contracts";
import type { EmbeddingProvider } from "@smartservice/ingestion";

import type { SupabaseConversationRepository } from "./conversation-repository";
import { ApiError } from "./errors";
import type {
    AgentSuggestionAggregate,
    AgentSuggestionCitationWrite,
    SupabaseTeamRepository,
} from "./team-repository";
import type {
    AgentAssistService,
    SmartServiceBindings,
} from "./types";

const agentAssistPromptVersion = `${ragPromptVersion}:agent-assist-v1`;

interface DraftResult
{
    citations: AgentSuggestionCitationWrite[];
    draftText: string;
    inputTokens: number | null;
    kind: AgentReplySuggestionKind;
    metadata: Record<string, unknown>;
    model: string;
    outputTokens: number | null;
    provider: string;
}

/**
 * parseThreshold
 * ----------------
 * Uses the shared calibrated live retrieval default while validating an optional tenant-generic override for agent assistance.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function parseThreshold(bindings: SmartServiceBindings): number
{
    const defaultThreshold = bindings.CHAT_PROVIDER_MODE === "live" ? 0.35 : 0;
    const threshold = bindings.RAG_MATCH_THRESHOLD === undefined
        ? defaultThreshold
        : Number(bindings.RAG_MATCH_THRESHOLD);

    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1)
    {
        throw new ApiError(503, "RAG_CONFIGURATION_INVALID", "The retrieval threshold is not valid.");
    }

    return threshold;
}

/**
 * readLocatorString
 * ----------------
 * Reads one bounded nonempty source-locator label without trusting stored extraction metadata.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function readLocatorString(
    locator: Record<string, unknown>,
    key: string,
): string | null
{
    const value = locator[key];
    return typeof value === "string" && value.trim().length > 0
        ? value.trim().slice(0, 180)
        : null;
}

/**
 * readLocatorPage
 * ----------------
 * Reads one positive page number from untrusted source-locator metadata.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function readLocatorPage(locator: Record<string, unknown>): number | null
{
    const value = locator.pageStart;
    return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : null;
}

/**
 * buildCitationLabel
 * ----------------
 * Formats an approved source title plus its real page or section locator for an agent-facing source card.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function buildCitationLabel(evidence: RetrievedEvidence): string
{
    const title = readLocatorString(evidence.sourceLocator, "title")
        ?? readLocatorString(evidence.sourceLocator, "fileName")
        ?? "Approved knowledge";
    const page = readLocatorPage(evidence.sourceLocator);
    const section = readLocatorString(evidence.sourceLocator, "section");
    const suffix = page !== null
        ? `, p. ${page}`
        : section !== null
            ? ` — ${section}`
            : "";

    return `${title}${suffix}`.slice(0, 240);
}

/**
 * buildSupportingExcerpt
 * ----------------
 * Produces a bounded verbatim excerpt for agent verification without exposing the complete retrieved corpus.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function buildSupportingExcerpt(content: string): string
{
    const normalized = content
        .replace(/\s+/gu, " ")
        .replace(/([.!?])(?=[A-Z])/gu, "$1 ")
        .trim();

    return normalized.length <= 900
        ? normalized
        : `${normalized.slice(0, 897).trimEnd()}…`;
}

/**
 * buildCitationWrites
 * ----------------
 * Resolves validated answer citations back to the exact retrieved evidence accepted by the database boundary.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function buildCitationWrites(
    citationChunkIds: readonly string[],
    evidence: readonly RetrievedEvidence[],
): AgentSuggestionCitationWrite[]
{
    const evidenceById = new Map(evidence.map((item) => [item.chunkId, item]));

    return citationChunkIds.slice(0, 5).map((chunkId) =>
    {
        const item = evidenceById.get(chunkId);

        if (item === undefined)
        {
            throw new ApiError(502, "CITATION_VALIDATION_FAILED", "The generated citation is not valid.");
        }

        return {
            chunkId,
            label: buildCitationLabel(item),
            supportingExcerpt: buildSupportingExcerpt(item.content),
        };
    });
}

/**
 * createHumanClarification
 * ----------------
 * Produces a company-owned holding reply for a human agent without pretending an unsupported fact is known.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function createHumanClarification(language: ConversationLanguage): string
{
    return language === "zh-CN"
        ? "这个信息我需要进一步确认后，才能给您准确答复。请稍等，我现在帮您核实。"
        : "I need to verify that detail before I can give you an accurate answer. Please give me a moment while I confirm it for you.";
}

/**
 * createHumanPolicyReply
 * ----------------
 * Produces a neutral human-owned reply when an enabled tenant policy blocks the requested or proposed content.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function createHumanPolicyReply(language: ConversationLanguage): string
{
    return language === "zh-CN"
        ? "这个事项需要进一步核实并按我们的服务政策处理。我先帮您确认，确认后再给您准确回复。"
        : "I need to verify this and handle it under our service policy. I will confirm the details first and then give you an accurate response.";
}

/**
 * buildConversationSummary
 * ----------------
 * Builds a compact tenant-neutral handoff summary from the recent transcript and current customer question.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function buildConversationSummary(aggregate: AgentSuggestionAggregate): string
{
    const priorContext = aggregate.recentMessages
        .slice(-4)
        .map((message) =>
        {
            const speaker = aggregate.language === "zh-CN"
                ? message.senderType === "customer" ? "客户" : "客服"
                : message.senderType === "customer" ? "Customer" : "Service";
            return `${speaker}: ${message.text.replace(/\s+/gu, " ").trim().slice(0, 500)}`;
        });
    const current = aggregate.language === "zh-CN"
        ? `客户当前问题：${aggregate.question}`
        : `Current customer question: ${aggregate.question}`;

    return [...priorContext, current].join("\n").slice(0, 4000);
}

/**
 * buildNextStep
 * ----------------
 * Describes the human agent's next safe action according to the grounded suggestion outcome.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function buildNextStep(
    kind: AgentReplySuggestionKind,
    language: ConversationLanguage,
): string
{
    if (kind === "grounded_answer")
    {
        return language === "zh-CN"
            ? "核对引用资料，按需修改建议话术后由人工客服发送。"
            : "Review the cited knowledge, edit the suggested wording if needed, and send it as the human owner.";
    }

    return language === "zh-CN"
        ? "由人工客服继续核实信息；确认前不要作出未经资料支持的承诺。"
        : "Continue verification as the human owner and do not make unsupported commitments before confirmation.";
}

/**
 * readErrorCode
 * ----------------
 * Converts an internal failure into a bounded content-free diagnostic code for retry and audit records.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function readErrorCode(error: unknown): string
{
    return error instanceof ApiError
        ? error.code.slice(0, 120)
        : error instanceof Error
            ? error.name.slice(0, 120)
            : "UNKNOWN_ERROR";
}

/**
 * resolveOutputEvaluation
 * ----------------
 * Applies the same narrow direct-offering exception used by public chat when every supervisor violation is unsupported-claim only and citations directly support the answer.
 *
 * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
 */
function resolveOutputEvaluation(
    evaluation: GuardrailEvaluation,
    aggregate: AgentSuggestionAggregate,
    candidateAnswer: string,
    evidence: readonly { content: string }[],
): GuardrailEvaluation
{
    const unsupportedClaimOnly = evaluation.violations.length > 0
        && evaluation.violations.every((violation) =>
            aggregate.rules.some((rule) =>
                rule.code === violation.ruleCode
                && rule.ruleType === "unsupported_claim",
            ),
        );

    if (
        unsupportedClaimOnly
        && isDirectlyGroundedOfferingAnswer(
            aggregate.question,
            candidateAnswer,
            evidence,
        )
    )
    {
        return {
            allowed: true,
            requestHandoff: false,
            safeResponse: null,
            violations: [],
        };
    }

    return evaluation;
}

export class DefaultAgentAssistService implements AgentAssistService
{
    /**
     * DefaultAgentAssistService
     * ----------------
     * Creates an asynchronous tenant-grounded, guardrailed suggestion pipeline that never sends content to the customer automatically.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    public constructor(
        private readonly bindings: SmartServiceBindings,
        private readonly conversations: SupabaseConversationRepository,
        private readonly team: SupabaseTeamRepository,
        private readonly embeddings: EmbeddingProvider,
        private readonly answers: RagAnswerProvider,
        private readonly guardrails: GuardrailSupervisor,
    )
    {
    }

    /**
     * retrieveEvidence
     * ----------------
     * Runs the shared contextual, cross-language, per-part retrieval plan and returns only evidence relevant to the current customer turn.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    private async retrieveEvidence(
        aggregate: AgentSuggestionAggregate,
    ): Promise<{
        evidence: RetrievedEvidence[];
        focusedQuestions: string[];
        resultSets: RetrievedEvidence[][];
    }>
    {
        const threshold = parseThreshold(this.bindings);
        const focusedQuestions = buildRetrievalQuestions(
            aggregate.question,
            aggregate.recentMessages,
        );
        const retrievalQuestions = focusedQuestions.map((question) =>
            buildCrossLanguageRetrievalQuestion(question),
        );
        const vectors = await this.embeddings.embed(retrievalQuestions);

        if (vectors.length !== retrievalQuestions.length)
        {
            throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
        }

        const resultSets = await Promise.all(retrievalQuestions.map(async (question, index) =>
        {
            const vector = vectors[index];
            const focusedQuestion = focusedQuestions[index] ?? aggregate.question;

            if (vector === undefined)
            {
                throw new ApiError(502, "QUERY_EMBEDDING_INVALID", "The query embedding is not valid.");
            }

            let results = await this.conversations.retrieveEvidence(
                aggregate.organizationId,
                question,
                vector,
                threshold,
                getRetrievalCandidateLimit(focusedQuestion),
            );
            const recoveryLimit = getOrganizationProfileRecoveryLimit(focusedQuestion);

            if (results.length === 0 && recoveryLimit !== null)
            {
                results = await this.conversations.retrieveEvidence(
                    aggregate.organizationId,
                    question,
                    vector,
                    0,
                    recoveryLimit,
                );
            }

            return filterEvidenceForQuestionContext(
                focusedQuestions.length === 1 ? aggregate.question : focusedQuestion,
                aggregate.recentMessages,
                results,
            );
        }));

        return {
            evidence: mergeRetrievedEvidence(
                resultSets,
                Math.min(8, Math.max(3, focusedQuestions.length * 2)),
            ),
            focusedQuestions,
            resultSets,
        };
    }

    /**
     * createDraft
     * ----------------
     * Generates one evidence-bounded company-service draft and applies deterministic plus model guardrails before it can be shown to a human agent.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    private async createDraft(aggregate: AgentSuggestionAggregate): Promise<DraftResult>
    {
        const inputEvaluation = evaluateDeterministicGuardrails({
            candidateAnswer: null,
            evidence: [],
            language: aggregate.language,
            rules: aggregate.rules,
            userMessage: aggregate.question,
        });

        if (!inputEvaluation.allowed)
        {
            return {
                citations: [],
                draftText: createHumanPolicyReply(aggregate.language),
                inputTokens: null,
                kind: "policy_safe_reply",
                metadata: {
                    guardrailViolationCount: inputEvaluation.violations.length,
                    retrievalSkipped: true,
                },
                model: "deterministic-guardrail-v1",
                outputTokens: null,
                provider: "deterministic",
            };
        }

        const retrieval = await this.retrieveEvidence(aggregate);

        if (retrieval.evidence.length === 0)
        {
            return {
                citations: [],
                draftText: createHumanClarification(aggregate.language),
                inputTokens: null,
                kind: "clarifying_question",
                metadata: {
                    retrievalIntents: retrieval.focusedQuestions.map((question) =>
                        classifyRetrievalIntent(question),
                    ),
                    questionPartCount: retrieval.focusedQuestions.length,
                    retrievedEvidenceCount: 0,
                },
                model: "no-evidence-v3",
                outputTokens: null,
                provider: "retrieval-gate",
            };
        }

        const generationInput = {
            evidence: retrieval.evidence,
            language: aggregate.language,
            question: aggregate.question,
            questionPartEvidenceIds: buildQuestionPartEvidenceScope(
                retrieval.focusedQuestions,
                retrieval.resultSets,
                retrieval.evidence,
            ),
            questionParts: retrieval.focusedQuestions,
            recentMessages: aggregate.recentMessages,
        };
        const approvedManualAnswer = createApprovedManualAnswer(generationInput);
        const stableFactAnswer = retrieval.focusedQuestions.length === 1
            ? createExplicitStableFactAnswer(
                retrieval.focusedQuestions[0] ?? aggregate.question,
                retrieval.evidence,
                aggregate.language,
            )
            : null;
        let answer: RagAnswer;
        let inputTokens: number | null = null;
        let model = approvedManualAnswer !== null
            ? "approved-manual-v1"
            : stableFactAnswer !== null
                ? "stable-fact-v1"
                : this.answers.model;
        let outputTokens: number | null = null;
        let provider = approvedManualAnswer !== null || stableFactAnswer !== null
            ? "deterministic"
            : this.answers.provider;

        if (approvedManualAnswer !== null || stableFactAnswer !== null)
        {
            answer = approvedManualAnswer ?? stableFactAnswer as RagAnswer;
        }
        else
        {
            const generated = await this.answers.generate(generationInput);
            inputTokens = generated.inputTokens;
            model = generated.model;
            outputTokens = generated.outputTokens;
            provider = generated.provider;
            answer = generated.answer;
        }

        const validated = enforceCustomerControlledHandoff(
            validateGroundedAnswer(answer, retrieval.evidence, {
                language: aggregate.language,
                questionPartEvidenceIds: generationInput.questionPartEvidenceIds,
                questionParts: retrieval.focusedQuestions,
            }),
            aggregate.question,
            aggregate.language,
        );

        if (validated.decision !== "answer" || validated.citationChunkIds.length === 0)
        {
            return {
                citations: [],
                draftText: createHumanClarification(aggregate.language),
                inputTokens,
                kind: "clarifying_question",
                metadata: {
                    generatedDecision: validated.decision,
                    questionPartCount: retrieval.focusedQuestions.length,
                    retrievedEvidenceCount: retrieval.evidence.length,
                },
                model,
                outputTokens,
                provider,
            };
        }

        const citedEvidence = selectCitedGuardrailEvidence(
            retrieval.evidence,
            validated.citationChunkIds,
        );
        const deterministicEvaluation = evaluateDeterministicGuardrails({
            candidateAnswer: validated.answer,
            evidence: citedEvidence,
            language: aggregate.language,
            rules: aggregate.rules,
            userMessage: aggregate.question,
        });

        if (!deterministicEvaluation.allowed)
        {
            return {
                citations: [],
                draftText: createHumanPolicyReply(aggregate.language),
                inputTokens,
                kind: "policy_safe_reply",
                metadata: {
                    guardrailViolationCount: deterministicEvaluation.violations.length,
                    retrievedEvidenceCount: retrieval.evidence.length,
                },
                model,
                outputTokens,
                provider,
            };
        }

        const supervision = await this.guardrails.supervise({
            candidateAnswer: validated.answer,
            evidence: citedEvidence,
            language: aggregate.language,
            rules: aggregate.rules,
            userMessage: aggregate.question,
        });
        const supervisionEvaluation = resolveOutputEvaluation(
            supervision.evaluation,
            aggregate,
            validated.answer,
            citedEvidence,
        );

        if (!supervisionEvaluation.allowed)
        {
            return {
                citations: [],
                draftText: createHumanPolicyReply(aggregate.language),
                inputTokens,
                kind: "policy_safe_reply",
                metadata: {
                    guardrailInputTokens: supervision.inputTokens,
                    guardrailOutputTokens: supervision.outputTokens,
                    guardrailViolationCount: supervisionEvaluation.violations.length,
                    retrievedEvidenceCount: retrieval.evidence.length,
                },
                model,
                outputTokens,
                provider,
            };
        }

        return {
            citations: buildCitationWrites(
                validated.citationChunkIds,
                retrieval.evidence,
            ),
            draftText: validated.answer.slice(0, 1200),
            inputTokens,
            kind: "grounded_answer",
            metadata: {
                guardrailInputTokens: supervision.inputTokens,
                guardrailModel: this.guardrails.model,
                guardrailOutputTokens: supervision.outputTokens,
                guardrailProvider: this.guardrails.provider,
                questionPartCount: retrieval.focusedQuestions.length,
                retrievalIntents: retrieval.focusedQuestions.map((question) =>
                    classifyRetrievalIntent(question),
                ),
                retrievedEvidenceCount: retrieval.evidence.length,
            },
            model,
            outputTokens,
            provider,
        };
    }

    /**
     * process
     * ----------------
     * Reconciles one ID-only Queue command, discards stale work, and atomically persists a current suggestion with its approved citations and audit.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    public async process(
        message: AgentReplySuggestionMessage,
        requestId: string,
    ): Promise<{
        conversationId: string;
        status: "completed" | "stale";
        suggestionId: string;
    }>
    {
        const startedAt = Date.now();
        const aggregate = await this.team.loadAgentSuggestionAggregate(
            message.organizationId,
            message.conversationId,
            message.suggestionId,
            message.triggerMessageId,
        );

        if (aggregate === null)
        {
            return {
                conversationId: message.conversationId,
                status: "stale",
                suggestionId: message.suggestionId,
            };
        }

        try
        {
            const draft = await this.createDraft(aggregate);
            const completed = await this.team.completeAgentReplySuggestion({
                citations: draft.citations,
                conversationId: aggregate.conversationId,
                conversationSummary: buildConversationSummary(aggregate),
                currentIntent: aggregate.question.slice(0, 240),
                draftText: draft.draftText,
                inputTokens: draft.inputTokens,
                kind: draft.kind,
                latencyMs: Date.now() - startedAt,
                metadata: draft.metadata,
                model: draft.model,
                nextStep: buildNextStep(draft.kind, aggregate.language),
                organizationId: aggregate.organizationId,
                outputTokens: draft.outputTokens,
                promptVersion: agentAssistPromptVersion,
                provider: draft.provider,
                requestId,
                suggestionId: aggregate.suggestionId,
                triggerMessageId: aggregate.triggerMessageId,
            });

            return {
                conversationId: aggregate.conversationId,
                status: completed ? "completed" : "stale",
                suggestionId: aggregate.suggestionId,
            };
        }
        catch (error: unknown)
        {
            await this.team.failAgentReplySuggestion(
                aggregate.organizationId,
                aggregate.conversationId,
                aggregate.suggestionId,
                readErrorCode(error),
                this.answers.provider,
                this.answers.model,
                agentAssistPromptVersion,
                Date.now() - startedAt,
                requestId,
            );
            throw error;
        }
    }

    /**
     * schedule
     * ----------------
     * Creates one idempotent pending suggestion and publishes only identifiers, keeping customer-message acceptance independent from provider availability.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    public async schedule(
        organizationId: string,
        conversationId: string,
        triggerMessageId: string,
        requestId: string,
    ): Promise<void>
    {
        const startedAt = Date.now();

        try
        {
            const queued = await this.team.queueAgentReplySuggestion(
                organizationId,
                conversationId,
                triggerMessageId,
                requestId,
            );

            if (!queued.created)
            {
                return;
            }

            try
            {
                await this.bindings.FINALIZE_QUEUE.send({
                    conversationId,
                    organizationId,
                    suggestionId: queued.suggestionId,
                    triggerMessageId,
                    type: "agent.reply_suggest",
                    version: 1,
                }, {
                    contentType: "json",
                });
            }
            catch (error: unknown)
            {
                await this.team.failAgentReplySuggestion(
                    organizationId,
                    conversationId,
                    queued.suggestionId,
                    "AGENT_SUGGESTION_QUEUE_FAILED",
                    "cloudflare-queue",
                    "id-only-command-v1",
                    agentAssistPromptVersion,
                    Date.now() - startedAt,
                    requestId,
                );
                throw error;
            }
        }
        catch (error: unknown)
        {
            console.error(JSON.stringify({
                conversationId,
                errorCode: readErrorCode(error),
                event: "agent_reply_suggestion.schedule_failed",
                requestId,
            }));
        }
    }

    /**
     * scheduleLatest
     * ----------------
     * Schedules assistance for the authoritative latest customer turn when a human claims or reopens an existing handoff.
     *
     * August 07, 2026: Created by Forrest Zhang for SmartService R10 Human Agent Assistance
     */
    public async scheduleLatest(
        organizationId: string,
        conversationId: string,
        requestId: string,
    ): Promise<void>
    {
        try
        {
            const triggerMessageId = await this.team.getLatestCustomerMessageId(
                organizationId,
                conversationId,
            );

            if (triggerMessageId !== null)
            {
                await this.schedule(
                    organizationId,
                    conversationId,
                    triggerMessageId,
                    requestId,
                );
            }
        }
        catch (error: unknown)
        {
            console.error(JSON.stringify({
                conversationId,
                errorCode: readErrorCode(error),
                event: "agent_reply_suggestion.latest_schedule_failed",
                requestId,
            }));
        }
    }
}
