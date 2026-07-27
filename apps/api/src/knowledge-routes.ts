import {
    extractedKnowledgePayloadSchema,
    fileIntakeRequestSchema,
    fileUploadIntentRequestSchema,
    intakeResponseSchema,
    knowledgeSourceListResponseSchema,
    knowledgeSourceSchema,
    pdfMimeType,
    sourceActionResponseSchema,
    sourceActionSchema,
    urlIntakeRequestSchema,
    type FileIntakeRequest,
    type KnowledgeIngestMessage,
} from "@smartservice/contracts";
import {
    knowledgeLimits,
    validateCrawlTarget,
} from "@smartservice/ingestion";
import { Hono } from "hono";
import { z } from "zod";

import {
    ApiError,
    parseJsonBody,
    requireIdempotencyKey,
} from "./errors";
import type {
    AdminIdentity,
    AppEnvironment,
    IntakeRecord,
    RuntimeServiceFactory,
    RuntimeServices,
} from "./types";

const sourceIdSchema = z.uuid();

/**
 * getServices
 * ----------------
 * Creates the request-scoped runtime adapters from the current Worker bindings.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function getServices(
    factory: RuntimeServiceFactory,
    bindings: AppEnvironment["Bindings"],
): RuntimeServices
{
    return factory(bindings);
}

/**
 * parseSourceId
 * ----------------
 * Validates one path source ID before any tenant-scoped database query.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function parseSourceId(input: string): string
{
    const parsed = sourceIdSchema.safeParse(input);

    if (!parsed.success)
    {
        throw new ApiError(400, "SOURCE_ID_INVALID", "The knowledge source ID is not valid.");
    }

    return parsed.data;
}

/**
 * createQueueMessage
 * ----------------
 * Builds a small ID-only Queue payload; organization and source values remain untrusted until consumer reconciliation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createQueueMessage(
    identity: AdminIdentity,
    intake: IntakeRecord,
    idempotencyKey: string,
    inputObjectKey?: string,
): KnowledgeIngestMessage
{
    return {
        idempotencyKey,
        inputObjectKey,
        jobId: intake.jobId,
        organizationId: identity.organizationId,
        sourceId: intake.sourceId,
        type: "knowledge.ingest",
        version: 1,
    };
}

/**
 * assertDocumentSignature
 * ----------------
 * Confirms the server-observed original object begins with the expected PDF or ZIP/DOCX file signature.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function assertDocumentSignature(
    body: ArrayBuffer,
    mimeType: FileIntakeRequest["mimeType"],
): void
{
    const bytes = new Uint8Array(body);
    const expected = mimeType === pdfMimeType
        ? [0x25, 0x50, 0x44, 0x46, 0x2D]
        : [0x50, 0x4B, 0x03, 0x04];
    const valid = expected.every((byte, index) => bytes[index] === byte);

    if (!valid)
    {
        throw new ApiError(
            422,
            "FILE_SIGNATURE_INVALID",
            "The uploaded file contents do not match the declared PDF or DOCX type.",
        );
    }
}

/**
 * enqueueIntake
 * ----------------
 * Sends one validated ID-only message and records a bounded failure if Queue publication fails.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function enqueueIntake(
    services: RuntimeServices,
    message: KnowledgeIngestMessage,
): Promise<void>
{
    try
    {
        await services.queue.send(message, {
            contentType: "json",
        });
    }
    catch
    {
        const aggregate = await services.repository.findAggregate(message.jobId);

        if (aggregate !== null)
        {
            await services.repository.fail(
                aggregate,
                "QUEUE_PUBLISH_FAILED",
                "The ingestion job could not be queued. Retry the source.",
            );
        }

        throw new ApiError(503, "QUEUE_PUBLISH_FAILED", "The ingestion job could not be queued.");
    }
}

/**
 * validateExtractedFile
 * ----------------
 * Confirms server-observed extracted content agrees with the original file intake metadata and locked limits.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function validateExtractedFile(
    input: FileIntakeRequest,
    payloadInput: unknown,
): ReturnType<typeof extractedKnowledgePayloadSchema.parse>
{
    const parsedPayload = extractedKnowledgePayloadSchema.safeParse(payloadInput);

    if (!parsedPayload.success)
    {
        throw new ApiError(
            422,
            "EXTRACTED_PAYLOAD_INVALID",
            "The extracted document payload did not pass validation.",
        );
    }

    const payload = parsedPayload.data;
    const expectedType = input.mimeType === pdfMimeType ? "pdf" : "docx";

    if (payload.sourceType !== expectedType)
    {
        throw new ApiError(422, "SOURCE_TYPE_MISMATCH", "Extracted content does not match the original file type.");
    }

    if (payload.fileName !== input.fileName)
    {
        throw new ApiError(422, "FILE_NAME_MISMATCH", "Extracted content does not match the original file name.");
    }

    if (Math.abs(payload.standardPageCount - input.standardPageCount) > 0.01)
    {
        throw new ApiError(422, "STANDARD_PAGE_MISMATCH", "Extracted content has an inconsistent standard-page count.");
    }

    if (
        expectedType === "pdf"
        && (
            input.pageCount === undefined
            || payload.pageCount !== input.pageCount
            || input.pageCount > knowledgeLimits.maxPdfPages
        )
    )
    {
        throw new ApiError(422, "PDF_PAGE_COUNT_INVALID", "PDF page metadata is missing or inconsistent.");
    }

    if (
        expectedType === "docx"
        && input.standardPageCount > knowledgeLimits.maxDocxStandardPages
    )
    {
        throw new ApiError(413, "DOCX_PAGE_LIMIT_EXCEEDED", "The DOCX exceeds the 50 standard-page limit.");
    }

    return payload;
}

/**
 * deleteStoredObjects
 * ----------------
 * Best-effort deletes original and extracted objects after retrieval has already been disabled transactionally.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function deleteStoredObjects(
    services: RuntimeServices,
    keys: { extractedObjectKey: string | null; originalObjectKey: string | null },
): Promise<boolean>
{
    const objectKeys = [keys.originalObjectKey, keys.extractedObjectKey]
        .filter((key): key is string => key !== null);

    try
    {
        await Promise.all(objectKeys.map((key) => services.objects.delete(key)));
        return true;
    }
    catch
    {
        return false;
    }
}

/**
 * createKnowledgeRouter
 * ----------------
 * Creates authenticated knowledge-intake, status, retry, disable, enable, delete, and local signed-upload routes.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function createKnowledgeRouter(factory: RuntimeServiceFactory): Hono<AppEnvironment>
{
    const router = new Hono<AppEnvironment>();

    router.put("/v1/local/r2-uploads", async (context) =>
    {
        const services = getServices(factory, context.env);

        if (services.uploads.verifyMockRequest === undefined)
        {
            throw new ApiError(404, "NOT_FOUND", "The requested API route does not exist.");
        }

        const authorization = await services.uploads.verifyMockRequest(context.req.raw);
        const body = await context.req.arrayBuffer();

        if (body.byteLength !== authorization.sizeBytes)
        {
            throw new ApiError(422, "UPLOAD_SIZE_MISMATCH", "The uploaded body size did not match its authorization.");
        }

        if (
            body.byteLength > knowledgeLimits.maxFileBytes
            || (
                authorization.kind === "extracted"
                && body.byteLength > knowledgeLimits.extractedJsonBytes
            )
        )
        {
            throw new ApiError(413, "UPLOAD_TOO_LARGE", "The uploaded object exceeds its size limit.");
        }

        const actualHash = await crypto.subtle.digest("SHA-256", body);
        const actualHashHex = Array.from(new Uint8Array(actualHash), (byte) =>
        {
            return byte.toString(16).padStart(2, "0");
        }).join("");

        if (actualHashHex !== authorization.contentSha256)
        {
            throw new ApiError(422, "UPLOAD_HASH_MISMATCH", "The uploaded body failed its integrity check.");
        }

        await services.objects.putMockUpload(
            authorization.key,
            body,
            authorization.contentType,
            authorization.contentSha256,
            authorization.kind,
        );

        return context.body(null, 204);
    });

    router.post("/v1/admin/knowledge/file-upload-intents", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const input = await parseJsonBody(
            context.req.raw,
            fileUploadIntentRequestSchema,
        );
        const response = await services.uploads.create(
            identity,
            input,
            context.req.url,
        );

        return context.json(response, 201);
    });

    router.post("/v1/admin/knowledge/file-intakes", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const idempotencyKey = requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(context.req.raw, fileIntakeRequestSchema);

        const originalObject = await services.objects.verify(input.originalObjectKey, {
            contentType: input.mimeType,
            kind: "original",
            maxSizeBytes: knowledgeLimits.maxFileBytes,
            organizationId: identity.organizationId,
            sizeBytes: input.sizeBytes,
        });
        assertDocumentSignature(originalObject.body, input.mimeType);
        const extractedInput = await services.objects.getJson(
            input.extractedObjectKey,
            identity.organizationId,
        );
        const payload = validateExtractedFile(input, extractedInput);
        const sourceType = input.mimeType === pdfMimeType ? "pdf" : "docx";
        const intake = await services.repository.createIntake({
            crawlMaxDepth: null,
            crawlMaxPages: null,
            createdBy: identity.userId,
            extractedObjectKey: input.extractedObjectKey,
            idempotencyKey,
            name: input.fileName,
            organizationId: identity.organizationId,
            originalObjectKey: input.originalObjectKey,
            pageCount: payload.pageCount ?? null,
            requestId: context.get("requestId"),
            sourceType,
            sourceUrl: null,
            standardPageCount: payload.standardPageCount,
        });

        if (intake.status !== "ready")
        {
            await enqueueIntake(
                services,
                createQueueMessage(
                    identity,
                    intake,
                    idempotencyKey,
                    input.extractedObjectKey,
                ),
            );
        }

        return context.json(intakeResponseSchema.parse(intake), 202);
    });

    router.post("/v1/admin/knowledge/url-intakes", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const idempotencyKey = requireIdempotencyKey(context.req.raw);
        const input = await parseJsonBody(context.req.raw, urlIntakeRequestSchema);
        const target = await validateCrawlTarget(input.url, services.dnsResolver);
        const intake = await services.repository.createIntake({
            crawlMaxDepth: input.maxDepth,
            crawlMaxPages: input.maxPages,
            createdBy: identity.userId,
            extractedObjectKey: null,
            idempotencyKey,
            name: new URL(target.url).hostname,
            organizationId: identity.organizationId,
            originalObjectKey: null,
            pageCount: null,
            requestId: context.get("requestId"),
            sourceType: "url",
            sourceUrl: target.url,
            standardPageCount: null,
        });

        if (intake.status !== "ready")
        {
            await enqueueIntake(
                services,
                createQueueMessage(identity, intake, idempotencyKey),
            );
        }

        return context.json(intakeResponseSchema.parse(intake), 202);
    });

    router.get("/v1/admin/knowledge/sources", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const sources = await services.repository.listSources(identity.organizationId);

        return context.json(knowledgeSourceListResponseSchema.parse({ sources }));
    });

    router.get("/v1/admin/knowledge/sources/:sourceId", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateMember(context.req.raw);
        const source = await services.repository.getSource(
            identity.organizationId,
            parseSourceId(context.req.param("sourceId")),
        );

        if (source === null)
        {
            throw new ApiError(404, "SOURCE_NOT_FOUND", "The knowledge source does not exist.");
        }

        return context.json(knowledgeSourceSchema.parse(source));
    });

    router.post("/v1/admin/knowledge/sources/:sourceId/actions/:action", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        const idempotencyKey = requireIdempotencyKey(context.req.raw);
        const sourceId = parseSourceId(context.req.param("sourceId"));
        const parsedAction = sourceActionSchema.safeParse(context.req.param("action"));

        if (!parsedAction.success)
        {
            throw new ApiError(400, "SOURCE_ACTION_INVALID", "The knowledge-source action is not valid.");
        }

        let jobId: string | undefined;

        if (parsedAction.data === "retry")
        {
            const intake = await services.repository.retry(
                identity,
                sourceId,
                idempotencyKey,
                context.get("requestId"),
            );
            const aggregate = await services.repository.findAggregate(intake.jobId);

            if (aggregate === null)
            {
                throw new ApiError(500, "INGESTION_JOB_NOT_FOUND", "The retry job could not be loaded.");
            }

            if (intake.status !== "ready")
            {
                await enqueueIntake(
                    services,
                    createQueueMessage(
                        identity,
                        intake,
                        idempotencyKey,
                        aggregate.extractedObjectKey ?? undefined,
                    ),
                );
            }

            jobId = intake.jobId;
        }
        else
        {
            await services.repository.manageSource(
                identity,
                sourceId,
                parsedAction.data,
                context.get("requestId"),
            );
        }

        const source = await services.repository.getSource(identity.organizationId, sourceId);

        if (source === null)
        {
            throw new ApiError(404, "SOURCE_NOT_FOUND", "The knowledge source does not exist.");
        }

        return context.json(sourceActionResponseSchema.parse({
            jobId,
            source,
        }));
    });

    router.delete("/v1/admin/knowledge/sources/:sourceId", async (context) =>
    {
        const services = getServices(factory, context.env);
        const identity = await services.authenticateAdmin(context.req.raw);
        requireIdempotencyKey(context.req.raw);
        const sourceId = parseSourceId(context.req.param("sourceId"));
        const keys = await services.repository.manageSource(
            identity,
            sourceId,
            "delete",
            context.get("requestId"),
        );
        const objectsDeleted = await deleteStoredObjects(services, keys);

        return context.json({
            objectsDeleted,
            sourceId,
            status: "deleted",
        }, objectsDeleted ? 200 : 202);
    });

    return router;
}
