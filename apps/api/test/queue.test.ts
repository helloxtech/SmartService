import {
    IngestionPipelineError,
    type IngestionAggregate,
} from "@smartservice/ingestion";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/errors";
import { handleQueue } from "../src/queue";
import type {
    RuntimeServiceFactory,
    RuntimeServices,
    SmartServiceBindings,
} from "../src/types";

const aggregate: IngestionAggregate = {
    completedAt: null,
    crawlMaxDepth: 2,
    crawlMaxPages: 10,
    extractedObjectKey: null,
    jobId: "50000000-0000-4000-a000-000000000001",
    jobStatus: "uploaded",
    organizationId: "00000000-0000-4000-a000-000000000001",
    sourceId: "40000000-0000-4000-a000-000000000001",
    sourceStatus: "uploaded",
    sourceType: "url",
    sourceUrl: "https://example.com/",
    targetVersion: 1,
};

const body = {
    idempotencyKey: "crawl-policy-fixture",
    jobId: aggregate.jobId,
    organizationId: aggregate.organizationId,
    sourceId: aggregate.sourceId,
    type: "knowledge.ingest" as const,
    version: 1 as const,
};

describe("ingestion queue failure handling", () =>
{
    it("acknowledges a persisted terminal crawl-policy failure without retrying", async () =>
    {
        const ack = vi.fn();
        const retry = vi.fn();
        const fail = vi.fn().mockResolvedValue(undefined);
        const services = {
            crawl: {
                load: vi.fn().mockRejectedValue(new IngestionPipelineError(
                    "CRAWLER_POLICY_BLOCKED",
                    "The target website blocks this crawl.",
                    false,
                )),
            },
            embeddings: {
                embed: vi.fn(),
            },
            repository: {
                fail,
                findAggregate: vi.fn().mockResolvedValue(aggregate),
                markStage: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as RuntimeServices;

        await handleQueue({
            messages: [{
                ack,
                attempts: 1,
                body,
                id: "queue-message-terminal",
                retry,
            }],
        } as unknown as MessageBatch<unknown>, {} as SmartServiceBindings, (() => services) as RuntimeServiceFactory);

        expect(fail).toHaveBeenCalledWith(
            aggregate,
            "CRAWLER_POLICY_BLOCKED",
            "The target website blocks this crawl.",
        );
        expect(ack).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
    });

    it("retains bounded Queue retry for transient provider failures", async () =>
    {
        const ack = vi.fn();
        const retry = vi.fn();
        const services = {
            crawl: {
                load: vi.fn().mockRejectedValue(new ApiError(
                    502,
                    "CRAWLER_PROVIDER_FAILED",
                    "The website crawler request failed.",
                )),
            },
            embeddings: {
                embed: vi.fn(),
            },
            repository: {
                fail: vi.fn().mockResolvedValue(undefined),
                findAggregate: vi.fn().mockResolvedValue(aggregate),
                markStage: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as RuntimeServices;

        await handleQueue({
            messages: [{
                ack,
                attempts: 1,
                body,
                id: "queue-message-transient",
                retry,
            }],
        } as unknown as MessageBatch<unknown>, {} as SmartServiceBindings, (() => services) as RuntimeServiceFactory);

        expect(ack).not.toHaveBeenCalled();
        expect(retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    });
});
