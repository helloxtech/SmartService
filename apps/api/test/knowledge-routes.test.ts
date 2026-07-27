import {
    docxMimeType,
    extractedJsonMimeType,
    fileUploadIntentResponseSchema,
    intakeResponseSchema,
    knowledgeSourceListResponseSchema,
    pdfMimeType,
    type ExtractedKnowledgePayload,
    type KnowledgeIngestMessage,
    type KnowledgeSource,
} from "@smartservice/contracts";
import type { IngestionAggregate } from "@smartservice/ingestion";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { ApiError } from "../src/errors";
import { MockR2UploadIntentProvider } from "../src/storage";
import type {
    AdminIdentity,
    RuntimeServices,
    SmartServiceBindings,
    UploadObjectExpectation,
} from "../src/types";

const adminIdentity: AdminIdentity = {
    organizationId: "00000000-0000-4000-a000-000000000001",
    role: "admin",
    userId: "10000000-0000-4000-a000-000000000001",
};

const source: KnowledgeSource = {
    activeVersion: 1,
    chunkCount: 0,
    crawlMaxDepth: null,
    crawlMaxPages: null,
    createdAt: "2026-07-26T12:00:00.000Z",
    documentCount: 0,
    enabled: true,
    errorCode: null,
    errorMessage: null,
    id: "40000000-0000-4000-a000-000000000001",
    name: "manual.pdf",
    pageCount: 1,
    sourceUrl: null,
    standardPageCount: 0.1,
    status: "uploaded",
    type: "pdf",
    updatedAt: "2026-07-26T12:00:00.000Z",
};

const extractedPayload: ExtractedKnowledgePayload = {
    documents: [{
        sections: [{
            heading: "Page 1",
            pageEnd: 1,
            pageStart: 1,
            text: "The fictional NovaFlow NF-500 has documented operating limits.",
        }],
        title: "manual.pdf",
    }],
    fileName: "manual.pdf",
    pageCount: 1,
    schemaVersion: 1,
    sourceType: "pdf",
    standardPageCount: 0.1,
    title: "manual.pdf",
};

