import { z } from "zod";

export const knowledgeSourceTypeSchema = z.enum(["pdf", "docx", "url", "manual"]);
export const ingestionStatusSchema = z.enum([
    "uploaded",
    "extracting",
    "chunking",
    "embedding",
    "ready",
    "failed",
    "disabled",
]);

export const uploadKindSchema = z.enum(["original", "extracted"]);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
export const pdfMimeType = "application/pdf";
export const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const extractedJsonMimeType = "application/json";
export const supportedDocumentMimeTypeSchema = z.enum([pdfMimeType, docxMimeType]);
export const uploadMimeTypeSchema = z.enum([
    pdfMimeType,
    docxMimeType,
    extractedJsonMimeType,
]);

export const fileUploadIntentRequestSchema = z.object({
    contentSha256: sha256Schema,
    fileName: z.string().trim().min(1).max(255),
    kind: uploadKindSchema,
    mimeType: uploadMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(20_000_000),
}).superRefine((value, context) =>
{
    if (value.kind === "extracted" && value.mimeType !== extractedJsonMimeType)
    {
        context.addIssue({
            code: "custom",
            message: "Extracted uploads must use application/json.",
            path: ["mimeType"],
        });
    }

    if (value.kind === "original" && value.mimeType === extractedJsonMimeType)
    {
        context.addIssue({
            code: "custom",
            message: "Original uploads must be PDF or DOCX.",
            path: ["mimeType"],
        });
    }

    if (value.kind === "extracted" && value.sizeBytes > 5_000_000)
    {
        context.addIssue({
            code: "too_big",
            maximum: 5_000_000,
            message: "Extracted JSON must be no larger than 5 MB.",
            origin: "number",
            path: ["sizeBytes"],
        });
    }
});

export const fileUploadIntentResponseSchema = z.object({
    expiresAt: z.iso.datetime({ offset: true }),
    objectKey: z.string().min(1).max(1024),
    requiredHeaders: z.record(z.string(), z.string()),
    uploadUrl: z.url(),
});

export const extractedSectionSchema = z.object({
    heading: z.string().trim().min(1).max(500).optional(),
    pageEnd: z.number().int().positive().optional(),
    pageStart: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(500_000),
}).superRefine((value, context) =>
{
    if (
        value.pageStart !== undefined
        && value.pageEnd !== undefined
        && value.pageEnd < value.pageStart
    )
    {
        context.addIssue({
            code: "custom",
            message: "pageEnd cannot be earlier than pageStart.",
            path: ["pageEnd"],
        });
    }
});

export const extractedDocumentSchema = z.object({
    canonicalUrl: z.url().optional(),
    sections: z.array(extractedSectionSchema).min(1).max(500),
    title: z.string().trim().min(1).max(500),
});

export const extractedKnowledgePayloadSchema = z.object({
    documents: z.array(extractedDocumentSchema).min(1).max(30),
    fileName: z.string().trim().min(1).max(255).optional(),
    pageCount: z.number().int().positive().max(80).optional(),
    schemaVersion: z.literal(1),
    sourceType: knowledgeSourceTypeSchema,
    standardPageCount: z.number().positive().max(100),
    title: z.string().trim().min(1).max(500),
});

export const fileIntakeRequestSchema = z.object({
    extractedObjectKey: z.string().min(1).max(1024),
    fileName: z.string().trim().min(1).max(255),
    mimeType: supportedDocumentMimeTypeSchema,
    originalObjectKey: z.string().min(1).max(1024),
    pageCount: z.number().int().positive().max(80).optional(),
    sizeBytes: z.number().int().positive().max(20_000_000),
    standardPageCount: z.number().positive().max(100),
});

export const urlIntakeRequestSchema = z.object({
    maxDepth: z.number().int().min(0).max(2).default(2),
    maxPages: z.number().int().min(1).max(30).default(10),
    url: z.url(),
});

export const intakeResponseSchema = z.object({
    jobId: z.uuid(),
    sourceId: z.uuid(),
    status: ingestionStatusSchema,
});

export const knowledgeSourceSchema = z.object({
    activeVersion: z.number().int().positive(),
    chunkCount: z.number().int().nonnegative(),
    crawlMaxDepth: z.number().int().min(0).max(2).nullable(),
    crawlMaxPages: z.number().int().min(1).max(30).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    documentCount: z.number().int().nonnegative(),
    enabled: z.boolean(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    id: z.uuid(),
    name: z.string().min(1),
    pageCount: z.number().int().nonnegative().nullable(),
    sourceUrl: z.url().nullable(),
    standardPageCount: z.number().nonnegative().nullable(),
    status: ingestionStatusSchema,
    type: knowledgeSourceTypeSchema,
    updatedAt: z.iso.datetime({ offset: true }),
});

export const knowledgeSourceListResponseSchema = z.object({
    sources: z.array(knowledgeSourceSchema),
});

export const sourceActionSchema = z.enum(["disable", "enable", "retry"]);

export const sourceActionResponseSchema = z.object({
    jobId: z.uuid().optional(),
    source: knowledgeSourceSchema,
});

export const knowledgeIngestMessageSchema = z.object({
    idempotencyKey: z.string().min(8).max(200),
    inputObjectKey: z.string().min(1).max(1024).optional(),
    jobId: z.uuid(),
    organizationId: z.uuid(),
    sourceId: z.uuid(),
    type: z.literal("knowledge.ingest"),
    version: z.literal(1),
});

export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;
export type ExtractedKnowledgePayload = z.infer<typeof extractedKnowledgePayloadSchema>;
export type ExtractedSection = z.infer<typeof extractedSectionSchema>;
export type FileIntakeRequest = z.infer<typeof fileIntakeRequestSchema>;
export type FileUploadIntentRequest = z.infer<typeof fileUploadIntentRequestSchema>;
export type FileUploadIntentResponse = z.infer<typeof fileUploadIntentResponseSchema>;
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
export type KnowledgeIngestMessage = z.infer<typeof knowledgeIngestMessageSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;
export type SourceAction = z.infer<typeof sourceActionSchema>;
export type UrlIntakeRequest = z.infer<typeof urlIntakeRequestSchema>;
