import {
    extractedJsonMimeType,
    fileUploadIntentResponseSchema,
    type FileUploadIntentRequest,
    type FileUploadIntentResponse,
} from "@smartservice/contracts";
import { knowledgeLimits, sha256Bytes } from "@smartservice/ingestion";
import { AwsClient } from "aws4fetch";

import { ApiError } from "./errors";
import type {
    AdminIdentity,
    KnowledgeObjectStore,
    SmartServiceBindings,
    UploadIntentProvider,
    UploadObjectExpectation,
    VerifiedUploadObject,
} from "./types";

const uploadExpirySeconds = 300;

/**
 * sanitizeFileName
 * ----------------
 * Produces a short storage-only file name that cannot add path segments or control characters.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function sanitizeFileName(fileName: string): string
{
    const lastSegment = fileName.normalize("NFKC").split(/[\\/]/u).at(-1) ?? "upload";
    const sanitized = lastSegment
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 120);

    return sanitized.length === 0 ? "upload" : sanitized;
}

/**
 * createObjectKey
 * ----------------
 * Creates a tenant-prefixed, single-object upload key with no client-controlled directory components.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createObjectKey(identity: AdminIdentity, input: FileUploadIntentRequest): string
{
    const safeName = sanitizeFileName(input.fileName);

    return [
        "org",
        identity.organizationId,
        "uploads",
        crypto.randomUUID(),
        input.kind,
        safeName,
    ].join("/");
}

/**
 * encodeObjectKey
 * ----------------
 * Percent-encodes each storage path segment while preserving the server-created hierarchy.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function encodeObjectKey(key: string): string
{
    return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * requireUploadConfiguration
 * ----------------
 * Reads one live R2 signing value without exposing credential contents.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function requireUploadConfiguration(
    bindings: SmartServiceBindings,
    name: "R2_ACCESS_KEY_ID" | "R2_BUCKET_NAME" | "R2_S3_ENDPOINT" | "R2_SECRET_ACCESS_KEY",
): string
{
    const value = bindings[name];

    if (value === undefined || value.length === 0)
    {
        throw new ApiError(
            503,
            "R2_CONFIGURATION_MISSING",
            `The server binding ${name} is not configured.`,
        );
    }

    return value;
}

/**
 * createRequiredHeaders
 * ----------------
 * Binds content type, declared digest, and upload kind to one short-lived PUT authorization.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createRequiredHeaders(input: FileUploadIntentRequest): Record<string, string>
{
    return {
        "content-type": input.mimeType,
        "x-amz-meta-content-sha256": input.contentSha256.toLowerCase(),
        "x-amz-meta-upload-kind": input.kind,
    };
}

export class LiveR2UploadIntentProvider implements UploadIntentProvider
{
    /**
     * LiveR2UploadIntentProvider
     * ----------------
     * Creates a live R2 S3 signer from server-only Worker bindings.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * create
     * ----------------
     * Generates a five-minute, one-object R2 PUT URL signed for exact content type and integrity metadata.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async create(
        identity: AdminIdentity,
        input: FileUploadIntentRequest,
    ): Promise<FileUploadIntentResponse>
    {
        const objectKey = createObjectKey(identity, input);
        const headers = createRequiredHeaders(input);
        const endpoint = requireUploadConfiguration(this.bindings, "R2_S3_ENDPOINT").replace(/\/+$/u, "");
        const bucket = requireUploadConfiguration(this.bindings, "R2_BUCKET_NAME");
        const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodeObjectKey(objectKey)}`);
        url.searchParams.set("X-Amz-Expires", uploadExpirySeconds.toString());

        const signer = new AwsClient({
            accessKeyId: requireUploadConfiguration(this.bindings, "R2_ACCESS_KEY_ID"),
            region: "auto",
            secretAccessKey: requireUploadConfiguration(this.bindings, "R2_SECRET_ACCESS_KEY"),
            service: "s3",
        });
        const signedRequest = await signer.sign(new Request(url, {
            headers,
            method: "PUT",
        }), {
            aws: {
                signQuery: true,
            },
        });

        return fileUploadIntentResponseSchema.parse({
            expiresAt: new Date(Date.now() + uploadExpirySeconds * 1000).toISOString(),
            objectKey,
            requiredHeaders: headers,
            uploadUrl: signedRequest.url,
        });
    }
}

/**
 * getLocalSigningSecret
 * ----------------
 * Uses an explicit local secret when present and a nonproduction-only fixture value otherwise.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function getLocalSigningSecret(bindings: SmartServiceBindings): string
{
    if (bindings.ENVIRONMENT === "production")
    {
        throw new ApiError(503, "MOCK_MODE_FORBIDDEN", "Mock upload mode is disabled in production.");
    }

    return bindings.LOCAL_UPLOAD_SIGNING_SECRET ?? "smartservice-local-mock-upload-only";
}

/**
 * signLocalUpload
 * ----------------
 * Signs a local mock-upload authorization without exposing the signing key.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function signLocalUpload(secret: string, payload: string): Promise<string>
{
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        {
            hash: "SHA-256",
            name: "HMAC",
        },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
    );

    return Array.from(new Uint8Array(signature), (byte) =>
    {
        return byte.toString(16).padStart(2, "0");
    }).join("");
}

/**
 * buildLocalSignaturePayload
 * ----------------
 * Canonicalizes every mock-upload constraint so query parameter changes invalidate the authorization.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function buildLocalSignaturePayload(input: {
    contentSha256: string;
    contentType: string;
    expires: string;
    key: string;
    kind: string;
    sizeBytes: string;
}): string
{
    return [
        input.key,
        input.contentType,
        input.contentSha256,
        input.kind,
        input.sizeBytes,
        input.expires,
    ].join("\n");
}

/**
 * constantTimeEqual
 * ----------------
 * Compares same-length hexadecimal signatures without an early mismatch return.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function constantTimeEqual(first: string, second: string): boolean
{
    if (first.length !== second.length)
    {
        return false;
    }

    let difference = 0;

    for (let index = 0; index < first.length; index += 1)
    {
        difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
    }

    return difference === 0;
}

export class MockR2UploadIntentProvider implements UploadIntentProvider
{
    /**
     * MockR2UploadIntentProvider
     * ----------------
     * Creates a nonproduction HMAC upload-authority adapter for the local R2 binding.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly bindings: SmartServiceBindings)
    {
    }

    /**
     * create
     * ----------------
     * Creates a signed local PUT URL that exercises the same browser upload flow against the Worker R2 binding.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async create(
        identity: AdminIdentity,
        input: FileUploadIntentRequest,
        requestUrl: string,
    ): Promise<FileUploadIntentResponse>
    {
        const objectKey = createObjectKey(identity, input);
        const expires = (Math.floor(Date.now() / 1000) + uploadExpirySeconds).toString();
        const signatureInput = {
            contentSha256: input.contentSha256.toLowerCase(),
            contentType: input.mimeType,
            expires,
            key: objectKey,
            kind: input.kind,
            sizeBytes: input.sizeBytes.toString(),
        };
        const signature = await signLocalUpload(
            getLocalSigningSecret(this.bindings),
            buildLocalSignaturePayload(signatureInput),
        );
        const uploadUrl = new URL("/api/v1/local/r2-uploads", requestUrl);

        for (const [name, value] of Object.entries(signatureInput))
        {
            uploadUrl.searchParams.set(name, value);
        }

        uploadUrl.searchParams.set("signature", signature);

        return fileUploadIntentResponseSchema.parse({
            expiresAt: new Date(Number(expires) * 1000).toISOString(),
            objectKey,
            requiredHeaders: createRequiredHeaders(input),
            uploadUrl: uploadUrl.toString(),
        });
    }

    /**
     * verifyMockRequest
     * ----------------
     * Verifies expiry, signature, declared type, size, hash, and upload kind before accepting a local mock PUT.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async verifyMockRequest(request: Request): Promise<{
        contentSha256: string;
        contentType: string;
        key: string;
        kind: "extracted" | "original";
        sizeBytes: number;
    }>
    {
        const url = new URL(request.url);
        const contentSha256 = url.searchParams.get("contentSha256") ?? "";
        const contentType = url.searchParams.get("contentType") ?? "";
        const expires = url.searchParams.get("expires") ?? "";
        const key = url.searchParams.get("key") ?? "";
        const kind = url.searchParams.get("kind") ?? "";
        const sizeBytesValue = url.searchParams.get("sizeBytes") ?? "";
        const signature = url.searchParams.get("signature") ?? "";
        const expected = await signLocalUpload(
            getLocalSigningSecret(this.bindings),
            buildLocalSignaturePayload({
                contentSha256,
                contentType,
                expires,
                key,
                kind,
                sizeBytes: sizeBytesValue,
            }),
        );
        const sizeBytes = Number.parseInt(sizeBytesValue, 10);

        if (
            !constantTimeEqual(signature, expected)
            || !Number.isSafeInteger(sizeBytes)
            || sizeBytes <= 0
            || Number.parseInt(expires, 10) < Math.floor(Date.now() / 1000)
            || !/^[a-f0-9]{64}$/u.test(contentSha256)
            || (kind !== "original" && kind !== "extracted")
        )
        {
            throw new ApiError(403, "UPLOAD_SIGNATURE_INVALID", "The upload authorization is invalid or expired.");
        }

        if (request.headers.get("content-type") !== contentType)
        {
            throw new ApiError(422, "UPLOAD_CONTENT_TYPE_MISMATCH", "The upload content type did not match its authorization.");
        }

        if (
            request.headers.get("x-amz-meta-content-sha256") !== contentSha256
            || request.headers.get("x-amz-meta-upload-kind") !== kind
        )
        {
            throw new ApiError(422, "UPLOAD_METADATA_MISMATCH", "The upload metadata did not match its authorization.");
        }

        return {
            contentSha256,
            contentType,
            key,
            kind,
            sizeBytes,
        };
    }
}

/**
 * assertTenantObjectKey
 * ----------------
 * Ensures every Worker storage operation remains inside the authenticated organization prefix.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function assertTenantObjectKey(key: string, organizationId: string): void
{
    if (!key.startsWith(`org/${organizationId}/`))
    {
        throw new ApiError(403, "OBJECT_OWNERSHIP_MISMATCH", "The storage object does not belong to this organization.");
    }
}

export class R2KnowledgeObjectStore implements KnowledgeObjectStore
{
    /**
     * R2KnowledgeObjectStore
     * ----------------
     * Creates a tenant-validating object store over the configured Cloudflare R2 binding.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(private readonly bucket: R2Bucket)
    {
    }

    /**
     * delete
     * ----------------
     * Deletes one known source object after the database has already excluded its chunks from retrieval.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async delete(key: string): Promise<void>
    {
        await this.bucket.delete(key);
    }

    /**
     * getJson
     * ----------------
     * Loads and parses one tenant-owned extracted JSON object after integrity validation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async getJson(key: string, organizationId: string): Promise<unknown>
    {
        const object = await this.verify(key, {
            contentType: extractedJsonMimeType,
            kind: "extracted",
            maxSizeBytes: knowledgeLimits.extractedJsonBytes,
            organizationId,
        });

        try
        {
            return JSON.parse(new TextDecoder().decode(object.body)) as unknown;
        }
        catch
        {
            throw new ApiError(422, "EXTRACTED_JSON_INVALID", "The extracted document payload is not valid JSON.");
        }
    }

    /**
     * putMockUpload
     * ----------------
     * Stores a verified local upload in the R2 development binding with the same metadata used by live intake checks.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async putMockUpload(
        key: string,
        body: ArrayBuffer,
        contentType: string,
        contentSha256: string,
        kind: "extracted" | "original",
    ): Promise<void>
    {
        await this.bucket.put(key, body, {
            customMetadata: {
                contentSha256,
                uploadKind: kind,
            },
            httpMetadata: {
                contentType,
            },
        });
    }

    /**
     * verify
     * ----------------
     * Revalidates tenant prefix, size, MIME, signed metadata, and the actual SHA-256 body before creating an intake.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public async verify(
        key: string,
        expectation: UploadObjectExpectation,
    ): Promise<VerifiedUploadObject>
    {
        assertTenantObjectKey(key, expectation.organizationId);
        const head = await this.bucket.head(key);

        if (head === null)
        {
            throw new ApiError(422, "UPLOAD_OBJECT_MISSING", "An uploaded object could not be found.");
        }

        const contentType = head.httpMetadata?.contentType ?? "";
        const declaredHash = head.customMetadata?.contentSha256?.toLowerCase() ?? "";
        const declaredKind = head.customMetadata?.uploadKind ?? "";

        if (contentType !== expectation.contentType)
        {
            throw new ApiError(422, "UPLOAD_CONTENT_TYPE_MISMATCH", "An uploaded object has the wrong content type.");
        }

        if (declaredKind !== expectation.kind || !/^[a-f0-9]{64}$/u.test(declaredHash))
        {
            throw new ApiError(422, "UPLOAD_METADATA_INVALID", "An uploaded object is missing signed integrity metadata.");
        }

        if (
            expectation.sizeBytes !== undefined
            && head.size !== expectation.sizeBytes
        )
        {
            throw new ApiError(422, "UPLOAD_SIZE_MISMATCH", "An uploaded object has the wrong size.");
        }

        if (
            expectation.maxSizeBytes !== undefined
            && head.size > expectation.maxSizeBytes
        )
        {
            throw new ApiError(413, "UPLOAD_TOO_LARGE", "An uploaded object exceeds its size limit.");
        }

        const object = await this.bucket.get(key);

        if (object === null)
        {
            throw new ApiError(422, "UPLOAD_OBJECT_MISSING", "An uploaded object could not be read.");
        }

        const body = await object.arrayBuffer();
        const actualHash = await sha256Bytes(body);

        if (actualHash !== declaredHash)
        {
            throw new ApiError(422, "UPLOAD_HASH_MISMATCH", "An uploaded object failed its integrity check.");
        }

        return {
            body,
            contentSha256: actualHash,
            contentType,
            sizeBytes: head.size,
        };
    }
}

/**
 * createUploadIntentProvider
 * ----------------
 * Selects the real R2 signer or local signed-upload adapter from explicit environment configuration.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function createUploadIntentProvider(
    bindings: SmartServiceBindings,
): UploadIntentProvider
{
    return bindings.INGESTION_PROVIDER_MODE === "live"
        ? new LiveR2UploadIntentProvider(bindings)
        : new MockR2UploadIntentProvider(bindings);
}
