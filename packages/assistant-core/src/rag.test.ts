import { describe, expect, it } from "vitest";

import {
    buildRagAnswerJsonSchema,
    buildRagRepairPrompt,
    buildCrossLanguageRetrievalQuestion,
    buildRagPrompt,
    buildQuestionPartEvidenceScope,
    buildRetrievalQuestion,
    buildRetrievalQuestions,
    createConversationalAcknowledgement,
    createExplicitStableFactAnswer,
    createSafeClarification,
    DeterministicRagAnswerProvider,
    enforceCustomerControlledHandoff,
    extractQuestionSubjectAnchors,
    filterEvidenceForQuestionContext,
    getOrganizationProfileRecoveryLimit,
    getRetrievalCandidateLimit,
    isDirectlyGroundedOfferingAnswer,
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
        expect(followUp).toContain("latest customer question: Are you sure?");
        expect(buildRetrievalQuestion("请问有什么课程？", recentMessages))
            .toBe("请问有什么课程？");
    });

    it("handles social and channel-check turns without retrieval or pretend citations", () =>
    {
        expect(createConversationalAcknowledgement("嘿，能听到我说话吗？", "zh-CN"))
            .toMatchObject({
                answer: "可以，我听到了。请问您想了解什么？",
                citationChunkIds: [],
                decision: "acknowledge",
                handoffReason: null,
            });
        expect(createConversationalAcknowledgement("Thanks!", "en"))
            .toMatchObject({
                citationChunkIds: [],
                decision: "acknowledge",
            });
        expect(createConversationalAcknowledgement(
            "Can you hear me and tell me the price?",
            "en",
        )).toBeNull();
        expect(createConversationalAcknowledgement("那你能答复什么问题？", "zh-CN"))
            .toMatchObject({
                answer: expect.stringContaining("产品或服务"),
                citationChunkIds: [],
                decision: "acknowledge",
            });
        expect(createConversationalAcknowledgement("吗？", "zh-CN"))
            .toMatchObject({
                answer: "我在听。您可以把问题接着说完。",
                decision: "acknowledge",
            });
    });

    it("recognizes industry-neutral subject anchors and anaphoric follow-ups", () =>
    {
        expect(extractQuestionSubjectAnchors("太阳能板的安装工程师是谁？"))
            .toContain("太阳能板");
        expect(extractQuestionSubjectAnchors("What is the AX-9 price?"))
            .toContain("ax-9");
        expect(extractQuestionSubjectAnchors("你们有古筝课程吗？"))
            .toEqual(["古筝"]);
        expect(isContextDependentFollowUp("可以看看他们的资料吗？")).toBe(true);

        const query = buildRetrievalQuestion("可以看看他们的资料吗？", [{
            senderType: "customer",
            text: "太阳能板的安装工程师是谁？",
        }]);

        expect(query).toContain("latest customer question: 可以看看他们的资料吗？");
        expect(query).toContain("太阳能板的安装工程师");
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

    it("adds only explicit stable-fact evidence to a missing focused part scope", () =>
    {
        const aboutEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000002",
            content: "The company was founded in 2001. Address: 2335-8888 Odlin Cres, Richmond, B.C.",
        };
        const lessonEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000003",
            content: "Teaching methods include one-to-one lectures and demonstrations.",
        };
        const scopes = buildQuestionPartEvidenceScope([
            "你们学校校长是谁",
            "哪年成立的",
            "上课要去学校上，还是可以在家上",
            "学校地址是哪里",
        ], [
            [aboutEvidence],
            [],
            [lessonEvidence],
            [],
        ], [aboutEvidence, lessonEvidence]);

        expect(scopes).toEqual([
            [aboutEvidence.chunkId],
            [aboutEvidence.chunkId],
            [lessonEvidence.chunkId],
            [aboutEvidence.chunkId],
        ]);
    });

    it("projects explicit stable facts without model-added locations or fragments", () =>
    {
        const aboutEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "The company was founded in 2001. Address: 2335-8888 Odlin Cres, Richmond, B.C.",
        };

        expect(createExplicitStableFactAnswer(
            "你们是什么时候成立的？",
            [aboutEvidence],
            "zh-CN",
        )).toMatchObject({
            answer: "我们成立于2001年。",
            citationChunkIds: [aboutEvidence.chunkId],
            decision: "answer",
        });
        expect(createExplicitStableFactAnswer(
            "你们是什么时候成立的？",
            [{
                ...aboutEvidence,
                content: "本机构由两位行业专家于2016年创办，持续服务本地客户。",
            }],
            "zh-CN",
        )).toMatchObject({
            answer: "我们成立于2016年。",
            citationChunkIds: [aboutEvidence.chunkId],
            decision: "answer",
        });
        expect(createExplicitStableFactAnswer(
            "What is your address?",
            [aboutEvidence],
            "en",
        )).toMatchObject({
            answer: "Our address is 2335-8888 Odlin Cres.",
            citationChunkIds: [aboutEvidence.chunkId],
            decision: "answer",
        });
        expect(createExplicitStableFactAnswer(
            "What does it cost?",
            [aboutEvidence],
            "en",
        )).toBeNull();
    });

    it("bridges common Chinese business questions into English website search terms", () =>
    {
        const foundedQuery = buildCrossLanguageRetrievalQuestion("哪年成立的");
        const addressQuery = buildCrossLanguageRetrievalQuestion("学校地址是哪里");
        const appointmentQuery = buildCrossLanguageRetrievalQuestion("预约可以改期或取消吗？");
        const returnsQuery = buildCrossLanguageRetrievalQuestion("产品可以退货或保修吗？");
        const courseQuery = buildCrossLanguageRetrievalQuestion("你们有古筝课程吗？");
        const organizationNameQuery = buildCrossLanguageRetrievalQuestion("你们学校叫什么名字？");

        expect(foundedQuery).toContain("founded in");
        expect(foundedQuery).toContain("established");
        expect(foundedQuery).toContain("创办");
        expect(foundedQuery).toContain("about us");
        expect(foundedQuery).not.toContain("business");
        expect(addressQuery).toContain("address");
        expect(addressQuery).not.toContain("学校地址是哪里");
        expect(addressQuery).not.toContain("business");
        expect(appointmentQuery).toContain("reschedule");
        expect(appointmentQuery).toContain("cancellation");
        expect(returnsQuery).toContain("return");
        expect(returnsQuery).toContain("warranty");
        expect(courseQuery.startsWith("古筝 你们有古筝课程吗？")).toBe(true);
        expect(courseQuery).not.toContain("product");
        expect(organizationNameQuery).toContain("official name");
        expect(organizationNameQuery).toContain("全称");
        expect(organizationNameQuery).toContain("about us");
        expect(organizationNameQuery).not.toContain("business");
        expect(buildCrossLanguageRetrievalQuestion("What is the address?"))
            .toBe("What is the address?");
        expect(getRetrievalCandidateLimit("你们是什么时候成立的？")).toBe(20);
        expect(getRetrievalCandidateLimit("你们公司叫什么名字？")).toBe(20);
        expect(getRetrievalCandidateLimit("你们的地址在哪里？")).toBe(20);
        expect(getRetrievalCandidateLimit("你们有安装服务吗？")).toBe(5);
        expect(getOrganizationProfileRecoveryLimit("你们是什么时候成立的？")).toBe(100);
        expect(getOrganizationProfileRecoveryLimit("你们有安装服务吗？")).toBeNull();
    });

    it("recognizes only cited non-volatile offering confirmations", () =>
    {
        const serviceEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "Residential solar panel installation service is offered by our certified installation team.",
            sourceLocator: {
                title: "Solar installation services",
            },
        };

        expect(isDirectlyGroundedOfferingAnswer(
            "你们提供太阳能板安装服务吗？",
            "是的，我们提供太阳能板安装服务。",
            [serviceEvidence],
        )).toBe(true);
        expect(isDirectlyGroundedOfferingAnswer(
            "太阳能板现在有现货吗？",
            "是的，我们现在有现货。",
            [serviceEvidence],
        )).toBe(false);
        expect(isDirectlyGroundedOfferingAnswer(
            "你们提供太阳能板安装服务吗？",
            "是的，我们提供太阳能板安装服务。",
            [{ ...serviceEvidence, content: "Our office is open Monday through Friday." }],
        )).toBe(false);
        expect(isDirectlyGroundedOfferingAnswer(
            "你们提供太阳能板安装服务吗？",
            "是的，我们提供屋顶清洁服务。",
            [serviceEvidence],
        )).toBe(false);
    });

    it("turns a cited bare organization name into a natural first-person answer", () =>
    {
        const organizationEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "About Us | Canada YC Music Academy",
            sourceLocator: {
                title: "About Us",
            },
        };
        const answer = validateGroundedAnswer({
            answer: "Canada YC Music Academy",
            citationChunkIds: [organizationEvidence.chunkId],
            confidence: 0.95,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "你们学校叫什么名字",
        }, [organizationEvidence], {
            language: "zh-CN",
            questionParts: ["你们学校叫什么名字？"],
        });

        expect(answer.answer).toBe("我们叫 Canada YC Music Academy。");
        expect(answer.citationChunkIds).toEqual([organizationEvidence.chunkId]);
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

    it("filters anaphoric evidence by the prior cross-industry subject and facet", () =>
    {
        const installerEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "太阳能板安装工程师 Maria Chen 拥有十年现场安装经验。",
            sourceLocator: {
                title: "安装团队简介",
            },
        };
        const unrelatedEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000006",
            content: "前端工程师张健负责响应式网页排版。",
            sourceLocator: {
                title: "软件开发团队",
            },
        };

        expect(filterEvidenceForQuestionContext(
            "可以看看他们的资料吗？",
            [{
                senderType: "customer",
                text: "太阳能板的安装工程师是谁？",
            }],
            [unrelatedEvidence, installerEvidence],
        )).toEqual([installerEvidence]);
    });

    it("inherits only the nearest explicit subject for an anaphoric follow-up", () =>
    {
        const solarEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "太阳能板安装工程师 Maria Chen 拥有十年现场安装经验。",
            sourceLocator: {
                title: "太阳能团队简介",
            },
        };
        const heatPumpEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000008",
            content: "热泵安装工程师李华拥有八年设备安装经验。",
            sourceLocator: {
                title: "热泵团队简介",
            },
        };

        expect(filterEvidenceForQuestionContext(
            "可以看看他的资料吗？",
            [{
                senderType: "customer",
                text: "太阳能板的安装工程师是谁？",
            }, {
                senderType: "ai",
                text: "相关信息如下。",
            }, {
                senderType: "customer",
                text: "热泵的安装工程师是谁？",
            }],
            [solarEvidence, heatPumpEvidence],
        )).toEqual([heatPumpEvidence]);
    });

    it("requires evidence for the requested answer facet before generation", () =>
    {
        const descriptionEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "太阳能板采用高效单晶硅电池。",
        };
        const priceEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000009",
            content: "太阳能板安装价格为每套 5,000 加元。",
        };

        expect(filterEvidenceForQuestionContext(
            "太阳能板的价格是多少？",
            [],
            [descriptionEvidence, priceEvidence],
        )).toEqual([priceEvidence]);
    });

    it("keeps organization-profile evidence for founding and company-name questions", () =>
    {
        const genericServiceEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            content: "We offer installation and maintenance services.",
            sourceLocator: {
                title: "Services",
            },
        };
        const aboutEvidence: RetrievedEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000010",
            content: "清景能源由工程师李明与何静于2018年创办，专注于住宅节能服务。",
            sourceLocator: {
                title: "About Us | Clearview Energy",
            },
        };

        expect(filterEvidenceForQuestionContext(
            "你们是什么时候成立的？",
            [],
            [genericServiceEvidence, aboutEvidence],
        )).toEqual([aboutEvidence]);
        expect(filterEvidenceForQuestionContext(
            "你们公司叫什么名字？",
            [],
            [genericServiceEvidence, aboutEvidence],
        )).toEqual([aboutEvidence]);
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

        expect(filterEvidenceForQuestionContext(
            "What is the NF-500 maximum flow?",
            [],
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
        expect(prompt.system).toContain("Answer this one customer question directly");
        expect(prompt.system).not.toContain("address every part separately");
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

    it("bounds short-answer prompt evidence and recent context without changing citation identity", () =>
    {
        const prompt = buildRagPrompt({
            evidence: [{
                ...fixtureEvidence,
                content: "Guzheng course details. ".repeat(300),
            }],
            language: "en",
            question: "Do you offer Guzheng lessons?",
            recentMessages: Array.from({ length: 6 }, (_, index) => ({
                senderType: index % 2 === 0 ? "customer" as const : "ai" as const,
                text: `Message ${index} `.repeat(100),
            })),
        });
        const payload = JSON.parse(prompt.user) as {
            EVIDENCE: Array<{ chunkId: string; content: string }>;
            RECENT_MESSAGES: Array<{ text: string }>;
        };

        expect(payload.EVIDENCE[0]?.chunkId).toBe(fixtureEvidence.chunkId);
        expect(payload.EVIDENCE[0]?.content.length).toBeLessThanOrEqual(2_800);
        expect(payload.RECENT_MESSAGES).toHaveLength(4);
        expect(payload.RECENT_MESSAGES.every((message) => message.text.length <= 800)).toBe(true);
    });

    it("passes the server-decomposed question parts to the model in stable order", () =>
    {
        const secondEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000002",
        };
        const questionParts = [
            "What is the warranty?",
            "What does it cost?",
            "When are you open?",
        ];
        const prompt = buildRagPrompt({
            evidence: [fixtureEvidence, secondEvidence],
            language: "en",
            question: questionParts.join(" "),
            questionPartEvidenceIds: [
                [fixtureEvidence.chunkId],
                [secondEvidence.chunkId],
                [],
            ],
            questionParts,
            recentMessages: [],
        });
        const payload = JSON.parse(prompt.user) as {
            QUESTION_PART_EVIDENCE: Array<{
                citationChunkIds: string[];
                partIndex: number;
            }>;
            QUESTION_PARTS: string[];
        };

        expect(payload.QUESTION_PARTS).toEqual(questionParts);
        expect(payload.QUESTION_PART_EVIDENCE).toEqual([{
            citationChunkIds: [fixtureEvidence.chunkId],
            partIndex: 0,
        }, {
            citationChunkIds: [secondEvidence.chunkId],
            partIndex: 1,
        }, {
            citationChunkIds: [],
            partIndex: 2,
        }]);
        expect(prompt.system).toContain("never omit or merge a part");
        expect(prompt.system).toContain("retrieved for a different part");
    });

    it("binds Structured Output to the exact server-planned part count", () =>
    {
        const schema = buildRagAnswerJsonSchema(4) as {
            properties: {
                questionPartAnswers: {
                    maxItems: number;
                    minItems: number;
                };
            };
        };

        expect(schema.properties.questionPartAnswers).toMatchObject({
            maxItems: 4,
            minItems: 4,
        });
    });

    it("restricts generated citations to the retrieved chunk identifiers", () =>
    {
        const schema = buildRagAnswerJsonSchema(1, [fixtureEvidence.chunkId]) as {
            properties: {
                citationChunkIds: {
                    items: {
                        enum: string[];
                    };
                };
            };
        };

        expect(schema.properties.citationChunkIds.items.enum)
            .toEqual([fixtureEvidence.chunkId]);
    });

    it("omits multipart output fields for one atomic question", () =>
    {
        const schema = buildRagAnswerJsonSchema(1) as {
            properties: Record<string, unknown>;
            required: string[];
        };

        expect(schema.properties).not.toHaveProperty("questionPartAnswers");
        expect(schema.required).not.toContain("questionPartAnswers");
    });

    it("fails closed when a multipart answer omits one customer question", () =>
    {
        expect(() => validateGroundedAnswer({
            answer: "Partial answer.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "warranty price hours",
            questionPartAnswers: [{
                answer: "The warranty is one year.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "I cannot confirm the price yet.",
                citationChunkIds: [],
                partIndex: 1,
                supported: false,
            }],
        }, evidence, {
            language: "en",
            questionParts: [
                "What is the warranty?",
                "What does it cost?",
                "When are you open?",
            ],
        })).toThrow("did not address every customer question part");
    });

    it("composes every supported and unconfirmed multipart result in order", () =>
    {
        const answer = validateGroundedAnswer({
            answer: "Model aggregate is replaced by validated parts.",
            citationChunkIds: [],
            confidence: 0.8,
            decision: "clarify",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "warranty price hours",
            questionPartAnswers: [{
                answer: "The warranty is one year.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "I cannot confirm the price yet.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: false,
            }, {
                answer: "I cannot confirm the opening hours yet.",
                citationChunkIds: [],
                partIndex: 2,
                supported: false,
            }],
        }, evidence, {
            language: "en",
            questionParts: [
                "What is the warranty?",
                "What does it cost?",
                "When are you open?",
            ],
        });

        expect(answer.answer).toContain("1. The warranty is one year.");
        expect(answer.answer).toContain("2. I cannot confirm “What does it cost” yet.");
        expect(answer.answer).toContain("3. I cannot confirm “When are you open” yet.");
        expect(answer.answer).toContain("support specialist");
        expect(answer.citationChunkIds).toEqual([fixtureEvidence.chunkId]);
        expect(answer.decision).toBe("answer");
        expect(answer.handoffReason).toBeNull();
        expect(answer.questionPartAnswers?.[1]?.citationChunkIds).toEqual([]);
    });

    it("does not treat a bare role heading as the person who currently holds that role", () =>
    {
        const answer = validateGroundedAnswer({
            answer: "President. Founded in 2001.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "principal and founding year",
            questionPartAnswers: [{
                answer: "President",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "学校成立于2001年。",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, evidence, {
            language: "zh-CN",
            questionParts: [
                "你们学校校长是谁",
                "哪年成立的",
            ],
        });

        expect(answer.answer).toContain("1. 关于“你们学校校长是谁”，目前我这边还无法确认。");
        expect(answer.answer).not.toContain("President");
        expect(answer.answer).toContain("2. 学校成立于2001年。");
        expect(answer.questionPartAnswers?.[0]).toMatchObject({
            citationChunkIds: [],
            supported: false,
        });
    });

    it("does not combine one requested-role mention with a different nearby role assignment", () =>
    {
        const misleadingEvidence = {
            ...fixtureEvidence,
            content: "Principal menu item. President: Alice Chen. Founded by Alice Chen.",
        };
        const answer = validateGroundedAnswer({
            answer: "The current principal is Alice Chen.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "current principal",
        }, [misleadingEvidence], {
            language: "en",
            questionParts: ["Who is the current principal?"],
        });

        expect(answer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
        expect(answer.answer).toContain("support specialist");
    });

    it("accepts an explicitly named current role holder for a non-school tenant", () =>
    {
        const managerEvidence = {
            ...fixtureEvidence,
            content: "The current manager is Alice Chen.",
        };
        const answer = validateGroundedAnswer({
            answer: "The current manager is Alice Chen. We open at 9 AM.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "manager and hours",
            questionPartAnswers: [{
                answer: "The current manager is Alice Chen.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "We open at 9 AM.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, [managerEvidence], {
            language: "en",
            questionParts: [
                "Who is the current manager?",
                "When do you open?",
            ],
        });

        expect(answer.answer).toContain("1. The current manager is Alice Chen.");
        expect(answer.questionPartAnswers?.[0]?.supported).toBe(true);
    });

    it("does not answer a person-identity question with a generic experienced-team claim", () =>
    {
        const teamEvidence = {
            ...fixtureEvidence,
            content: "Our installation technicians have extensive field experience.",
        };
        const answer = validateGroundedAnswer({
            answer: "Your technician will be one of our experienced installation specialists.",
            citationChunkIds: [teamEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "which technician",
        }, [teamEvidence], {
            language: "en",
            questionParts: ["Which technician will install the equipment?"],
        });

        expect(answer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });

        const fragmentAnswer = validateGroundedAnswer({
            answer: "我们的安装工程师经验丰富。",
            citationChunkIds: [teamEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "太阳能板的安装工程师",
        }, [teamEvidence], {
            language: "zh-CN",
            questionParts: ["太阳能板的安装工程师"],
        });

        expect(fragmentAnswer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
    });

    it("accepts a named person only when the cited evidence names the same person", () =>
    {
        const installerEvidence = {
            ...fixtureEvidence,
            content: "Installation lead: Maria Chen.",
        };
        const answer = validateGroundedAnswer({
            answer: "Your installation lead is Maria Chen.",
            citationChunkIds: [installerEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "installation lead",
        }, [installerEvidence], {
            language: "en",
            questionParts: ["Who is the installation lead?"],
        });

        expect(answer).toMatchObject({
            citationChunkIds: [installerEvidence.chunkId],
            decision: "answer",
        });
    });

    it("does not substitute a named person from a different role", () =>
    {
        const founderEvidence = {
            ...fixtureEvidence,
            content: "Company founder: Maria Chen.",
        };
        const answer = validateGroundedAnswer({
            answer: "Your instructor is Maria Chen.",
            citationChunkIds: [founderEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "instructor identity",
        }, [founderEvidence], {
            language: "en",
            questionParts: ["Who is the instructor?"],
        });

        expect(answer).toMatchObject({
            citationChunkIds: [],
            decision: "clarify",
            handoffReason: "missing_knowledge",
        });
    });

    it("rejects a citation retrieved only for a different customer question part", () =>
    {
        const secondEvidence = {
            ...fixtureEvidence,
            chunkId: "40000000-0000-4000-a000-000000000002",
        };

        expect(() => validateGroundedAnswer({
            answer: "Two answers.",
            citationChunkIds: [fixtureEvidence.chunkId, secondEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "warranty and hours",
            questionPartAnswers: [{
                answer: "The warranty is one year.",
                citationChunkIds: [secondEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "We open at 9 AM.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, [fixtureEvidence, secondEvidence], {
            language: "en",
            questionPartEvidenceIds: [
                [fixtureEvidence.chunkId],
                [secondEvidence.chunkId],
            ],
            questionParts: [
                "What is the warranty?",
                "When do you open?",
            ],
        })).toThrow("retrieved only for another part");
    });

    it("rejects internal response-control syntax from customer-facing part text", () =>
    {
        expect(() => validateGroundedAnswer({
            answer: "Internal controls.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "warranty and hours",
            questionPartAnswers: [{
                answer: "decision=answer",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "We open at 9 AM.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, evidence, {
            language: "en",
            questionParts: [
                "What is the warranty?",
                "When do you open?",
            ],
        })).toThrow("internal response-control text");
    });

    it("requires explicit cited delivery-mode language before claiming at-home service", () =>
    {
        const answer = validateGroundedAnswer({
            answer: "At-home and warranty answers.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "home service and warranty",
            questionPartAnswers: [{
                answer: "We offer remote lessons that customers can take at home.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 0,
                supported: true,
            }, {
                answer: "The warranty is one year.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, evidence, {
            language: "en",
            questionParts: [
                "Can I take lessons at home?",
                "What is the warranty?",
            ],
        });

        expect(answer.answer).toContain("1. I cannot confirm “Can I take lessons at home” yet.");
        expect(answer.answer).not.toContain("We offer remote lessons");
        expect(answer.questionPartAnswers?.[0]).toMatchObject({
            citationChunkIds: [],
            supported: false,
        });
    });

    it("separates a Chinese specialist option from an English-period company fact", () =>
    {
        const answer = validateGroundedAnswer({
            answer: "One item is unavailable and one is supported.",
            citationChunkIds: [fixtureEvidence.chunkId],
            confidence: 0.8,
            decision: "answer",
            handoffReason: null,
            normalizedQuestion: "delivery and address",
            questionPartAnswers: [{
                answer: "Unconfirmed.",
                citationChunkIds: [],
                partIndex: 0,
                supported: false,
            }, {
                answer: "学校地址是2335-8888 Odlin Cres, Richmond, B.C.",
                citationChunkIds: [fixtureEvidence.chunkId],
                partIndex: 1,
                supported: true,
            }],
        }, evidence, {
            language: "zh-CN",
            questionParts: [
                "是否支持送货",
                "地址在哪里",
            ],
        });

        expect(answer.answer).toContain("B.C. 您可以选择请客服专员进一步核实。");
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

    it("normalizes harmless citation duplication and an answer-only handoff artifact", () =>
    {
        expect(validateGroundedAnswer({
            answer: "The NF-500 maximum flow rate is 300 litres per minute.",
            citationChunkIds: [fixtureEvidence.chunkId, fixtureEvidence.chunkId],
            confidence: 0.9,
            decision: "answer",
            handoffReason: "missing_knowledge",
            normalizedQuestion: "nf-500 maximum flow",
        }, evidence)).toMatchObject({
            citationChunkIds: [fixtureEvidence.chunkId],
            decision: "answer",
            handoffReason: null,
        });
    });
});
