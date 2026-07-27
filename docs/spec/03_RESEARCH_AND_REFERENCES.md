# SmartService — 技术调研与选型依据

> 研究日期：July 26, 2026
> 原则：以下优先使用官方产品文档和供应商工程资料。本文件用于避免 Codex 重复选型和浪费上下文。

## 1. 来源需求

主要需求来源：`source/AI客服demo需求拆解_v0.1.pdf`。

来源中的关键边界：

- Demo 是诊断现场演示，不是完整产品。
- 知识库可替换，适配不同企业。
- 人工把关关键决定和承诺；转人工是显性卖点。
- P0 为文字闭环，P1 为网页语音，P2 为增强项。
- 主对话、红线检查、摘要按任务分工，不自研模型。
- 语音采用 ASR→LLM→TTS，Demo 目标放宽到约 1.5 秒并支持基础打断。

## 2. 为什么选择 Supabase

Supabase Free 当前适合 Demo：500 MB 数据库、1 GB Storage、50,000 MAU、500,000 Edge Function invocations、200 Realtime peak connections 和 2 million Realtime messages。管理数据和知识 Chunk 体量远低于此。

RLS 是核心原因：Supabase 官方要求 exposed schema 的表启用 RLS，并可与 Auth 组合做逐行授权。项目要求多租户隔离，因此把授权落到 PostgreSQL，而不是只依赖前端过滤。

pgvector 支持语义检索，HNSW 对 `vector` 的索引维度上限为 2000；因此把 `text-embedding-3-large` 缩短到 1024 维，可保持高质量非英文 Embedding，又方便建立 HNSW。

官方资料：

```text
https://supabase.com/pricing
https://supabase.com/docs/guides/database/postgres/row-level-security
https://supabase.com/docs/guides/ai/semantic-search
https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes
```

## 3. 为什么选择 Cloudflare

### Workers

Workers Free 当前包含每日 100,000 请求，但每次 invocation CPU 较紧。适合 API、鉴权、Token、Webhook 和轻量 orchestration，不适合在服务端同步解析大型 PDF。故本方案让浏览器提取 PDF/DOCX 文本。

### Queues

Queues 已支持 Workers Free；免费层每日 10,000 operations，付费层包含每月一百万 operations。Demo 异步任务量很小。Queue 消息只携带 ID/R2 key，避免因 64 KB 计费单位和 payload 过大浪费。

### R2

R2 Standard 每月免费 10 GB、100 万 Class A、1000 万 Class B，公网 egress 免费。适合原始文件和提取结果。浏览器直传使用短时单对象 presigned PUT URL；官方要求 R2 S3 Access Key ID/Secret Access Key 由服务端签名，浏览器只取得 bearer URL，并用 Content-Type 签名限制和 bucket CORS 约束 origin。

### Browser Run `/crawl`

Cloudflare 在 2026 年提供 `/crawl` Quick Action，可从起始 URL 同域抓取并返回 HTML、Markdown 或 JSON，正好用于 RAG 知识摄入。Free 当前 10 分钟 browser time/天，`/crawl` 免费层最多 5 jobs/天和每次 100 页；足够 Demo，但由于功能较新，保留 provider adapter 和 Firecrawl fallback。

官方资料：

```text
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/queues/platform/pricing/
https://developers.cloudflare.com/r2/pricing/
https://developers.cloudflare.com/r2/api/s3/presigned-urls/
https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/
https://developers.cloudflare.com/browser-run/pricing/
https://developers.cloudflare.com/browser-run/limits/
```

## 4. 为什么不用额外向量数据库

本项目的文档数量和 Chunk 数较小。Supabase PostgreSQL 已经是权威业务数据源，pgvector 允许在同一个 SQL 查询中应用 `organization_id`、source enabled、version 和权限过滤。引入 Pinecone、Weaviate 或 Vectorize 会增加：

- 第二套租户授权。
- 数据同步。
- 清理和版本一致性。
- 额外密钥和费用。

