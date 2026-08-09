import { parsePublicEnvironment } from "@smartservice/config";
import {
    extractedJsonMimeType,
    fileUploadIntentResponseSchema,
    intakeResponseSchema,
    knowledgeSourceListResponseSchema,
    sourceActionResponseSchema,
    type IntakeResponse,
    type KnowledgeSource,
    type SourceAction,
} from "@smartservice/contracts";
import { sha256Text } from "@smartservice/ingestion";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";

import type { PreparedKnowledgeFile } from "./document-extraction";

const publicEnvironment = parsePublicEnvironment({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
});

const apiErrorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
    }),
});

export class KnowledgeApiError extends Error
{
    public readonly code: string;
    public readonly requestId: string | undefined;

    /**
     * KnowledgeApiError
     * ----------------
     * Creates a browser-facing API failure with stable code and optional request trace.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(code: string, message: string, requestId?: string)
    {
        super(message);
        this.code = code;
        this.name = "KnowledgeApiError";
        this.requestId = requestId;
    }
}

/**
 * buildApiUrl
 * ----------------
 * Resolves an API path against the optional configured origin while defaulting to the production same-origin route.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function buildApiUrl(path: string): string
{
    const base = publicEnvironment.VITE_API_BASE_URL?.replace(/\/+$/u, "") ?? "";

    return `${base}${path}`;
}

/**
 * apiRequest
 * ----------------
 * Sends one authenticated JSON API request with a bounded timeout and validates the successful response contract.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function apiRequest<T>(
    session: Session,
    path: string,
    parser: { parse(input: unknown): T },
    init: RequestInit = {},
): Promise<T>
{
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${session.access_token}`);

    if (init.body !== undefined && !headers.has("content-type"))
    {
        headers.set("content-type", "application/json");
    }

    const response = await fetch(buildApiUrl(path), {
        ...init,
        headers,
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok)
    {
        let input: unknown;

        try
        {
            input = await response.json();
        }
        catch
        {
            throw new KnowledgeApiError(
                "API_REQUEST_FAILED",
                "The server request failed without a readable response.",
            );
        }

        const parsed = apiErrorSchema.safeParse(input);

        if (parsed.success)
        {
            throw new KnowledgeApiError(
                parsed.data.error.code,
                parsed.data.error.message,
                parsed.data.error.requestId,
            );
        }

        throw new KnowledgeApiError("API_REQUEST_FAILED", "The server request failed.");
    }

    return parser.parse(await response.json());
}

/**
 * uploadObject
 * ----------------
 * Uploads one body to a short-lived single-object URL using only the server-required signed headers.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function uploadObject(
    uploadUrl: string,
    requiredHeaders: Record<string, string>,
    body: Blob,
): Promise<void>
{
    const response = await fetch(uploadUrl, {
        body,
        headers: requiredHeaders,
        method: "PUT",
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok)
    {
        throw new KnowledgeApiError(
            "OBJECT_UPLOAD_FAILED",
            "A signed knowledge-file upload failed. Request a new upload and try again.",
        );
    }
}

/**
 * createFileUploadIntent
 * ----------------
 * Requests one short-lived upload authorization for an original file or extracted JSON.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function createFileUploadIntent(
    session: Session,
    input: {
        contentSha256: string;
        fileName: string;
        kind: "extracted" | "original";
        mimeType: string;
        sizeBytes: number;
    },
): Promise<ReturnType<typeof fileUploadIntentResponseSchema.parse>>
{
    return apiRequest(
        session,
        "/api/v1/admin/knowledge/file-upload-intents",
        fileUploadIntentResponseSchema,
        {
            body: JSON.stringify(input),
            method: "POST",
        },
    );
}

/**
 * submitKnowledgeFile
 * ----------------
 * Uploads original and extracted objects in parallel, then creates one idempotent file-ingestion job.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function submitKnowledgeFile(
    session: Session,
    prepared: PreparedKnowledgeFile,
): Promise<IntakeResponse>
{
    const [originalIntent, extractedIntent] = await Promise.all([
        createFileUploadIntent(session, {
            contentSha256: prepared.originalHash,
            fileName: prepared.file.name,
            kind: "original",
            mimeType: prepared.mimeType,
            sizeBytes: prepared.file.size,
        }),
        createFileUploadIntent(session, {
            contentSha256: prepared.extractedHash,
            fileName: `${prepared.file.name}.extracted.json`,
            kind: "extracted",
            mimeType: extractedJsonMimeType,
            sizeBytes: prepared.extractedBlob.size,
        }),
    ]);

    await Promise.all([
        uploadObject(
            originalIntent.uploadUrl,
            originalIntent.requiredHeaders,
            prepared.file,
        ),
        uploadObject(
            extractedIntent.uploadUrl,
            extractedIntent.requiredHeaders,
            prepared.extractedBlob,
        ),
    ]);

    const idempotencyKey = await sha256Text([
        session.user.id,
        "file",
        crypto.randomUUID(),
        prepared.originalHash,
        prepared.extractedHash,
    ].join(":"));

    return apiRequest(
        session,
        "/api/v1/admin/knowledge/file-intakes",
        intakeResponseSchema,
        {
            body: JSON.stringify({
                extractedObjectKey: extractedIntent.objectKey,
                fileName: prepared.file.name,
                mimeType: prepared.mimeType,
                originalObjectKey: originalIntent.objectKey,
                pageCount: prepared.payload.pageCount,
                sizeBytes: prepared.file.size,
                standardPageCount: prepared.payload.standardPageCount,
            }),
            headers: {
                "idempotency-key": idempotencyKey,
            },
            method: "POST",
        },
    );
}

/**
 * submitWebsite
 * ----------------
 * Creates one idempotent bounded same-origin crawl job after server-side SSRF validation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function submitWebsite(
    session: Session,
    input: { maxDepth: number; maxPages: number; url: string },
): Promise<IntakeResponse>
{
    const idempotencyKey = await sha256Text([
        session.user.id,
        "url",
        crypto.randomUUID(),
        new URL(input.url).toString(),
        input.maxPages.toString(),
        input.maxDepth.toString(),
    ].join(":"));

    return apiRequest(
        session,
        "/api/v1/admin/knowledge/url-intakes",
        intakeResponseSchema,
        {
            body: JSON.stringify(input),
            headers: {
                "idempotency-key": idempotencyKey,
            },
            method: "POST",
        },
    );
}

/**
 * listKnowledgeSources
 * ----------------
 * Loads the authenticated organization source list for Admin controls or Agent read-only visibility.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function listKnowledgeSources(session: Session): Promise<KnowledgeSource[]>
{
    const response = await apiRequest(
        session,
        "/api/v1/admin/knowledge/sources",
        knowledgeSourceListResponseSchema,
    );

    return response.sources;
}

/**
 * applySourceAction
 * ----------------
 * Applies an idempotent retry, disable, or enable operation and returns the refreshed source.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function applySourceAction(
    session: Session,
    sourceId: string,
    action: SourceAction,
): Promise<KnowledgeSource>
{
    const response = await apiRequest(
        session,
        `/api/v1/admin/knowledge/sources/${encodeURIComponent(sourceId)}/actions/${action}`,
        sourceActionResponseSchema,
        {
            headers: {
                "idempotency-key": crypto.randomUUID(),
            },
            method: "POST",
        },
    );

    return response.source;
}

/**
 * deleteKnowledgeSource
 * ----------------
 * Soft-deletes one source and asks the server to remove its original and extracted objects.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function deleteKnowledgeSource(
    session: Session,
    sourceId: string,
): Promise<void>
{
    const response = await fetch(buildApiUrl(
        `/api/v1/admin/knowledge/sources/${encodeURIComponent(sourceId)}`,
    ), {
        headers: {
            authorization: `Bearer ${session.access_token}`,
            "idempotency-key": crypto.randomUUID(),
        },
        method: "DELETE",
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok)
    {
        throw new KnowledgeApiError("SOURCE_DELETE_FAILED", "The knowledge source could not be deleted.");
    }
}
