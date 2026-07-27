# SmartService — 两周 Codex 执行计划

> 时间假设：一名熟悉 Supabase、Cloudflare、React/TypeScript 的开发者全职使用 Codex。
> 目标：P0 一周，P1 一周；R11 仅在主线全绿后。

> **Lead-mode execution note:** The persistent Project Lead chat may continue from one day/slice to the next automatically after successful validation. Each slice still requires its own status update and focused commit. Human approval is required only at G0, G1, G2, and for genuine blockers or irreversible/billable actions.

## 0. Day 0 — 开工前半天

必须完成：

- 创建/确认 Supabase、Cloudflare、OpenAI、LiveKit、Deepgram、ElevenLabs 账户和密钥。
- 确认 Cloudflare Browser Run `/crawl` 权限。
- 确认一个可部署域名或 Pages preview URL。
- 把本文件包放到 repo `/docs/spec/`。
- Codex 读取 `00_CODEX_START_HERE.md` 并生成不超过一页的执行摘要。
- 创建 issue/任务清单，对应下文 Day 1–10。

## 1. Week 1 — P0

## Day 1：仓库、数据和安全骨架

### 目标

从空仓库得到可登录的多租户应用骨架和可重复数据库。

### 任务

- pnpm workspace。
- `apps/web`、`apps/api`、`apps/voice-agent`、shared packages。
- React/Vite/Tailwind/shadcn shell。
- Cloudflare Worker/Hono health endpoint。
- Supabase local/dev config。
- 应用 `blueprints/schema.sql` 思路，拆成有序 migrations。
- Auth 登录、organization membership、admin/agent role。
- RLS integration tests。
- `.env.example`、README、lint、format、typecheck、Vitest。

### 当日验收

- Admin 可登录并只看到自己的组织。
- Agent 权限正确。
- 租户隔离自动测试通过。
- CI 或本地一条命令运行 lint/typecheck/test。

### 不做

- 美化完整 UI。
- AI。
- Voice。

## Day 2：知识摄入

### 目标

完成 PDF/DOCX/URL 到 Ready 的垂直切片。

### 任务

- R2 signed upload。
- Browser PDF.js extraction，保留页码。
- Browser Mammoth DOCX extraction，保留标题。
- standard page calculator 和限制。
- URL SSRF validator。
- Cloudflare Browser Run provider + Firecrawl interface stub。
- Queue ingestion consumer。
- Chunking、content hash、版本和状态。
- OpenAI embedding，写 `vector(1024)`。
- Knowledge page：上传、URL、进度、错误、删除/重试。

### 当日验收

- fixture PDF/DOCX/URL 可 Ready。
- 重复任务不生成重复 Chunk。
- 不支持文件和私网 URL 被拒绝。

## Day 3：RAG Chat 和引用

### 目标

客户可以基于知识问答并查看来源。

### 任务

- Public conversation/token/Turnstile flow。
- Chat UI 和 message persistence。
- `match_knowledge_chunks` RPC。
- exact/trigram boost。
- OpenAI Structured Output。
- citation validation 和来源侧栏。
- 知识不足 refusal/handoff/gap。
- 使用 acceptance fixtures 建 evaluation harness。

### 当日验收

- 关键 in-scope 题正确带来源。
- 固定 out-of-scope 题全部拒答。
- 中英文切换可用。

## Day 4：红线、人工接管和总结

### 目标

完成 AI→人工闭环。

### 任务

- Guardrail rule admin UI。
- deterministic checker。
- nano supervisor。
- guardrail event/log。
- conversation state machine。
- incremental handoff summary。
- Agent inbox/details/takeover/human message。
- Close conversation + finalize Queue。
- Summary/follow-up script。

### 当日验收

- 交期/价格/竞品诱导全部拦截。
- 人工端目标 3 秒内看到摘要。
- 接管后 AI 停止自动回复。
- 关闭后总结生成。

## Day 5：看板、知识缺口、P0 稳定化

### 目标

P0 完整演示和自动测试全绿。

### 任务

- Dashboard aggregation/RPC。
- gap grouping/list/detail。
- one-click manual knowledge + re-test。
- Playwright 主流程。
- P0 eval report。
- 错误处理、空状态、loading、演示 UI polish。
- 固定演示脚本和备用组织。
- 只有 P0 已全绿且仍有时间，开始 R11 schema/list；否则不做。

### 当日验收

- 完整 5–7 分钟 P0 流程连续跑三次。
- `pnpm eval:p0` 和 guardrail eval 通过。
- P0 Blocker/Critical = 0。

## 2. Week 2 — P1

## Day 6：LiveKit Voice 骨架

### 目标

网页能连接 Node.js Voice Agent，获得麦克风和 Transcript。

