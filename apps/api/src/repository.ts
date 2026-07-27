import {
    ingestionStatusSchema,
    knowledgeSourceSchema,
    knowledgeSourceTypeSchema,
    type IngestionStatus,
    type KnowledgeSource,
} from "@smartservice/contracts";
import type {
    IngestionAggregate,
    IngestionPlan,
} from "@smartservice/ingestion";
import { z } from "zod";

import { ApiError } from "./errors";
import { createServiceClient } from "./supabase";
import type {
    AdminIdentity,
    CreateIntakeInput,
    IntakeRecord,
    KnowledgeRepository,
    SmartServiceBindings,
} from "./types";

const intakeRecordSchema = z.object({
    job_id: z.uuid(),
    source_id: z.uuid(),
    status: ingestionStatusSchema,
});

const knowledgeSourceRowSchema = z.object({
    active_version: z.number().int().positive(),
    chunk_count: z.number().int().nonnegative(),
    crawl_max_depth: z.number().int().min(0).max(2).nullable(),
    crawl_max_pages: z.number().int().min(1).max(30).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    document_count: z.number().int().nonnegative(),
    enabled: z.boolean(),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    id: z.uuid(),
    name: z.string().min(1),
    page_count: z.number().int().nonnegative().nullable(),
    source_url: z.url().nullable(),
    standard_page_count: z.union([z.number(), z.string()]).nullable(),
    status: ingestionStatusSchema,
    type: knowledgeSourceTypeSchema,
    updated_at: z.iso.datetime({ offset: true }),
});

const ingestionJobRowSchema = z.object({
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    id: z.uuid(),
    organization_id: z.uuid(),
    source_id: z.uuid(),
    status: ingestionStatusSchema,
    target_version: z.number().int().positive(),
});

const aggregateSourceRowSchema = z.object({
    crawl_max_depth: z.number().int().min(0).max(2).nullable(),
    crawl_max_pages: z.number().int().min(1).max(30).nullable(),
    extracted_object_key: z.string().nullable(),
    id: z.uuid(),
    organization_id: z.uuid(),
    source_url: z.url().nullable(),
    status: ingestionStatusSchema,
    type: knowledgeSourceTypeSchema,
});

const objectKeysSchema = z.object({
    extracted_object_key: z.string().nullable(),
    original_object_key: z.string().nullable(),
});