因此两周 Demo 不引入。

## 5. OpenAI 模型选择

### `gpt-5-mini`

官方当前定价为每百万输入 tokens $0.25、输出 $2.00，支持 Structured Outputs 和 function calling。虽然 OpenAI 对新的低延迟工作负载推荐更新的 GPT-5.6 Terra，但其成本更高；本项目任务定义明确、预算敏感，先使用 `gpt-5-mini`，通过环境变量保持可升级性。

### `gpt-5-nano`

官方当前定价为输入 $0.05/百万、输出 $0.40/百万，官方定位适合 summarization 和 classification。适合红线、摘要和 R11。

### `text-embedding-3-large`

官方当前定价 $0.13/百万 tokens，并定位为英文和非英文最强 Embedding。中文知识库优先质量。使用 `dimensions=1024`，以匹配 HNSW 限制和降低存储。

官方资料：

```text
https://developers.openai.com/api/docs/models/gpt-5-mini
https://developers.openai.com/api/docs/models/gpt-5-nano
https://developers.openai.com/api/docs/models/text-embedding-3-large
https://developers.openai.com/api/docs/models/text-embedding-3-small
```

## 6. RAG 方法依据

Supabase 官方建议语义搜索可以与关键词搜索组合。Cresta 的知识工程资料强调：

- 知识需要结构化、元数据和权限。
- 检索应结合语义和精确匹配。
- 回答要带来源。
- 证据不足时 abstain，而不是补全猜测。
- 需要从未回答问题发现知识缺口。

本 Demo 因此采用：

- 向量检索主排序。
- 型号/数字/术语 exact + trigram boost。
- 引用 ID 服务端验证。
- 证据不足转人工并记录 gap。

Cresta 资料：

```text
https://cresta.com/blog/ai-ready-knowledge-for-contact-centers-closing-the-gap-between-kbs-and-ai
```

## 7. Guardrail 依据

Cresta 公开工程思路包含系统级规则、并行监督分类器和对抗性测试。与来源文档“主模型并行红线检查”一致。

两周 Demo 选择“硬规则 + 小模型监督 + 输出验证”，而不是复杂 policy engine。文字模式先检查再发送，牺牲少量 streaming 体验换取演示稳定性。

官方资料：

```text
https://cresta.com/blog/crestas-three-strategic-pillars-of-ai-agent-defense-for-enterprise-security-and-compliance
```

## 8. 为什么选择 LiveKit Agents

LiveKit Agents 官方支持 Python 和 Node.js；Node.js quickstart 要求 Node 20+ 和 pnpm，适合与项目 TypeScript 单栈协作。LiveKit 提供：

- WebRTC transport。
- Agent deployment。
- STT/LLM/TTS provider plugins。
- turn detector。
- adaptive interruption。
- false interruption recovery。
- preemptive generation。
- observability。

因此不需要自己从零实现音频 transport、用户打断和 Agent lifecycle，也不需要使用 Vapi/Retell 的更高层封装。

LiveKit Build 免费层足够短期测试；官方 quota 文档也说明 Build 有 cold-start，故 UI 必须显示 warming。

官方资料：

```text
https://docs.livekit.io/agents/start/voice-ai/
https://docs.livekit.io/agents/logic/turns/
https://docs.livekit.io/agents/logic/turns/tuning/
https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
https://docs.livekit.io/deploy/admin/quotas-and-limits/
```

## 9. 为什么采用 STT→LLM→TTS，而不是 speech-to-speech

Cresta 的 2025 实时语音工程文章明确以 stitched approach 为重点，并表示当时 voice-to-voice 对企业场景仍不够可控。它还指出：

- 超过约 1.5 秒体验会快速下降。
- 应测端到端分布，不只看平均或 median。
- WebRTC 相比传统电话可减少延迟。
- semantic turn detection 能减少错误抢话。
- preemptive generation 可以降低感知延迟。
- 最新最大模型不一定最适合实时路径。
- Guardrail 可与主模型并行。

