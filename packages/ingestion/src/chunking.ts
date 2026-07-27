import type {
    ExtractedDocument,
    ExtractedKnowledgePayload,
    ExtractedSection,
    KnowledgeSourceType,
} from "@smartservice/contracts";

import { deterministicUuid, sha256Text } from "./crypto";
import { knowledgeLimits } from "./limits";
import { estimateTokenCount } from "./standard-pages";

export interface IngestionDocumentPlan
{
    canonicalUrl: string | null;
    contentHash: string;
    id: string;
    metadata: Record<string, unknown>;
    title: string;
    version: number;
}

export interface IngestionChunkPlan
{
    content: string;
    contentHash: string;
    documentId: string;
    documentVersion: number;
    embedding?: number[];
    id: string;
    index: number;
    metadata: Record<string, unknown>;
    sourceLocator: Record<string, unknown>;
}

export interface IngestionPlan
{
    chunks: IngestionChunkPlan[];
    documents: IngestionDocumentPlan[];
}

interface SplitPart
{
    text: string;
    tokenCount: number;
}

/**
 * normalizeContent
 * ----------------
 * Normalizes extracted text while retaining paragraph boundaries used for source-aware chunking.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function normalizeContent(text: string): string
{
    return text
        .replace(/\r\n?/gu, "\n")
        .replace(/[ \t]+/gu, " ")
        .replace(/\n[ \t]+/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

/**
 * splitOversizedText
 * ----------------
 * Splits an oversized paragraph at word boundaries without dropping punctuation or CJK segments.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function splitOversizedText(text: string): SplitPart[]
{
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const parts: SplitPart[] = [];
    let current = "";

    for (const segment of segmenter.segment(text))
    {
        const candidate = `${current}${segment.segment}`;

        if (
            current.length > 0
            && estimateTokenCount(candidate) > knowledgeLimits.chunkTargetMaxTokens
        )
        {
            parts.push({
                text: current.trim(),
                tokenCount: estimateTokenCount(current),
            });
            current = segment.segment;
            continue;
        }

        current = candidate;
    }

    if (current.trim().length > 0)
    {
        parts.push({
            text: current.trim(),
            tokenCount: estimateTokenCount(current),
        });
    }

    return parts;
}

/**
 * createContentParts
 * ----------------
 * Converts paragraphs into bounded pieces before overlap-aware chunk assembly.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createContentParts(text: string): SplitPart[]
{
    const paragraphs = normalizeContent(text).split(/\n{2,}/u);
    const parts: SplitPart[] = [];

    for (const paragraph of paragraphs)
    {
        const tokenCount = estimateTokenCount(paragraph);

        if (tokenCount <= knowledgeLimits.chunkTargetMaxTokens)
        {
            parts.push({ text: paragraph, tokenCount });
            continue;
        }

        parts.push(...splitOversizedText(paragraph));
    }

    return parts;
}

/**
 * takeOverlap
 * ----------------
 * Returns a bounded tail from a completed chunk so adjacent chunks retain local context without crossing sections.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function takeOverlap(text: string): string
{
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    const segments = Array.from(segmenter.segment(text), (segment) => segment.segment);
    let overlap = "";

    for (let index = segments.length - 1; index >= 0; index -= 1)
    {
        const segment = segments[index];

        if (segment === undefined)
        {
            continue;
        }

        const candidate = `${segment}${overlap}`;

        if (estimateTokenCount(candidate) > knowledgeLimits.chunkOverlapTokens)
        {
            break;
        }

        overlap = candidate;
    }

    return overlap.trim();
}

/**
 * splitSection
 * ----------------
 * Builds approximately 350–700-token chunks with 70-token overlap inside one source section.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function splitSection(text: string): string[]
{
    const parts = createContentParts(text);
    const chunks: string[] = [];
    let current = "";

    for (const part of parts)
    {
        const separator = current.length === 0 ? "" : "\n\n";
        const candidate = `${current}${separator}${part.text}`;

        if (
            current.length > 0
            && estimateTokenCount(candidate) > knowledgeLimits.chunkTargetMaxTokens
        )
        {
            chunks.push(current);
            const overlap = takeOverlap(current);
            const overlappedCandidate = overlap.length === 0
                ? part.text
                : `${overlap}\n\n${part.text}`;
            current = estimateTokenCount(overlappedCandidate)
                <= knowledgeLimits.chunkTargetMaxTokens
                ? overlappedCandidate
                : part.text;
            continue;
        }

        current = candidate;

        if (
            estimateTokenCount(current) >= knowledgeLimits.chunkTargetMinTokens
            && part.tokenCount >= knowledgeLimits.chunkTargetMinTokens
        )
        {
            chunks.push(current);
            current = takeOverlap(current);
        }
    }

    if (current.trim().length > 0)
    {
        chunks.push(current.trim());
    }

    return chunks;
}

/**
 * buildSourceLocator
 * ----------------
 * Preserves page, section, title, file, and URL evidence needed for later customer-facing citations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function buildSourceLocator(
    payload: ExtractedKnowledgePayload,
    document: ExtractedDocument,
    section: ExtractedSection,
): Record<string, unknown>
{
    const locator: Record<string, unknown> = {
        kind: payload.sourceType,
        title: document.title,
    };

    if (payload.fileName !== undefined)
    {
        locator.fileName = payload.fileName;
    }

    if (document.canonicalUrl !== undefined)
    {
        locator.url = document.canonicalUrl;
    }

    if (section.heading !== undefined)
    {
        locator.section = section.heading;
    }

    if (section.pageStart !== undefined)
    {
        locator.pageStart = section.pageStart;
    }

    if (section.pageEnd !== undefined)
    {
        locator.pageEnd = section.pageEnd;
    }

    return locator;
}

/**
 * buildDocumentPlan
 * ----------------
 * Produces one deterministic document and its source-aware chunks for an ingestion version.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function buildDocumentPlan(
    organizationId: string,
    sourceId: string,
    sourceType: KnowledgeSourceType,
    version: number,
    document: ExtractedDocument,
    payload: ExtractedKnowledgePayload,
): Promise<{ chunks: IngestionChunkPlan[]; document: IngestionDocumentPlan }>
{
    const normalizedDocument = document.sections
        .map((section) => `${section.heading ?? ""}\n${normalizeContent(section.text)}`.trim())
        .join("\n\n");
    const contentHash = await sha256Text(normalizedDocument);
    const documentId = await deterministicUuid(
        "smartservice-knowledge-document",
        `${organizationId}:${sourceId}:${version}:${contentHash}`,
    );
    const chunks: IngestionChunkPlan[] = [];

    for (const section of document.sections)
    {
        for (const chunkText of splitSection(section.text))
        {
            const index = chunks.length;
            const chunkHash = await sha256Text(chunkText);
            const chunkId = await deterministicUuid(
                "smartservice-knowledge-chunk",
                `${documentId}:${version}:${index}:${chunkHash}`,
            );

            chunks.push({
                content: chunkText,
                contentHash: chunkHash,
                documentId,
                documentVersion: version,
                id: chunkId,
                index,
                metadata: {
                    estimatedTokens: estimateTokenCount(chunkText),
                    sourceType,
                },
                sourceLocator: buildSourceLocator(payload, document, section),
            });
        }
    }

    return {
        chunks,
        document: {
            canonicalUrl: document.canonicalUrl ?? null,
            contentHash,
            id: documentId,
            metadata: {
                sectionCount: document.sections.length,
                sourceType,
            },
            title: document.title,
            version,
        },
    };
}

/**
 * buildIngestionPlan
 * ----------------
 * Builds deterministic documents and chunks so retries and duplicate Queue messages remain idempotent.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function buildIngestionPlan(
    organizationId: string,
    sourceId: string,
    version: number,
    payload: ExtractedKnowledgePayload,
): Promise<IngestionPlan>
{
    const documents: IngestionDocumentPlan[] = [];
    const chunks: IngestionChunkPlan[] = [];

    for (const document of payload.documents)
    {
        const plan = await buildDocumentPlan(
            organizationId,
            sourceId,
            payload.sourceType,
            version,
            document,
            payload,
        );
        documents.push(plan.document);
        chunks.push(...plan.chunks);
    }

    if (chunks.length === 0)
    {
        throw new Error("The extracted knowledge did not contain usable text.");
    }

    return { chunks, documents };
}