/**
 * normalizeStandardPageCount
 * ----------------
 * Converts PostgreSQL numeric output into the bounded number used by the public contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function normalizeStandardPageCount(value: number | string | null): number | null
{
    if (value === null)
    {
        return null;
    }

    const parsed = typeof value === "number" ? value : Number.parseFloat(value);

    if (!Number.isFinite(parsed))
    {
        throw new ApiError(500, "DATABASE_SHAPE_INVALID", "Stored knowledge data was not valid.");
    }

    return parsed;
}

/**
 * mapKnowledgeSource
 * ----------------
 * Maps a validated database row to the stable camel-case API contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function mapKnowledgeSource(input: unknown): KnowledgeSource
{
    const row = knowledgeSourceRowSchema.parse(input);

    return knowledgeSourceSchema.parse({
        activeVersion: row.active_version,
        chunkCount: row.chunk_count,
        crawlMaxDepth: row.crawl_max_depth,
        crawlMaxPages: row.crawl_max_pages,
        createdAt: row.created_at,
        documentCount: row.document_count,
        enabled: row.enabled,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        id: row.id,
        name: row.name,
        pageCount: row.page_count,
        sourceUrl: row.source_url,
        standardPageCount: normalizeStandardPageCount(row.standard_page_count),
        status: row.status,
        type: row.type,
        updatedAt: row.updated_at,
    });
}

/**
 * mapIntakeRecord
 * ----------------
 * Validates an RPC result and narrows it to statuses returned by intake operations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function mapIntakeRecord(input: unknown): IntakeRecord
{
    const record = intakeRecordSchema.parse(input);

    if (record.status === "disabled")
    {
        throw new ApiError(500, "DATABASE_SHAPE_INVALID", "An intake cannot begin disabled.");
    }

    return {
        jobId: record.job_id,
        sourceId: record.source_id,
        status: record.status,
    };
}

/**
 * vectorToPostgres
 * ----------------
 * Serializes one validated numeric vector for the pgvector input parser.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function vectorToPostgres(vector: number[] | undefined): string
{
    if (
        vector === undefined
        || vector.length !== 1024
        || vector.some((value) => !Number.isFinite(value))
    )
    {
        throw new ApiError(500, "EMBEDDING_INVALID", "A complete 1024-dimension embedding is required.");
    }

    return `[${vector.join(",")}]`;
}

export class SupabaseKnowledgeRepository implements KnowledgeRepository
{
    /**
     * SupabaseKnowledgeRepository
     * ----------------
     * Creates a service-role repository from server-only Supabase bindings.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * complete
     * ----------------
     * Commits a deterministic ingestion plan through one service-role database transaction.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async complete(aggregate: IngestionAggregate, plan: IngestionPlan): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const documents = plan.documents.map((document) => ({
            canonical_url: document.canonicalUrl,
            content_hash: document.contentHash,
            id: document.id,
            metadata: document.metadata,
            title: document.title,
        }));
        const chunks = plan.chunks.map((chunk) => ({
            chunk_index: chunk.index,
            content: chunk.content,
            content_hash: chunk.contentHash,
            document_id: chunk.documentId,
            embedding: vectorToPostgres(chunk.embedding),
            id: chunk.id,
            metadata: chunk.metadata,
            source_locator: chunk.sourceLocator,
        }));
        const { error } = await client.rpc("complete_knowledge_ingestion", {
            p_chunks: chunks,
            p_documents: documents,
            p_job_id: aggregate.jobId,
        });

        if (error !== null)
        {
            throw new ApiError(
                503,
                "INGESTION_COMMIT_FAILED",
                "The processed knowledge could not be committed.",
            );
        }
    }

    /**
     * createIntake
     * ----------------
     * Atomically creates a tenant-owned source and idempotent ingestion job after upstream validation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async createIntake(input: CreateIntakeInput): Promise<IntakeRecord>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("create_knowledge_ingestion", {
            p_created_by: input.createdBy,
            p_crawl_max_depth: input.crawlMaxDepth,
            p_crawl_max_pages: input.crawlMaxPages,
            p_extracted_object_key: input.extractedObjectKey,
            p_idempotency_key: input.idempotencyKey,
            p_name: input.name,
            p_organization_id: input.organizationId,
            p_original_object_key: input.originalObjectKey,
            p_page_count: input.pageCount,
            p_request_id: input.requestId,
            p_source_type: input.sourceType,
            p_source_url: input.sourceUrl,
            p_standard_page_count: input.standardPageCount,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(503, "INTAKE_CREATE_FAILED", "The ingestion job could not be created.");
        }

        return mapIntakeRecord(data[0]);
    }

    /**
     * fail
     * ----------------
     * Persists a bounded queue failure without replacing an already completed result.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async fail(
        aggregate: IngestionAggregate,
        code: string,
        message: string,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("fail_knowledge_ingestion", {
            p_error_code: code,
            p_error_message: message,
            p_job_id: aggregate.jobId,
        });

        if (error !== null)
        {
            console.error(JSON.stringify({
                event: "ingestion.failure.persistence_failed",
                jobId: aggregate.jobId,
            }));
        }
    }

    /**
     * findAggregate
     * ----------------
     * Rehydrates the authoritative job and source rows used to distrust Queue routing fields.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async findAggregate(jobId: string): Promise<IngestionAggregate | null>
    {
        const client = createServiceClient(this.bindings);
        const { data: jobData, error: jobError } = await client
            .from("ingestion_jobs")
            .select("id, organization_id, source_id, status, target_version, completed_at")
            .eq("id", jobId)
            .maybeSingle();

        if (jobError !== null)
        {
            throw new ApiError(503, "INGESTION_JOB_LOOKUP_FAILED", "The ingestion job could not be loaded.");
        }

        if (jobData === null)
        {
            return null;
        }

        const job = ingestionJobRowSchema.parse(jobData);
        const { data: sourceData, error: sourceError } = await client
            .from("knowledge_sources")
            .select(
                "id, organization_id, type, status, source_url, extracted_object_key, crawl_max_pages, crawl_max_depth",
            )
            .eq("id", job.source_id)
            .eq("organization_id", job.organization_id)
            .maybeSingle();

        if (sourceError !== null || sourceData === null)
        {
            throw new ApiError(503, "KNOWLEDGE_SOURCE_LOOKUP_FAILED", "The knowledge source could not be loaded.");
        }

        const source = aggregateSourceRowSchema.parse(sourceData);

        return {
            completedAt: job.completed_at,
            crawlMaxDepth: source.crawl_max_depth,
            crawlMaxPages: source.crawl_max_pages,
            extractedObjectKey: source.extracted_object_key,
            jobId: job.id,
            jobStatus: job.status,
            organizationId: job.organization_id,
            sourceId: job.source_id,
            sourceStatus: source.status,
            sourceType: source.type,
            sourceUrl: source.source_url,
            targetVersion: job.target_version,
        };
    }

    /**
     * getSource
     * ----------------
     * Loads one nondeleted source inside the already authenticated organization boundary.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async getSource(
        organizationId: string,
        sourceId: string,
    ): Promise<KnowledgeSource | null>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("knowledge_sources")
            .select(
                "id, type, name, source_url, status, active_version, page_count, standard_page_count, document_count, chunk_count, error_code, error_message, enabled, crawl_max_pages, crawl_max_depth, created_at, updated_at",
            )
            .eq("organization_id", organizationId)
            .eq("id", sourceId)
            .is("deleted_at", null)
            .maybeSingle();

        if (error !== null)
        {
            throw new ApiError(503, "KNOWLEDGE_SOURCE_LOOKUP_FAILED", "The knowledge source could not be loaded.");
        }

        return data === null ? null : mapKnowledgeSource(data);
    }

    /**
     * listSources
     * ----------------
     * Lists only nondeleted sources in the authenticated organization, newest first.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async listSources(organizationId: string): Promise<KnowledgeSource[]>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client
            .from("knowledge_sources")
            .select(
                "id, type, name, source_url, status, active_version, page_count, standard_page_count, document_count, chunk_count, error_code, error_message, enabled, crawl_max_pages, crawl_max_depth, created_at, updated_at",
            )
            .eq("organization_id", organizationId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error !== null)
        {
            throw new ApiError(503, "KNOWLEDGE_SOURCE_LIST_FAILED", "Knowledge sources could not be loaded.");
        }

        return (data ?? []).map(mapKnowledgeSource);
    }

    /**
     * manageSource
     * ----------------
     * Applies disable, enable, or soft-delete semantics and returns storage keys needed for post-delete cleanup.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async manageSource(
        identity: AdminIdentity,
        sourceId: string,
        action: "delete" | "disable" | "enable",
        requestId: string,
    ): Promise<{ extractedObjectKey: string | null; originalObjectKey: string | null }>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("manage_knowledge_source", {
            p_action: action,
            p_actor_user_id: identity.userId,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
            p_source_id: sourceId,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "SOURCE_ACTION_FAILED", "The knowledge-source action could not be applied.");
        }

        const keys = objectKeysSchema.parse(data[0]);

        return {
            extractedObjectKey: keys.extracted_object_key,
            originalObjectKey: keys.original_object_key,
        };
    }

    /**
     * markStage
     * ----------------
     * Persists an ordered processing stage and bounded progress before the atomic completion step.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async markStage(
        aggregate: IngestionAggregate,
        status: Exclude<IngestionStatus, "disabled" | "failed" | "ready" | "uploaded">,
        progressPercent: number,
    ): Promise<void>
    {
        const client = createServiceClient(this.bindings);
        const { error } = await client.rpc("set_knowledge_ingestion_stage", {
            p_job_id: aggregate.jobId,
            p_progress_percent: progressPercent,
            p_status: status,
        });

        if (error !== null)
        {
            throw new ApiError(503, "INGESTION_STAGE_FAILED", "The ingestion stage could not be recorded.");
        }
    }

    /**
     * retry
     * ----------------
     * Creates an idempotent reprocessing job whose target version advances only from a ready source.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async retry(
        identity: AdminIdentity,
        sourceId: string,
        idempotencyKey: string,
        requestId: string,
    ): Promise<IntakeRecord>
    {
        const client = createServiceClient(this.bindings);
        const { data, error } = await client.rpc("retry_knowledge_ingestion", {
            p_created_by: identity.userId,
            p_idempotency_key: idempotencyKey,
            p_organization_id: identity.organizationId,
            p_request_id: requestId,
            p_source_id: sourceId,
        });

        if (error !== null || data === null || data.length !== 1)
        {
            throw new ApiError(409, "SOURCE_RETRY_FAILED", "The source cannot be reprocessed in its current state.");
        }

        return mapIntakeRecord(data[0]);
    }
}
