import {
    extractedKnowledgePayloadSchema,
    knowledgeIngestMessageSchema,
    type ExtractedKnowledgePayload,
    type IngestionStatus,
    type KnowledgeIngestMessage,
    type KnowledgeSourceType,
} from "@smartservice/contracts";

import { buildIngestionPlan, type IngestionPlan } from "./chunking";

export interface IngestionAggregate
{
    completedAt: string | null;
    crawlMaxDepth: number | null;
    crawlMaxPages: number | null;
    extractedObjectKey: string | null;
    jobId: string;
    jobStatus: IngestionStatus;
    organizationId: string;
    sourceId: string;
    sourceStatus: IngestionStatus;
    sourceType: KnowledgeSourceType;
    sourceUrl: string | null;
    targetVersion: number;
}

export interface EmbeddingProvider
{
    embed(texts: string[]): Promise<number[][]>;
}

export interface ExtractedPayloadProvider
{
    load(aggregate: IngestionAggregate): Promise<ExtractedKnowledgePayload>;
}

export interface IngestionRepository
{
    complete(aggregate: IngestionAggregate, plan: IngestionPlan): Promise<void>;
    fail(aggregate: IngestionAggregate, code: string, message: string): Promise<void>;
    findAggregate(jobId: string): Promise<IngestionAggregate | null>;
    markStage(
        aggregate: IngestionAggregate,
        status: Exclude<IngestionStatus, "disabled" | "failed" | "ready" | "uploaded">,
        progressPercent: number,
    ): Promise<void>;
}

export interface IngestionPipelineDependencies
{
    embeddings: EmbeddingProvider;
    payloads: ExtractedPayloadProvider;
    repository: IngestionRepository;
}

export type IngestionProcessResult = "duplicate" | "processed";

export class IngestionPipelineError extends Error
{
    public readonly code: string;

    /**
     * IngestionPipelineError
     * ----------------
     * Creates a stable pipeline failure that can be logged and persisted without leaking provider response bodies.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(code: string, message: string)
    {
        super(message);
        this.code = code;
        this.name = "IngestionPipelineError";
    }
}

/**
 * describePipelineFailure
 * ----------------
 * Converts an unknown queue failure into a bounded code and operator-facing message.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function describePipelineFailure(error: unknown): { code: string; message: string }
{
    if (error instanceof IngestionPipelineError)
    {
        return {
            code: error.code,
            message: error.message,
        };
    }

    return {
        code: "INGESTION_FAILED",
        message: "Knowledge processing failed. Retry the source or review Worker logs.",
    };
}

/**
 * validateMessageAgainstAggregate
 * ----------------
 * Reconciles untrusted Queue routing fields against the service-role database object before any processing.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function validateMessageAgainstAggregate(
    message: KnowledgeIngestMessage,
    aggregate: IngestionAggregate,
): void
{
    if (
        message.organizationId !== aggregate.organizationId
        || message.sourceId !== aggregate.sourceId
        || message.jobId !== aggregate.jobId
    )
    {
        throw new IngestionPipelineError(
            "QUEUE_TENANT_MISMATCH",
            "The queue message did not match the stored ingestion job.",
        );
    }

    if (
        message.inputObjectKey !== undefined
        && message.inputObjectKey !== aggregate.extractedObjectKey
    )
    {
        throw new IngestionPipelineError(
            "QUEUE_OBJECT_MISMATCH",
            "The queue object key did not match the stored ingestion job.",
        );
    }
}

/**
 * attachEmbeddings
 * ----------------
 * Batches embedding calls and verifies every 1024-dimension vector before database commit.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function attachEmbeddings(
    plan: IngestionPlan,
    embeddings: EmbeddingProvider,
): Promise<void>
{
    const batchSize = 32;

    for (let index = 0; index < plan.chunks.length; index += batchSize)
    {
        const batch = plan.chunks.slice(index, index + batchSize);
        const vectors = await embeddings.embed(batch.map((chunk) => chunk.content));

        if (vectors.length !== batch.length)
        {
            throw new IngestionPipelineError(
                "EMBEDDING_COUNT_MISMATCH",
                "The embedding provider returned an unexpected result count.",
            );
        }

        for (let offset = 0; offset < batch.length; offset += 1)
        {
            const chunk = batch[offset];
            const vector = vectors[offset];

            if (chunk === undefined || vector === undefined || vector.length !== 1024)
            {
                throw new IngestionPipelineError(
                    "EMBEDDING_DIMENSION_MISMATCH",
                    "The embedding provider must return 1024-dimension vectors.",
                );
            }

            chunk.embedding = vector;
        }
    }
}

/**
 * processIngestionMessage
 * ----------------
 * Runs one idempotent ingestion job from validated stored input through chunking, embedding, and atomic completion.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function processIngestionMessage(
    input: unknown,
    dependencies: IngestionPipelineDependencies,
): Promise<IngestionProcessResult>
{
    const message = knowledgeIngestMessageSchema.parse(input);
    const aggregate = await dependencies.repository.findAggregate(message.jobId);

    if (aggregate === null)
    {
        throw new IngestionPipelineError("INGESTION_JOB_NOT_FOUND", "The ingestion job does not exist.");
    }

    try
    {
        validateMessageAgainstAggregate(message, aggregate);

        if (aggregate.completedAt !== null || aggregate.jobStatus === "ready")
        {
            return "duplicate";
        }

        await dependencies.repository.markStage(aggregate, "extracting", 15);
        const payload = extractedKnowledgePayloadSchema.parse(
            await dependencies.payloads.load(aggregate),
        );

        if (payload.sourceType !== aggregate.sourceType)
        {
            throw new IngestionPipelineError(
                "SOURCE_TYPE_MISMATCH",
                "The extracted payload did not match the stored source type.",
            );
        }

        await dependencies.repository.markStage(aggregate, "chunking", 45);
        const plan = await buildIngestionPlan(
            aggregate.organizationId,
            aggregate.sourceId,
            aggregate.targetVersion,
            payload,
        );

        await dependencies.repository.markStage(aggregate, "embedding", 70);
        await attachEmbeddings(plan, dependencies.embeddings);
        await dependencies.repository.complete(aggregate, plan);

        return "processed";
    }
    catch (error: unknown)
    {
        const failure = describePipelineFailure(error);
        await dependencies.repository.fail(aggregate, failure.code, failure.message);
        throw error;
    }
}