### 任务

- 用 LiveKit Node starter 初始化 `apps/voice-agent`。
- LiveKit token endpoint。
- Voice UI 状态机。
- 点击后 warming，Ready 后启用麦克风。
- Deepgram Nova-3 STT。
- Transcript 持久化。
- Voice Agent 读取 organization/conversation config。

### 当日验收

- 中文语音得到稳定 transcript。
- Session 仅在点击后创建。
- 权限拒绝有友好降级。

## Day 7：Voice RAG + TTS

### 目标

完成端到端 STT→RAG→LLM→TTS。

### 任务

- Voice Agent 调用 shared assistant-core。
- GPT-5 mini answer。
- ElevenLabs Flash v2.5 streaming TTS。
- 屏幕显示 transcript 和 citations。
- Voice answer 限制 1–2 句。
- 知识外安全回复。

### 当日验收

- 中文和英文各完成 5 个固定问题。
- Text/Voice 对同一问题引用一致。
- 不朗读 URL/内部 ID。

## Day 8：Turn、打断和延迟

### 目标

对话不明显抢话，用户可以打断，并生成延迟报告。

### 任务

- LiveKit multilingual turn detector。
- adaptive interruption。
- false interruption resume。
- preemptive generation。
- 埋点所有阶段 timestamp。
- voice evaluation runner/手工辅助脚本。
- 调 endpointing、短回答和 provider connection reuse。

### 当日验收

- 明确插话停止播报并响应新意图。
- “嗯/好的”短 backchannel 大部分不导致永久停止。
- 至少 40 个计入统计回合（中英文各至少 20）的 latency report，并单列失败、cold start 和 warming。

## Day 9：Voice Guardrail、Handoff 和故障处理

### 目标

Voice 复用 P0 安全和人工闭环。

### 任务

- 候选回答 guardrail gate。
- 安全短句和预生成 fallback audio，可选。
- Voice handoff state。
- provider timeout/cancel/reconnect。
- 网络断开和 token refresh。
- Voice session/latency dashboard detail。

### 当日验收

- 语音交期诱导被拦截。
- 语音知识外进入人工。
- 断网/服务异常不死循环、不泄露堆栈。

## Day 10：综合验收和可选 R11

### 主线任务

- 全量 P0/P1 regression。
- 三次连续端到端 Demo。
- latency/guardrail/evaluation 报告归档。
- README 和部署手册。
- 版本标签。
- 清理 TODO 和调试开关。

### R11 进入条件

同时满足：

- P0 Done。
- P1 Done。
- 无 Blocker/Critical。
- Demo 连续三次成功。
- G2 已获用户接受，并且记录决策时至少还剩 4 个不间断工作小时。

### R11 任务

- Finalization schema 启用 ticket。
- 创建 ticket row。
- Ticket list/filter/detail。
- fixture classification tests。

若不满足进入条件，只保留 R11 的文档蓝图和关闭状态的 feature flag；不创建 schema/migration，也不实现 UI。

## 3. Codex 工作方式

每次给 Codex 的任务应是一个垂直、可验证切片，例如：

> Implement Day 2 PDF intake from browser extraction through R2, Queue, chunking, embedding and Ready status. Read the relevant sections of docs/spec first. Do not implement URL crawl yet. Add migrations, tests and documentation. Run typecheck and tests before reporting.

不要一次让 Codex“完成整个项目”。推荐每半天一个任务：

- 明确范围。
- 指定必须读取的文件。
- 指定不做的内容。
- 指定测试命令。
- 要求报告变更、测试和剩余风险。

## 4. Codex Token 节省规则

- 不让 Codex重复研究选型；直接引用 `03_RESEARCH_AND_REFERENCES.md`。
- 每次只加载当前任务相关章节，而不是反复粘贴全部规格。
- API/Schema 直接读取 `blueprints/`。
- 固定 fixtures，不让 Codex自己发明业务数据。
- 共享 `assistant-core`，避免文字和语音重复实现 Prompt/RAG。
- 使用 provider interfaces，不在每个模块写不同 SDK wrapper。
- 失败日志只提供相关片段，不整份 dump。
- 先让 Codex运行 repo search，再修改；不要反复解释已有代码。

## 5. 时间可行性判断

两周计划偏紧，但对有 Supabase/Cloudflare 经验的开发者、严格 Demo 范围和 Codex 辅助是可行的。最大不确定性不是普通 CRUD，而是：

- URL Crawl 账户权限。
- AI 固定测试集校准。
- 中文 Voice 发音和识别。
- P95 1.5 秒和打断调参。

所以 P0 必须在第一周结束时真正全绿。不要把 Voice 提前到 P0 未稳定时，也不要让 R11 挤占 Voice 调试。
