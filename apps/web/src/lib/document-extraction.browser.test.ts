import {
    docxMimeType,
    pdfMimeType,
} from "@smartservice/contracts";
import { sha256Bytes } from "@smartservice/ingestion";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import docxFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/xflow-support-faq.docx?url";
import manifestFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/manifest.json?url";
import pdfFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/xflow-nf-series-manual.pdf?url";
import noTextPdfFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/xflow-no-text.pdf?url";
import siteIndexFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/site/index.html?url";
import siteProductsFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/site/products.html?url";
import siteSupportFixtureUrl from "../../../../docs/spec/fixtures/generated/ingestion/site/support.html?url";
import { prepareKnowledgeFile } from "./document-extraction";

const fixtureUrls: Record<string, string> = {
    "xflow-nf-series-manual.pdf": pdfFixtureUrl,
    "xflow-no-text.pdf": noTextPdfFixtureUrl,
    "xflow-support-faq.docx": docxFixtureUrl,
    "site/index.html": siteIndexFixtureUrl,
    "site/products.html": siteProductsFixtureUrl,
    "site/support.html": siteSupportFixtureUrl,
};

const manifestSchema = z.object({
    expectations: z.object({
        docxTitle: z.string(),
        pdfPages: z.number().int().positive(),
        sitePages: z.number().int().positive(),
    }),
    files: z.record(z.string(), z.object({
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })),
});

/**
 * loadFixtureBytes
 * ----------------
 * Fetches one committed fixture through the real Vite browser test server.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function loadFixtureBytes(name: string): Promise<Uint8Array>
{
    const url = fixtureUrls[name];

    if (url === undefined)
    {
        throw new Error(`Fixture ${name} does not have a browser asset URL.`);
    }

    const response = await fetch(url);

    if (!response.ok)
    {
        throw new Error(`Fixture ${name} could not be loaded.`);
    }

    return new Uint8Array(await response.arrayBuffer());
}

/**
 * loadManifest
 * ----------------
 * Loads and validates the immutable ingestion fixture manifest in a real browser.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function loadManifest(): Promise<z.infer<typeof manifestSchema>>
{
    const response = await fetch(manifestFixtureUrl);

    if (!response.ok)
    {
        throw new Error("The ingestion fixture manifest could not be loaded.");
    }

    return manifestSchema.parse(await response.json());
}

/**
 * loadFixtureFile
 * ----------------
 * Loads one committed binary fixture into the real browser File shape used by extraction code.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function loadFixtureFile(
    name: string,
    mimeType: string,
): Promise<File>
{
    const bytes = await loadFixtureBytes(name);

    return new File([new Uint8Array(bytes).buffer], name, {
        type: mimeType,
    });
}

describe("real browser document extraction fixtures", () =>
{
    it("matches every committed fixture hash before extraction", async () =>
    {
        const manifest = await loadManifest();

        for (const [relativePath, expectation] of Object.entries(manifest.files))
        {
            const bytes = await loadFixtureBytes(relativePath);

            expect(bytes.byteLength).toBe(expectation.bytes);
            expect(await sha256Bytes(bytes)).toBe(expectation.sha256);
        }

        expect(Object.keys(manifest.files).filter((path) => path.startsWith("site/")))
            .toHaveLength(manifest.expectations.sitePages);
    });

    it("extracts the fixed text PDF with real page locators", async () =>
    {
        const manifest = await loadManifest();
        const prepared = await prepareKnowledgeFile(await loadFixtureFile(
            "xflow-nf-series-manual.pdf",
            pdfMimeType,
        ));

        expect(prepared.payload.sourceType).toBe("pdf");
        expect(prepared.payload.pageCount).toBe(manifest.expectations.pdfPages);
        expect(prepared.payload.documents[0]?.sections[0]).toMatchObject({
            pageEnd: 1,
            pageStart: 1,
        });
        expect(prepared.payload.documents[0]?.sections
            .some((section) => section.text.includes("NF-500"))).toBe(true);
    });

    it("extracts the fixed DOCX headings and computes standard pages", async () =>
    {
        const manifest = await loadManifest();
        const prepared = await prepareKnowledgeFile(await loadFixtureFile(
            "xflow-support-faq.docx",
            docxMimeType,
        ));

        expect(prepared.payload.sourceType).toBe("docx");
        expect(prepared.payload.title).toBe(manifest.expectations.docxTitle);
        expect(prepared.payload.standardPageCount).toBeGreaterThan(0);
        expect(prepared.payload.documents[0]?.sections
            .some((section) => section.heading?.includes("Warranty") === true)).toBe(true);
    });

    it("rejects a real no-text PDF without attempting out-of-scope OCR", async () =>
    {
        await expect(prepareKnowledgeFile(await loadFixtureFile(
            "xflow-no-text.pdf",
            pdfMimeType,
        ))).rejects.toMatchObject({
            code: "PDF_NO_EXTRACTABLE_TEXT",
        });
    });

    it("rejects empty, oversized, unsupported, and malformed browser files", async () =>
    {
        await expect(prepareKnowledgeFile(new File([], "empty.pdf", {
            type: pdfMimeType,
        }))).rejects.toMatchObject({
            code: "FILE_EMPTY",
        });
        await expect(prepareKnowledgeFile(new File([
            new Uint8Array(20_000_001),
        ], "oversized.pdf", {
            type: pdfMimeType,
        }))).rejects.toMatchObject({
            code: "FILE_TOO_LARGE",
        });
        await expect(prepareKnowledgeFile(new File([
            "unsupported",
        ], "notes.txt", {
            type: "text/plain",
        }))).rejects.toMatchObject({
            code: "FILE_TYPE_UNSUPPORTED",
        });
        await expect(prepareKnowledgeFile(new File([
            "not a valid Office archive",
        ], "malformed.docx", {
            type: docxMimeType,
        }))).rejects.toMatchObject({
            code: "DOCX_EXTRACT_FAILED",
        });
    });
});
