import { extractedKnowledgePayloadSchema } from "@smartservice/contracts";
import { describe, expect, it } from "vitest";

import { buildIngestionPlan, splitSection } from "./chunking";
import { knowledgeLimits } from "./limits";
import { estimateTokenCount } from "./standard-pages";

describe("knowledge chunking", () =>
{
    it("keeps chunks bounded and never crosses a source section", async () =>
    {
        const firstSection = Array.from(
            { length: 900 },
            (_, index) => `NF-${index} operates within documented limits.`,
        ).join(" ");
        const secondSection = Array.from(
            { length: 500 },
            () => "Warranty coverage requires an approved installation.",
        ).join(" ");
        const payload = extractedKnowledgePayloadSchema.parse({
            documents: [{
                sections: [
                    {
                        heading: "Operating limits",
                        pageEnd: 4,
                        pageStart: 3,
                        text: firstSection,
                    },
                    {
                        heading: "Warranty",
                        pageEnd: 5,
                        pageStart: 5,
                        text: secondSection,
                    },
                ],
                title: "NF-Series Manual",
            }],
            fileName: "nf-series.pdf",
            pageCount: 5,
            schemaVersion: 1,
            sourceType: "pdf",
            standardPageCount: 6,
            title: "NF-Series Manual",
        });

        const plan = await buildIngestionPlan(
            "00000000-0000-4000-a000-000000000001",
            "40000000-0000-4000-a000-000000000001",
            1,
            payload,
        );

        expect(plan.documents).toHaveLength(1);
        expect(plan.chunks.length).toBeGreaterThan(2);

        for (const chunk of plan.chunks)
        {
            expect(estimateTokenCount(chunk.content))
                .toBeLessThanOrEqual(knowledgeLimits.chunkTargetMaxTokens);
            expect(chunk.sourceLocator).toMatchObject({
                fileName: "nf-series.pdf",
                kind: "pdf",
            });
        }

        expect(plan.chunks.some((chunk) => chunk.sourceLocator.section === "Operating limits"))
            .toBe(true);
        expect(plan.chunks.some((chunk) => chunk.sourceLocator.section === "Warranty"))
            .toBe(true);
    });

    it("produces stable record IDs for duplicate processing", async () =>
    {
        const payload = extractedKnowledgePayloadSchema.parse({
            documents: [{
                sections: [{
                    heading: "Overview",
                    text: "NovaFlow builds fictional industrial pumps for this demo.",
                }],
                title: "FAQ",
            }],
            fileName: "faq.docx",
            schemaVersion: 1,
            sourceType: "docx",
            standardPageCount: 0.01,
            title: "FAQ",
        });

        const first = await buildIngestionPlan(
            "00000000-0000-4000-a000-000000000001",
            "40000000-0000-4000-a000-000000000002",
            1,
            payload,
        );
        const second = await buildIngestionPlan(
            "00000000-0000-4000-a000-000000000001",
            "40000000-0000-4000-a000-000000000002",
            1,
            payload,
        );

        expect(second).toEqual(first);
        expect(splitSection("A short bounded paragraph.")).toEqual([
            "A short bounded paragraph.",
        ]);
    });
});
