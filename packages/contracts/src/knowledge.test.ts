import { describe, expect, it } from "vitest";

import {
    fileIntakeRequestSchema,
    pdfMimeType,
} from "./knowledge";

describe("knowledge contracts", () =>
{
    it("allows an 80-page PDF to exceed the DOCX-only 50-standard-page limit", () =>
    {
        const result = fileIntakeRequestSchema.safeParse({
            extractedObjectKey: "org/fixture/extracted/manual.json",
            fileName: "manual.pdf",
            mimeType: pdfMimeType,
            originalObjectKey: "org/fixture/original/manual.pdf",
            pageCount: 80,
            sizeBytes: 1024,
            standardPageCount: 80,
        });

        expect(result.success).toBe(true);
    });
});
