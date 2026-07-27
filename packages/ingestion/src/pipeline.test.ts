import type { ExtractedKnowledgePayload, KnowledgeIngestMessage } from "@smartservice/contracts";
import { describe, expect, it } from "vitest";

import { DeterministicEmbeddingProvider } from "./mock-embeddings";
import {
    processIngestionMessage,
    type ExtractedPayloadProvider,
    type IngestionAggregate,
    type IngestionRepository,
} from "./pipeline";
import type { IngestionPlan } from "./chunking";

class MemoryRepository implements IngestionRepository
{
    public completedPlan: IngestionPlan | null = null;
    public failedCode: string | null = null;
    public readonly stages: string[] = [];

    /**
     * MemoryRepository
     * ----------------
     * Creates a mutable in-memory ingestion aggregate for deterministic pipeline tests.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly aggregate: IngestionAggregate)
    {
    }

    /**
     * complete
     * ----------------
     * Records the final plan and marks the in-memory job complete for duplicate-delivery verification.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async complete(_aggregate: IngestionAggregate, plan: IngestionPlan): Promise<void>
    {
        this.completedPlan = structuredClone(plan);
        this.aggregate.completedAt = new Date().toISOString();
        this.aggregate.jobStatus = "ready";
    }

    /**
     * fail
     * ----------------
     * Records a bounded failure code for assertion.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async fail(
        _aggregate: IngestionAggregate,
        code: string,
    ): Promise<void>
    {
        this.failedCode = code;
    }

    /**
     * findAggregate
     * ----------------
     * Returns the service-authoritative ingestion aggregate.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async findAggregate(jobId: string): Promise<IngestionAggregate | null>
    {
        return jobId === this.aggregate.jobId ? this.aggregate : null;
    }

    /**
     * markStage
     * ----------------
     * Records ordered stage changes without an external database.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async markStage(
        _aggregate: IngestionAggregate,
        status: "extracting" | "chunking" | "embedding",
    ): Promise<void>
    {
        this.stages.push(status);
    }
}

/**
 * createPayloadProvider
 * ----------------
 * Creates a deterministic extracted-payload provider for queue-pipeline tests.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createPayloadProvider(payload: ExtractedKnowledgePayload): ExtractedPayloadProvider
{
    return {
        /**
         * load
         * ----------------
         * Returns the fixed payload without storage or crawler access.
         *
         * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
         */
        async load(): Promise<ExtractedKnowledgePayload>
        {
            return payload;
        },
    };
}

describe("ingestion queue pipeline", () =>
{
    it("processes once and treats a duplicate queue delivery as a no-op", async () =>
    {
        const aggregate: IngestionAggregate = {
            completedAt: null,
            crawlMaxDepth: null,
            crawlMaxPages: null,
            extractedObjectKey: "org/a/extracted.json",
            jobId: "50000000-0000-4000-a000-000000000001",
            jobStatus: "uploaded",
            organizationId: "00000000-0000-4000-a000-000000000001",
            sourceId: "40000000-0000-4000-a000-000000000001",
            sourceStatus: "uploaded",
            sourceType: "pdf",
            sourceUrl: null,
            targetVersion: 1,
        };
        const repository = new MemoryRepository(aggregate);
        const payload: ExtractedKnowledgePayload = {
            documents: [{
                sections: [{
                    heading: "Operating limits",
                    pageEnd: 1,
                    pageStart: 1,
                    text: "The NF-500 maximum flow is a fictional 500 litres per minute.",
                }],
                title: "NF-Series Manual",
            }],
            fileName: "manual.pdf",
            pageCount: 1,
            schemaVersion: 1,
            sourceType: "pdf",
            standardPageCount: 0.03,
            title: "NF-Series Manual",
        };
        const message: KnowledgeIngestMessage = {
            idempotencyKey: "fixture-ingestion-001",
            inputObjectKey: "org/a/extracted.json",
            jobId: aggregate.jobId,
            organizationId: aggregate.organizationId,
            sourceId: aggregate.sourceId,
            type: "knowledge.ingest",
            version: 1,
        };
        const dependencies = {
            embeddings: new DeterministicEmbeddingProvider(),
            payloads: createPayloadProvider(payload),
            repository,
        };

        await expect(processIngestionMessage(message, dependencies)).resolves.toBe("processed");
        await expect(processIngestionMessage(message, dependencies)).resolves.toBe("duplicate");

        expect(repository.stages).toEqual(["extracting", "chunking", "embedding"]);
        expect(repository.completedPlan?.chunks).toHaveLength(1);
        expect(repository.completedPlan?.chunks[0]?.embedding).toHaveLength(1024);
        expect(repository.failedCode).toBeNull();
    });

    it("does not trust the organization ID carried by the queue message", async () =>
    {
        const aggregate: IngestionAggregate = {
            completedAt: null,
            crawlMaxDepth: null,
            crawlMaxPages: null,
            extractedObjectKey: "org/a/extracted.json",
            jobId: "50000000-0000-4000-a000-000000000002",
            jobStatus: "uploaded",
            organizationId: "00000000-0000-4000-a000-000000000001",
            sourceId: "40000000-0000-4000-a000-000000000002",
            sourceStatus: "uploaded",
            sourceType: "pdf",
            sourceUrl: null,
            targetVersion: 1,
        };
        const repository = new MemoryRepository(aggregate);

        await expect(processIngestionMessage({
            idempotencyKey: "fixture-ingestion-002",
            inputObjectKey: aggregate.extractedObjectKey,
            jobId: aggregate.jobId,
            organizationId: "00000000-0000-4000-a000-000000000002",
            sourceId: aggregate.sourceId,
            type: "knowledge.ingest",
            version: 1,
        }, {
            embeddings: new DeterministicEmbeddingProvider(),
            payloads: createPayloadProvider({
                documents: [],
                schemaVersion: 1,
                sourceType: "pdf",
                standardPageCount: 1,
                title: "unused",
            }),
            repository,
        })).rejects.toMatchObject({
            code: "QUEUE_TENANT_MISMATCH",
        });

        expect(repository.completedPlan).toBeNull();
        expect(repository.failedCode).toBe("QUEUE_TENANT_MISMATCH");
    });
});
