import { describe, expect, it } from "vitest";

import {
    buildRagRepairPrompt,
    buildCrossLanguageRetrievalQuestion,
    buildRagPrompt,
    buildRetrievalQuestion,
    buildRetrievalQuestions,
    createSafeClarification,
    DeterministicRagAnswerProvider,
    enforceCustomerControlledHandoff,
    filterEvidenceForExactEntities,
    isContextDependentFollowUp,
    mergeRetrievedEvidence,
    RagValidationError,
    validateGroundedAnswer,
    type RetrievedEvidence,
} from "./rag";

const fixtureEvidence: RetrievedEvidence = {
    chunkId: "40000000-0000-4000-a000-000000000001",
    combinedScore: 0.91,
    content: "NF-500 specifications. Maximum flow | 300 litres per minute.",
    sourceLocator: {
        pageStart: 4,
        title: "NF-Series Product Manual",
    },
};
const evidence: RetrievedEvidence[] = [fixtureEvidence];

describe("grounded RAG", () =>
{
    it("contextualizes short follow-ups without polluting unrelated questions", () =>
    {
        const recentMessages = [
            {
                senderType: "customer" as const,
                text: "请问移动房屋公园的估值取决于什么？",
            },
            {
                senderType: "ai" as const,
                text: "移动房屋公园的估值取决于已批准的评估因素。",
            },
        ];
        const followUp = buildRetrievalQuestion("Are you sure?", recentMessages);

        expect(isContextDependentFollowUp("Are you sure?")).toBe(true);
        expect(isContextDependentFollowUp("请问有什么课程？")).toBe(false);
        expect(followUp).toContain("移动房屋公园的估值");
        expect(followUp).toContain("customer follow-up: Are you sure?");
        expect(buildRetrievalQuestion("请问有什么课程？", recentMessages))
            .toBe("请问有什么课程？");
    });

    it("decomposes multi-part questions into focused retrieval queries", () =>
    {
        expect(buildRetrievalQuestions(
            "你们学校校长是谁？哪年成立的？上课要去学校上，还是可以在家上？学校地址是哪里？",
            [],
        )).toEqual([
            "你们学校校长是谁",
            "哪年成立的",
            "上课要去学校上，还是可以在家上",
            "学校地址是哪里",
        ]);
    });

    it("adds exact shared entities to later subquestions", () =>
    {
        expect(buildRetrievalQuestions(
            "古筝的课时有多少？有文凭证书吗？老师是谁？",
            [],
        )).toEqual([
            "古筝的课时有多少",
            "古筝 有文凭证书吗",
            "古筝 老师是谁",
        ]);
        expect(buildRetrievalQuestions(
            "NF-500 的最大流量是多少？价格呢？保修多久？",
            [],
        )).toEqual([
            "NF-500 的最大流量是多少",
            "NF-500 价格呢",
            "NF-500 保修多久",
        ]);
    });

    it("bridges common Chinese business questions into English website search terms", () =>
    {
        const foundedQuery = buildCrossLanguageRetrievalQuestion("哪年成立的");
        const addressQuery = buildCrossLanguageRetrievalQuestion("学校地址是哪里");
        const appointmentQuery = buildCrossLanguageRetrievalQuestion("预约可以改期或取消吗？");
        const returnsQuery = buildCrossLanguageRetrievalQuestion("产品可以退货或保修吗？");

        expect(foundedQuery).toContain("founded in");
        expect(foundedQuery).toContain("established");
        expect(addressQuery).toContain("address");
        expect(addressQuery).toContain("学校地址是哪里");
        expect(appointmentQuery).toContain("reschedule");
        expect(appointmentQuery).toContain("cancellation");
        expect(returnsQuery).toContain("return");
        expect(returnsQuery).toContain("warranty");
        expect(buildCrossLanguageRetrievalQuestion("What is the address?"))
            .toBe("What is the address?");
    });

    it("keeps evidence for every focused query when merging bounded results", () =>
    {
        const firstResult = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000004",
        };
        const secondResult = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000005",
        };

        expect(mergeRetrievedEvidence([
            [firstResult, fixtureEvidence],
            [secondResult],
        ], 2).map((item) => item.chunkId)).toEqual([
            firstResult.chunkId,
            secondResult.chunkId,
        ]);
    });

    it("does not let Guzheng evidence answer a Guqin question", () =>
    {
        const guzhengEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "古筝表演文凭课程为 40 小时。",
        };
        const mixedEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000006",
            content: "教师简介提到古琴教学经验。",
        };

        expect(filterEvidenceForExactEntities(
            "请问有教古琴吗？",
            [guzhengEvidence, mixedEvidence],
        )).toEqual([mixedEvidence]);
        expect(filterEvidenceForExactEntities(
            "古琴的收费是多少？",
            [guzhengEvidence],
        )).toEqual([]);
    });

    it("does not let an adjacent product identifier answer the requested model", () =>
    {
        const nf500Evidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "NF-500 maximum flow is 300 litres per minute.",
        };
        const nf600Evidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000007",
            content: "NF-600 maximum flow is 450 litres per minute.",
        };

        expect(filterEvidenceForExactEntities(
            "What is the NF-500 maximum flow?",
            [nf600Evidence, nf500Evidence],
        )).toEqual([nf500Evidence]);
    });

    it("answers a fixture question only with a retrieved supporting citation", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const result = await provider.generate({
            evidence,
            language: "en",
            question: "What is the maximum flow rate of the NF-500?",
            recentMessages: [],
        });
        const answer = result.answer;

        expect(answer.decision).toBe("answer");
        expect(answer.answer).toContain("300 litres per minute");
        expect(answer.citationChunkIds).toEqual([evidence[0]?.chunkId]);
        expect(validateGroundedAnswer(answer, evidence)).toEqual(answer);
    });

    it("keeps the conversation AI-active when retrieved evidence does not support the question", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const result = await provider.generate({
            evidence,
            language: "zh-CN",
            question: "产品有没有 ATEX 认证？",
            recentMessages: [],
        });
        const answer = result.answer;

        expect(answer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
        expect(answer.answer).not.toContain("已将问题转交");
        expect(answer.answer).not.toContain("已批准资料");
    });

    it("acknowledges the exact entity naturally when no matching information is found", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const result = await provider.generate({
            evidence: [],
            language: "zh-CN",
            question: "我在问有教古琴吗？",
            recentMessages: [],
        });

        expect(result.answer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
        expect(result.answer.answer).toContain("您问的是“古琴”");
        expect(result.answer.answer).toContain("客服专员");
        expect(result.answer.answer).not.toContain("古筝");
    });

    it("returns an exact approved manual answer only for its matching original question", async () =>
    {
        const provider = new DeterministicRagAnswerProvider();
        const manualEvidence: RetrievedEvidence[] = [{
            chunkId: "40000000-0000-4000-a000-000000000003",
            combinedScore: 0.99,
            content: "Question: What is the diagnostic coverage window?\n\nAnswer: The approved diagnostic coverage window is 14 days.\n\nSource note: Approved by the demo product lead.",
            sourceLocator: {
                section: "Approved manual answer",
                title: "Diagnostic coverage",
            },
        }];
        const matching = await provider.generate({
            evidence: manualEvidence,
            language: "en",
            question: "What is the diagnostic coverage window?",
            recentMessages: [],
        });
        const different = await provider.generate({
            evidence: manualEvidence,
            language: "en",
            question: "What is the delivery time?",
            recentMessages: [],
        });
        const confirmation = await provider.generate({
            evidence: manualEvidence,
            language: "en",
            question: "Are you sure?",
            recentMessages: [{
                senderType: "customer",
                text: "What is the diagnostic coverage window?",
            }, {
                senderType: "ai",
                text: "The approved diagnostic coverage window is 14 days.",
            }],
        });

        expect(matching.answer).toMatchObject({
            answer: "The approved diagnostic coverage window is 14 days.",
            citationChunkIds: [manualEvidence[0]?.chunkId],
            decision: "answer",
        });
        expect(different.answer.decision).toBe("clarify");
        expect(confirmation.answer).toMatchObject({
            answer: "Yes. I checked it again: The approved diagnostic coverage window is 14 days.",
            citationChunkIds: [manualEvidence[0]?.chunkId],
            decision: "answer",
        });
    });

    it("prevents a model-originated handoff from transferring the customer", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "I requested human support.",
            citationChunkIds: [],
            confidence: 0,
            decision: "handoff",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "unsupported question",
        }, "Unsupported question", "en");
        const prompt = buildRagPrompt({
            evidence,
            language: "en",
            question: "Unsupported question",
            recentMessages: [],
        });

        expect(answer).toMatchObject({
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
        expect(answer.answer).not.toContain("requested human support");
        expect(prompt.system).toContain("Never return decision=handoff");
        expect(prompt.system).toContain("address every part separately");
    });

    it("replaces model-controlled question normalization with the deterministic canonical form", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "Please add details.",
            citationChunkIds: [],
            confidence: 0,
            decision: "clarify",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "MODEL CONTROLLED VALUE",
        }, "Does the QA-500 course include lunar-campus lodging?", "en");

        expect(answer.normalizedQuestion)
            .toBe("does the qa-500 course include lunar-campus lodging");
    });

    it("removes retrieval language so confirmed facts sound company-owned", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "根据证据，学校成立于2001年，证据中没有校长姓名。",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "model value",
        }, "学校是哪年成立的？", "zh-CN");

        expect(answer.answer).toBe(
            "学校成立于2001年，目前尚未确认校长姓名。",
        );
        expect(answer.answer).not.toContain("证据");
        expect(answer.answer).not.toContain("资料");
        expect(answer.answer).not.toContain("查到");
    });

    it("answers a principal question directly in the company-service voice when the model mentions only founders", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "学校由陈教授和杨教授共同创办，成立于2001年。",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "model value",
        }, "你们学校校长是谁？哪年成立的？", "zh-CN");

        expect(answer.answer).toBe(
            "关于校长，我这边暂时没有可确认的信息。您可以选择请客服专员进一步核实。学校由陈教授和杨教授共同创办，成立于2001年。",
        );
    });

    it("protects current role-holder questions for a non-school business", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "The clinic was founded by Dr. Rivera in 2018.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "model value",
        }, "Who is the current manager?", "en");

        expect(answer.answer).toBe(
            "I cannot confirm the current manager yet. You can ask a support specialist to verify this further. The clinic was founded by Dr. Rivera in 2018.",
        );
    });

    it("uses a support-specialist option instead of external research, retry, or contact copy", () =>
    {
        const answer = enforceCustomerControlledHandoff({
            answer: "I checked the information available but cannot confirm the online teaching mode.",
            citationChunkIds: [],
            confidence: 0,
            decision: "clarify",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "model value",
        }, "Can I study from home?", "en");
        const prompt = buildRagPrompt({
            evidence,
            language: "en",
            question: "Can I study from home?",
            recentMessages: [],
        });

        expect(answer.answer).toContain("support specialist");
        expect(answer.answer).not.toContain("I checked");
        expect(prompt.system).toContain("Speak as part of the company");
        expect(prompt.system).toContain("Never tell the customer to try again");
        expect(prompt.system).toContain("Never tell the customer to contact the company or business");
        expect(prompt.system).toContain("根据我查到的资料");
        expect(prompt.system).not.toContain("admissions");
        expect(prompt.system).not.toContain("school");
    });

    it("never asks a customer to retry after an unavailable confirmation", () =>
    {
        const answer = createSafeClarification(
            "你们学校校长是谁？",
            "zh-CN",
            "system_error",
        );

        expect(answer.answer).toContain("客服专员");
        expect(answer.answer).toContain("暂时没法准确答复");
        expect(answer.answer).not.toContain("再试");
        expect(answer.answer).not.toContain("查资料");
    });

    it("builds a tenant-neutral corrective retry without changing the customer evidence payload", () =>
    {
        const input = {
            evidence: [{
                chunkId: "40000000-0000-4000-a000-000000000020",
                combinedScore: 0.93,
                content: "Appointments may be rescheduled without a fee at least 24 hours in advance.",
                sourceLocator: {
                    title: "Appointment policy",
                },
            }],
            language: "en" as const,
            question: "Can I move my appointment?",
            recentMessages: [],
        };
        const original = buildRagPrompt(input);
        const repair = buildRagRepairPrompt(input, "grounding_validation");

        expect(repair.user).toBe(original.user);
        expect(repair.system).not.toBe(original.system);
        expect(repair.system).toContain("CORRECTIVE RETRY");
        expect(repair.system).toContain("copy one to five citationChunkIds exactly");
        expect(repair.system).not.toContain("school admissions");
        expect(repair.system).not.toContain("古筝");
    });

    it("rejects a structurally valid citation outside the retrieval set", () =>
    {
        expect(() => validateGroundedAnswer({
            answer: "Unsupported",
            citationChunkIds: ["40000000-0000-4000-a000-000000000002"],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "unsupported",
        }, evidence)).toThrow(RagValidationError);
    });
});