这些正好支持本方案的级联、P95、WebRTC 和分阶段埋点。

官方资料：

```text
https://cresta.com/blog/engineering-for-real-time-voice-agent-latency
```

## 10. Deepgram 选择

Deepgram Nova-3 目前支持简体中文 `zh`、`zh-CN`、`zh-Hans`，也支持繁体和粤语相关代码。当前官方价格页提供新账户 $200 credit，且说明 credit 不过期；Nova 系列按秒计费。对于少于 1000 分钟的 Demo，现金支出通常为零。

默认中文会话使用 `zh-CN`，英文会话使用 `en`。截至 July 26, 2026，Deepgram 官方 Nova-3 语言表虽然单独支持中文，但 `multi` 列出的自动多语种集合不包含中文；因此本 Demo 不用 `multi` 承诺同一 STT 流内中英自动切换。若供应商后续增加支持，必须先做实时精度和延迟验证再启用。

官方资料：

```text
https://deepgram.com/pricing
https://developers.deepgram.com/changelog/2026/3/31
https://developers.deepgram.com/docs/models-languages-overview/
```

## 11. ElevenLabs 选择

ElevenLabs Flash v2.5 官方定位为低延迟 TTS，约 75ms 模型生成延迟、支持 32 种语言并支持 streaming。适合语音 Agent。中文行业术语仍需用真实知识样本测试，voice ID 和 pronunciation dictionary 应配置化。

官方资料：

```text
https://elevenlabs.io/docs/overview/models
https://elevenlabs.io/text-to-speech-api
https://elevenlabs.io/pricing
```

## 12. 为什么不把 Resend 放入主线

原始 P0/P1 需求没有邮件收件箱或发送邮件要求。把 Resend 加入关键路径会引入域名验证、Inbound webhook、threading、delivery/bounce 状态和额外 UI，削弱两周目标。只有 R11 完成后仍有余量，才增加“把跟进建议发给内部人员”的 feature flag。

## 13. 成本公式

### LLM

```text
cost = input_tokens / 1,000,000 × input_price
     + output_tokens / 1,000,000 × output_price
```

### Embedding

```text
cost = embedding_input_tokens / 1,000,000 × embedding_price
```

### Voice

```text
voice_cost ≈ livekit_session_minutes
           + stt_audio_minutes
           + llm_text_tokens
           + tts_characters/audio_minutes
```

开发环境因为 LiveKit/Deepgram 等免费额度，通常只产生少量 OpenAI 和可能的 TTS 费用。

## 14. 选型决策记录

| 决策 | 选择 | 未选择 | 原因 |
|---|---|---|---|
| Web | React/Vite | Next.js full stack | Cloudflare Worker 已承担 API；Vite更轻 |
| API | Cloudflare Worker/Hono | Supabase Edge Functions everywhere | 避免双 API 层职责重叠 |
| Data | Supabase | Microsoft Dataverse | 成本和用户既有经验 |
| Files | R2 | 全放 Supabase Storage | 大文件/egress成本和既有 Cloudflare 栈 |
| Vector | pgvector | 独立 vector DB | 简化租户隔离和同步 |
| AI orchestration | direct SDK + Zod | LangChain/LlamaIndex | 两周范围小，减少抽象和 Token |
| Voice | LiveKit Agents | Vapi/Retell | 更高控制力、TypeScript、WebRTC和免费额度 |
| Voice model flow | STT→LLM→TTS | speech-to-speech | 引用、红线、Transcript和审计 |
| STT | Deepgram Nova-3 | 多家并接 | 中文支持、低成本、LiveKit integration |
| TTS | ElevenLabs Flash v2.5 | 同时接多家 | 低延迟、中文和快速实现 |
| P2 | R11 only | R8/R9/R10 | R11最小、复用总结调用、演示价值明确 |