/**
 * createTestServices
 * ----------------
 * Creates isolated zero-network service doubles for authenticated knowledge-route tests.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createTestServices(): RuntimeServices
{
    const aggregate: IngestionAggregate = {
        completedAt: null,
        crawlMaxDepth: null,
        crawlMaxPages: null,
        extractedObjectKey: `${adminIdentity.organizationId}/extracted.json`,
        jobId: "50000000-0000-4000-a000-000000000001",
        jobStatus: "uploaded",
        organizationId: adminIdentity.organizationId,
        sourceId: source.id,
        sourceStatus: "uploaded",
        sourceType: "pdf",
        sourceUrl: null,
        targetVersion: 1,
    };

    return {
        authenticateAdmin: vi.fn().mockResolvedValue(adminIdentity),
        authenticateMember: vi.fn().mockResolvedValue(adminIdentity),
        crawl: {
            load: vi.fn().mockResolvedValue(extractedPayload),
        },
        dnsResolver: {
            resolve: vi.fn().mockResolvedValue(["93.184.216.34"]),
        },
        embeddings: {
            embed: vi.fn().mockResolvedValue([Array.from({ length: 1024 }, () => 0.01)]),
        },
        finalizer: {
            finalize: vi.fn(),
            model: "deterministic-finalization-v1",
            provider: "deterministic",
        },
        finalizeQueue: {
            send: vi.fn().mockResolvedValue(undefined),
            sendBatch: vi.fn().mockResolvedValue(undefined),
        } as unknown as RuntimeServices["finalizeQueue"],
        guardrails: {
            model: "deterministic-guardrail-v1",
            provider: "deterministic",
            supervise: vi.fn(),
        },
        objects: {
            delete: vi.fn().mockResolvedValue(undefined),
            getJson: vi.fn().mockResolvedValue(extractedPayload),
            putMockUpload: vi.fn().mockResolvedValue(undefined),
            verify: vi.fn().mockImplementation(
                (_key: string, expectation: UploadObjectExpectation) =>
                {
                    const body = expectation.contentType === pdfMimeType
                        ? new TextEncoder().encode("%PDF-1.7").buffer
                        : new Uint8Array([
                            0x50,
                            0x4B,
                            0x03,
                            0x04,
                            0x00,
                            0x00,
                            0x00,
                            0x00,
                        ]).buffer;

                    return Promise.resolve({
                        body,
                        contentSha256: "a".repeat(64),
                        contentType: expectation.contentType,
                        sizeBytes: 8,
                    });
                },
            ),
        },
        publicConversations: {
            create: vi.fn(),
            list: vi.fn(),
            requestHandoff: vi.fn(),
            send: vi.fn(),
        },
        queue: {
            send: vi.fn().mockResolvedValue(undefined),
            sendBatch: vi.fn().mockResolvedValue(undefined),
        } as unknown as Queue<KnowledgeIngestMessage>,
        repository: {
            complete: vi.fn().mockResolvedValue(undefined),
            createIntake: vi.fn().mockResolvedValue({
                jobId: aggregate.jobId,
                sourceId: aggregate.sourceId,
                status: "uploaded",
            }),
            fail: vi.fn().mockResolvedValue(undefined),
            findAggregate: vi.fn().mockResolvedValue(aggregate),
            getSource: vi.fn().mockResolvedValue(source),
            listSources: vi.fn().mockResolvedValue([source]),
            manageSource: vi.fn().mockResolvedValue({
                extractedObjectKey: null,
                originalObjectKey: null,
            }),
            markStage: vi.fn().mockResolvedValue(undefined),
            retry: vi.fn().mockResolvedValue({
                jobId: aggregate.jobId,
                sourceId: aggregate.sourceId,
                status: "uploaded",
            }),
        },
        team: {} as RuntimeServices["team"],
        uploads: {
            create: vi.fn().mockResolvedValue({
                expiresAt: "2026-07-26T12:05:00.000Z",
                objectKey: `org/${adminIdentity.organizationId}/uploads/original/manual.pdf`,
                requiredHeaders: {
                    "content-type": pdfMimeType,
                },
                uploadUrl: "https://example.invalid/signed-upload",
            }),
        },
    };
}

/**
 * requestApp
 * ----------------
 * Dispatches a request through a Hono app using the supplied service doubles and a nonsecret empty binding object.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function requestApp(
    services: RuntimeServices,
    path: string,
    init?: RequestInit,
): Promise<Response>
{
    const app = createApp(() => services);

    return app.request(
        `https://smartservice.test${path}`,
        init,
        {} as SmartServiceBindings,
    );
}

describe("knowledge routes", () =>
{
    it("creates a validated single-object upload intent", async () =>
    {
        const services = createTestServices();
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/file-upload-intents",
            {
                body: JSON.stringify({
                    contentSha256: "a".repeat(64),
                    fileName: "manual.pdf",
                    kind: "original",
                    mimeType: pdfMimeType,
                    sizeBytes: 8,
                }),
                headers: {
                    authorization: "Bearer test-session",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(201);
        expect(fileUploadIntentResponseSchema.parse(body).objectKey)
            .toContain(adminIdentity.organizationId);
        expect(services.authenticateAdmin).toHaveBeenCalledOnce();
    });

    it("rejects Agent mutation before creating an upload authorization", async () =>
    {
        const services = createTestServices();
        services.authenticateAdmin = vi.fn().mockRejectedValue(
            new ApiError(403, "ADMIN_REQUIRED", "An organization Admin role is required."),
        );
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/file-upload-intents",
            {
                body: JSON.stringify({
                    contentSha256: "a".repeat(64),
                    fileName: "manual.pdf",
                    kind: "original",
                    mimeType: pdfMimeType,
                    sizeBytes: 8,
                }),
                headers: {
                    authorization: "Bearer agent-session",
                    "content-type": "application/json",
                },
                method: "POST",
            },
        );

        expect(response.status).toBe(403);
        expect(services.uploads.create).not.toHaveBeenCalled();
    });

    it("verifies both objects and queues a small tenant-routed file intake", async () =>
    {
        const services = createTestServices();
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/file-intakes",
            {
                body: JSON.stringify({
                    extractedObjectKey: `org/${adminIdentity.organizationId}/uploads/extracted/manual.json`,
                    fileName: "manual.pdf",
                    mimeType: pdfMimeType,
                    originalObjectKey: `org/${adminIdentity.organizationId}/uploads/original/manual.pdf`,
                    pageCount: 1,
                    sizeBytes: 8,
                    standardPageCount: 0.1,
                }),
                headers: {
                    authorization: "Bearer test-session",
                    "content-type": "application/json",
                    "idempotency-key": "file-intake-fixture",
                },
                method: "POST",
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(202);
        expect(intakeResponseSchema.parse(body).status).toBe("uploaded");
        expect(services.objects.verify).toHaveBeenCalledOnce();
        expect(services.objects.getJson).toHaveBeenCalledOnce();
        expect(services.queue.send).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: adminIdentity.organizationId,
                type: "knowledge.ingest",
            }),
            { contentType: "json" },
        );
    });

    it("rejects private URL DNS before creating a source or Queue message", async () =>
    {
        const services = createTestServices();
        services.dnsResolver.resolve = vi.fn().mockResolvedValue(["169.254.169.254"]);
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/url-intakes",
            {
                body: JSON.stringify({
                    maxDepth: 2,
                    maxPages: 10,
                    url: "https://example.com",
                }),
                headers: {
                    authorization: "Bearer test-session",
                    "content-type": "application/json",
                    "idempotency-key": "url-intake-fixture",
                },
                method: "POST",
            },
        );
        const body = await response.json() as {
            error: { code: string };
        };

        expect(response.status).toBe(422);
        expect(body.error.code).toBe("URL_PRIVATE_ADDRESS");
        expect(services.repository.createIntake).not.toHaveBeenCalled();
        expect(services.queue.send).not.toHaveBeenCalled();
    });

    it("allows a member to list only repository-scoped sources", async () =>
    {
        const services = createTestServices();
        const response = await requestApp(
            services,
            "/v1/admin/knowledge/sources",
            {
                headers: {
                    authorization: "Bearer test-session",
                },
            },
        );
        const body: unknown = await response.json();

        expect(response.status).toBe(200);
        expect(knowledgeSourceListResponseSchema.parse(body).sources).toHaveLength(1);
        expect(services.repository.listSources)
            .toHaveBeenCalledWith(adminIdentity.organizationId);
    });

    it("rejects mismatched original/extracted file types before queueing", async () =>
    {
        const services = createTestServices();
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/file-intakes",
            {
                body: JSON.stringify({
                    extractedObjectKey: `org/${adminIdentity.organizationId}/uploads/extracted/manual.json`,
                    fileName: "manual.pdf",
                    mimeType: docxMimeType,
                    originalObjectKey: `org/${adminIdentity.organizationId}/uploads/original/manual.docx`,
                    sizeBytes: 8,
                    standardPageCount: 0.1,
                }),
                headers: {
                    authorization: "Bearer test-session",
                    "content-type": extractedJsonMimeType,
                    "idempotency-key": "mismatch-fixture",
                },
                method: "POST",
            },
        );

        expect(response.status).toBe(422);
        expect(services.queue.send).not.toHaveBeenCalled();
    });

    it("rejects an original object whose bytes do not match its declared document type", async () =>
    {
        const services = createTestServices();
        services.objects.verify = vi.fn().mockResolvedValue({
            body: new ArrayBuffer(8),
            contentSha256: "a".repeat(64),
            contentType: pdfMimeType,
            sizeBytes: 8,
        });
        const response = await requestApp(
            services,
            "/api/v1/admin/knowledge/file-intakes",
            {
                body: JSON.stringify({
                    extractedObjectKey: `org/${adminIdentity.organizationId}/uploads/extracted/manual.json`,
                    fileName: "manual.pdf",
                    mimeType: pdfMimeType,
                    originalObjectKey: `org/${adminIdentity.organizationId}/uploads/original/manual.pdf`,
                    pageCount: 1,
                    sizeBytes: 8,
                    standardPageCount: 0.1,
                }),
                headers: {
                    authorization: "Bearer test-session",
                    "content-type": "application/json",
                    "idempotency-key": "invalid-signature-fixture",
                },
                method: "POST",
            },
        );
        const body = await response.json() as {
            error: { code: string };
        };

        expect(response.status).toBe(422);
        expect(body.error.code).toBe("FILE_SIGNATURE_INVALID");
        expect(services.objects.getJson).not.toHaveBeenCalled();
        expect(services.queue.send).not.toHaveBeenCalled();
    });

    it("binds local upload integrity metadata to its signed authorization", async () =>
    {
        const provider = new MockR2UploadIntentProvider({
            ENVIRONMENT: "local",
            LOCAL_UPLOAD_SIGNING_SECRET: "unit-test-signing-secret",
        } as SmartServiceBindings);
        const intent = await provider.create(
            adminIdentity,
            {
                contentSha256: "a".repeat(64),
                fileName: "manual.pdf",
                kind: "original",
                mimeType: pdfMimeType,
                sizeBytes: 8,
            },
            "http://127.0.0.1:8787",
        );
        const validRequest = new Request(intent.uploadUrl, {
            headers: intent.requiredHeaders,
            method: "PUT",
        });
        const verified = await provider.verifyMockRequest(validRequest);

        expect(verified.contentSha256).toBe("a".repeat(64));

        const invalidRequest = new Request(intent.uploadUrl, {
            headers: {
                ...intent.requiredHeaders,
                "x-amz-meta-content-sha256": "b".repeat(64),
            },
            method: "PUT",
        });

        await expect(provider.verifyMockRequest(invalidRequest))
            .rejects.toMatchObject({
                code: "UPLOAD_METADATA_MISMATCH",
                status: 422,
            });
    });
});
