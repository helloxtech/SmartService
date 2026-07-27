import {
    docxMimeType,
    extractedKnowledgePayloadSchema,
    pdfMimeType,
    type ExtractedKnowledgePayload,
    type ExtractedSection,
} from "@smartservice/contracts";
import {
    calculateStandardPages,
    knowledgeLimits,
    sha256Bytes,
} from "@smartservice/ingestion";
import type { PDFPageProxy } from "pdfjs-dist";

export interface PreparedKnowledgeFile
{
    extractedBlob: Blob;
    extractedHash: string;
    file: File;
    mimeType: typeof docxMimeType | typeof pdfMimeType;
    originalHash: string;
    payload: ExtractedKnowledgePayload;
}

export class DocumentExtractionError extends Error
{
    public readonly code: string;

    /**
     * DocumentExtractionError
     * ----------------
     * Creates a stable browser-extraction failure with a user-safe explanation.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(code: string, message: string)
    {
        super(message);
        this.code = code;
        this.name = "DocumentExtractionError";
    }
}

/**
 * resolveMimeType
 * ----------------
 * Resolves PDF or DOCX from the browser MIME and extension while rejecting legacy DOC and unsupported files.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function resolveMimeType(file: File): typeof docxMimeType | typeof pdfMimeType
{
    const lowerName = file.name.toLowerCase();
    const expected = lowerName.endsWith(".pdf")
        ? pdfMimeType
        : lowerName.endsWith(".docx")
            ? docxMimeType
            : null;

    if (expected === null)
    {
        throw new DocumentExtractionError(
            "FILE_TYPE_UNSUPPORTED",
            "Choose an extractable PDF or DOCX file. Legacy .doc files are not supported.",
        );
    }

    if (file.type.length > 0 && file.type !== expected)
    {
        throw new DocumentExtractionError(
            "FILE_MIME_MISMATCH",
            "The file extension and browser content type do not match.",
        );
    }

    return expected;
}

/**
 * readPdfMetadataTitle
 * ----------------
 * Reads an optional PDF Title field from unknown metadata without unsafe property access.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function readPdfMetadataTitle(input: unknown): string | undefined
{
    if (typeof input !== "object" || input === null || !("Title" in input))
    {
        return undefined;
    }

    const title = input.Title;

    return typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : undefined;
}

/**
 * readPdfPageText
 * ----------------
 * Reconstructs one PDF text layer and preserves explicit line endings for page-scoped citations.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function readPdfPageText(
    page: PDFPageProxy,
): Promise<string>
{
    const content = await page.getTextContent();
    let text = "";

    for (const item of content.items)
    {
        if (!("str" in item))
        {
            continue;
        }

        text += item.str;
        text += "hasEOL" in item && item.hasEOL === true ? "\n" : " ";
    }

    return text
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/[ \t]{2,}/gu, " ")
        .trim();
}

/**
 * extractPdf
 * ----------------
 * Extracts browser PDF text by real page, rejects encrypted/no-text inputs, and preserves page locators.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function extractPdf(file: File, bytes: Uint8Array): Promise<ExtractedKnowledgePayload>
{
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
    ).toString();
    const loadingTask = pdfjs.getDocument({
        data: bytes,
        useWorkerFetch: true,
    });

    try
    {
        const document = await loadingTask.promise;

        if (document.numPages > knowledgeLimits.maxPdfPages)
        {
            throw new DocumentExtractionError(
                "PDF_PAGE_LIMIT_EXCEEDED",
                `PDF files can contain at most ${knowledgeLimits.maxPdfPages} pages.`,
            );
        }

        const sections: ExtractedSection[] = [];

        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1)
        {
            const page = await document.getPage(pageNumber);
            const text = await readPdfPageText(page);

            if (text.length > 0)
            {
                sections.push({
                    heading: `Page ${pageNumber}`,
                    pageEnd: pageNumber,
                    pageStart: pageNumber,
                    text,
                });
            }
        }

        const combinedText = sections.map((section) => section.text).join("\n\n");

        if (combinedText.trim().length < 20)
        {
            throw new DocumentExtractionError(
                "PDF_NO_EXTRACTABLE_TEXT",
                "This PDF has no extractable text. Scanned-image OCR is outside the demo scope.",
            );
        }

        const metadata = await document.getMetadata();
        const title = readPdfMetadataTitle(metadata.info) ?? file.name;

        return extractedKnowledgePayloadSchema.parse({
            documents: [{
                sections,
                title,
            }],
            fileName: file.name,
            pageCount: document.numPages,
            schemaVersion: 1,
            sourceType: "pdf",
            standardPageCount: calculateStandardPages(combinedText),
            title,
        });
    }
    catch (error: unknown)
    {
        if (error instanceof DocumentExtractionError)
        {
            throw error;
        }

        const message = error instanceof Error ? error.message.toLowerCase() : "";

        if (message.includes("password"))
        {
            throw new DocumentExtractionError(
                "PDF_ENCRYPTED",
                "Encrypted or password-protected PDFs are not supported.",
            );
        }

        throw new DocumentExtractionError(
            "PDF_EXTRACT_FAILED",
            "The PDF could not be read. Confirm that it is a valid, text-based PDF.",
        );
    }
    finally
    {
        await loadingTask.destroy();
    }
}

/**
 * tableToMarkdown
 * ----------------
 * Converts one DOCX HTML table into readable row-oriented Markdown for retrieval.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function tableToMarkdown(table: HTMLTableElement): string
{
    return Array.from(table.rows)
        .map((row) =>
        {
            const cells = Array.from(row.cells)
                .map((cell) => cell.textContent?.trim() ?? "")
                .filter((cell) => cell.length > 0);

            return cells.length === 0 ? "" : `| ${cells.join(" | ")} |`;
        })
        .filter((row) => row.length > 0)
        .join("\n");
}

/**
 * extractElementText
 * ----------------
 * Extracts readable DOCX block text with special handling for tables and lists.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function extractElementText(element: Element): string
{
    if (element instanceof HTMLTableElement)
    {
        return tableToMarkdown(element);
    }

    const text = element.textContent?.replace(/\s+/gu, " ").trim() ?? "";

    if (text.length === 0)
    {
        return "";
    }

    if (element.tagName === "LI")
    {
        return `- ${text}`;
    }

    return text;
}

/**
 * htmlToSections
 * ----------------
 * Groups Mammoth HTML blocks by heading so DOCX section titles survive ingestion and citation rendering.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function htmlToSections(html: string): { sections: ExtractedSection[]; title?: string }
{
    const document = new DOMParser().parseFromString(html, "text/html");
    const sections: ExtractedSection[] = [];
    let heading: string | undefined;
    let title: string | undefined;
    let blocks: string[] = [];

    /**
     * flush
     * ----------------
     * Emits the current nonempty DOCX section before a new heading or the end of the document.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    function flush(): void
    {
        const text = blocks.join("\n\n").trim();

        if (text.length > 0)
        {
            sections.push({
                heading,
                text,
            });
        }

        blocks = [];
    }

    for (const element of Array.from(document.body.children))
    {
        if (/^H[1-6]$/u.test(element.tagName))
        {
            flush();
            heading = element.textContent?.trim() || undefined;
            title ??= heading;
            continue;
        }

        const text = extractElementText(element);

        if (text.length > 0)
        {
            blocks.push(text);
        }
    }

    flush();

    return title === undefined
        ? { sections }
        : { sections, title };
}

/**
 * extractDocx
 * ----------------
 * Converts DOCX to structured HTML in the browser, preserves headings/tables, and enforces the 50-standard-page limit.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function extractDocx(file: File, bytes: Uint8Array): Promise<ExtractedKnowledgePayload>
{
    const mammoth = await import("mammoth");
    let result: Awaited<ReturnType<typeof mammoth.convertToHtml>>;

    try
    {
        result = await mammoth.convertToHtml({
            arrayBuffer: new Uint8Array(bytes).buffer,
        });
    }
    catch
    {
        throw new DocumentExtractionError(
            "DOCX_EXTRACT_FAILED",
            "The DOCX could not be read. Confirm that it is a valid Office Open XML document.",
        );
    }

    const structured = htmlToSections(result.value);
    const combinedText = structured.sections.map((section) => section.text).join("\n\n");

    if (combinedText.trim().length < 20)
    {
        throw new DocumentExtractionError(
            "DOCX_NO_TEXT",
            "The DOCX does not contain enough extractable text.",
        );
    }

    const standardPageCount = calculateStandardPages(combinedText);

    if (standardPageCount > knowledgeLimits.maxDocxStandardPages)
    {
        throw new DocumentExtractionError(
            "DOCX_PAGE_LIMIT_EXCEEDED",
            `DOCX files can contain at most ${knowledgeLimits.maxDocxStandardPages} standard pages.`,
        );
    }

    const title = structured.title ?? file.name;

    return extractedKnowledgePayloadSchema.parse({
        documents: [{
            sections: structured.sections,
            title,
        }],
        fileName: file.name,
        schemaVersion: 1,
        sourceType: "docx",
        standardPageCount,
        title,
    });
}

/**
 * prepareKnowledgeFile
 * ----------------
 * Validates one browser file, extracts source-aware content, and computes hashes for the original and extracted objects.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function prepareKnowledgeFile(file: File): Promise<PreparedKnowledgeFile>
{
    if (file.size <= 0)
    {
        throw new DocumentExtractionError("FILE_EMPTY", "Choose a nonempty PDF or DOCX file.");
    }

    if (file.size > knowledgeLimits.maxFileBytes)
    {
        throw new DocumentExtractionError(
            "FILE_TOO_LARGE",
            "Files can be no larger than 20 MB.",
        );
    }

    const mimeType = resolveMimeType(file);
    const originalBuffer = await file.arrayBuffer();
    const originalBytes = new Uint8Array(originalBuffer);
    const originalHash = await sha256Bytes(originalBytes);
    const payload = mimeType === pdfMimeType
        ? await extractPdf(file, originalBytes)
        : await extractDocx(file, originalBytes);
    const extractedBytes = new TextEncoder().encode(JSON.stringify(payload));

    if (extractedBytes.byteLength > knowledgeLimits.extractedJsonBytes)
    {
        throw new DocumentExtractionError(
            "EXTRACTED_JSON_TOO_LARGE",
            "The extracted document exceeds the 5 MB processing limit.",
        );
    }

    return {
        extractedBlob: new Blob([extractedBytes], {
            type: "application/json",
        }),
        extractedHash: await sha256Bytes(extractedBytes),
        file,
        mimeType,
        originalHash,
        payload,
    };
}
