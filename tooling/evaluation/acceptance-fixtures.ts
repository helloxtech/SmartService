import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const acceptanceCaseSchema = z.object({
    expectedDecision: z.enum(["answer", "handoff"]).optional(),
    expectedFacts: z.array(z.string().min(1)).optional(),
    expectedReason: z.string().min(1).optional(),
    expectedRule: z.string().min(1).optional(),
    expectedSourceHint: z.string().min(1).optional(),
    expectedTicketType: z.string().min(1).optional(),
    expectedUrgency: z.string().min(1).optional(),
    group: z.enum(["in_scope", "out_of_scope", "guardrail", "ticket"]),
    id: z.string().min(1),
    language: z.string().min(1).optional(),
    question: z.string().min(1),
});

const acceptanceFixtureSchema = z.object({
    cases: z.array(acceptanceCaseSchema),
    metadata: z.object({
        fixtureCompany: z.string().min(1),
        notes: z.string().min(1),
        version: z.string().min(1),
    }),
});

export type AcceptanceCase = z.infer<typeof acceptanceCaseSchema>;

/**
 * loadAcceptanceCases
 * ----------------
 * Loads and validates the frozen acceptance fixture without executing provider calls.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 1 Foundation
 */
export async function loadAcceptanceCases(): Promise<readonly AcceptanceCase[]>
{
    const fixtureUrl = new URL("../../docs/spec/fixtures/tests/acceptance_cases.json", import.meta.url);
    const rawFixture = await readFile(fileURLToPath(fixtureUrl), "utf8");
    const parsedJson: unknown = JSON.parse(rawFixture);
    return acceptanceFixtureSchema.parse(parsedJson).cases;
}
