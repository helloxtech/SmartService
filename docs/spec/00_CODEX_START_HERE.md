# SmartService — Codex 执行入口

> 产品名称：`SmartService`
> 仓库/package slug：`smartservice`
> 文档版本：1.0
> 日期：July 26, 2026
> 负责人：Forrest Zhang
> 目标周期：两周；P0 一周，P1 一周；R11 仅在主线完成后实施。

## 1. 给 Codex 的执行指令

请先完整阅读本文件，再按以下顺序读取：

1. `01_PROJECT_SPEC.md`：产品、范围、架构和实现细节。
2. `02_ACCEPTANCE_TESTS.md`：验收标准、测试矩阵和 Definition of Done。
3. `03_RESEARCH_AND_REFERENCES.md`：已经完成的技术调研和官方资料，不要重复做无意义的选型研究。
4. `04_DATA_AND_API_BLUEPRINT.md`：数据模型、API、AI 输出契约和队列消息格式。
5. `05_TWO_WEEK_EXECUTION_PLAN.md`：两周任务拆解、依赖和每日交付。
6. `blueprints/schema.sql`、`blueprints/openapi.yaml`、`blueprints/defaults.json`：可直接转成项目代码的蓝图。
7. `fixtures/`：知识库、文字测试和语音测试数据。

执行原则：

- 这是可现场演示的 Demo，不是生产级客服平台。
- 严格实现 P0、P1；仅在 P0/P1 验收通过后实施 R11。
- 不扩展 R8 历史会话挖掘、R9 仿真测试、R10 坐席辅助。
- 不接电话线、SIP、CRM、支付、邮件收件箱或外部工单系统。
- 不引入 Kubernetes、Kafka、独立向量数据库、LangChain、LlamaIndex、Vapi、Retell 或复杂微服务。
- 不重新讨论已经锁定的技术选型，除非官方 API 已失效或存在明确阻塞。
- 遇到非阻塞细节时采用本文默认值并继续；只有缺少密钥、账户权限或不可逆业务决定时才询问。
- 每完成一个垂直切片，运行测试、更新 README 和执行清单，然后提交小而清晰的 commit。
- 不要为了“看起来完整”加入超出范围的功能。

## 2. 项目一句话定义

构建 SmartService，一个可替换企业知识库的通用 AI 客服 Demo：企业管理员上传 PDF、DOCX 或官网，客户可以通过网页文字或语音进行中英文咨询；系统必须基于知识证据回答并展示出处，证据不足或触发红线时转人工；管理端能够查看交接摘要、会话总结、知识缺口、核心指标，以及可选的自动工单分类。

## 3. 两周锁定范围

| 优先级 | 模块 | 必须交付 |
|---|---|---|
| P0 | R1 知识摄入 | PDF、DOCX、官网 URL；显示处理状态；验收样例在 5 分钟内 Ready |
| P0 | R2 文字应答 | 中文必选、英文可用；基于知识回答；每条回答有可点击出处 |
| P0 | R2 拒答 | 固定验收集中的知识外问题 100% 拒答并触发转人工 |
| P0 | R3 红线检查 | 可配置红线；价格、交期、竞品等诱导输出被拦截并记录日志 |
| P0 | R4 人工接管 | 客服工作台接收会话、客户卡片、摘要、下一步动作；目标 3 秒内可见 |
| P0 | R5 会话总结 | 总结、意向、后续建议、个性化话术 |
| P0 | R6 管理看板 | 总会话、AI 自答率、转人工率、知识缺口；缺口可一键补知识 |
| P1 | R7 网页语音 | 浏览器麦克风；STT→LLM→TTS；基础打断；P95 首段声音目标 <1.5 秒 |
| P2 可选 | R11 工单分类 | 咨询/投诉/售后/其他 + 紧急度；生成内部工单列表，不接外部系统 |

## 4. 锁定技术栈

### 前端

- React + Vite + TypeScript
- Tailwind CSS + shadcn/ui
- Cloudflare Pages 或 Workers Static Assets

### API 和异步任务

- Cloudflare Workers + Hono + Zod
- Cloudflare Queues
- Cloudflare R2
- Cloudflare Browser Run `/crawl`；若账户不可用，才启用 Firecrawl 适配器
- Cloudflare Turnstile 用于公开 Chat/Voice 入口

### 数据和身份

- Supabase Auth
- Supabase PostgreSQL
- Row Level Security
- Supabase Realtime
- `pgvector` + `pg_trgm`

### AI

- 主对话：`gpt-5-mini`
- 红线、总结、分类：`gpt-5-nano`
- Embedding：`text-embedding-3-large`，输出维度 1024；模型和维度必须配置化
- OpenAI Responses API + Structured Outputs
- 不训练自有模型

### 语音

- LiveKit Cloud + LiveKit Agents Node.js/TypeScript
- Deepgram Nova-3，中文会话默认 `zh-CN`，英文会话使用 `en`；截至 Gate 0 审查时，供应商的 `multi` 语言集不包含中文，因此不要用 `multi` 承诺中英同会话自动切换
- ElevenLabs `eleven_flash_v2_5`
- LiveKit semantic turn detector、adaptive interruption、preemptive generation
- 浏览器 WebRTC，不接电话线

### 质量

- Vitest：单元和集成测试
- Playwright：浏览器端 E2E
- ESLint + Prettier + TypeScript strict
- Supabase migrations：所有数据库变更必须可重复执行

## 5. 明确不做

- 生产级 HA、跨区域容灾、正式 SLA。
- OCR 或扫描件 PDF。
- 复杂网页登录、反爬绕过或跨域无限爬取。
- 电话号码、PSTN、SIP、呼叫转接。
- 真实人工语音接管；Voice 的“转人工”只结束 AI 并打开人工工作台。
- CRM、ERP、真实工单系统、支付、库存写入。
- 多供应商自动故障切换。
- R8、R9、R10。
- SaaS 计费、Stripe、套餐管理。
- 完整邮件客服；Resend 只允许作为最后的可选跟进邮件，不在关键路径。

## 6. 关键产品口径

### “知识外问题 100% 拒答”

只指 `fixtures/tests/acceptance_cases.json` 中固定的知识外验收集必须全部拒答。不得在 UI、README 或演示话术中承诺开放生产环境永不出错。

### “五分钟上岗”

只对验收样例成立：一个不超过 10 页的同域网站，加一份不超过 20 页的可提取文本 PDF。更大输入可以处理，但不受五分钟承诺约束。

### “P95 <1.5 秒”

从系统判定用户说完，到浏览器实际播放 AI 第一段可听音频的第 95 百分位延迟。在稳定网络、已 Ready Agent、至少 40 个受控回合（中英文各至少 20）下用 nearest-rank 测量。不是平均值，也不是每次都保证；失败和 cold/warming 回合必须另行完整报告。

### “预热 Agent Session”

用户点击“开始语音”后，先建立 LiveKit 房间、启动 Agent、连接 STT/LLM/TTS并加载租户配置；Ready 后才启用麦克风。不得在用户未点击前长期占用 Agent Session。

## 7. 最终演示动线

1. 管理员输入示例企业官网 URL，上传产品 PDF。
2. 系统显示 Crawl、Parse、Chunk、Embed、Ready 进度。
3. 客户用中文提问，AI 回答并显示 PDF 页码或网页链接。
4. 客户用英文提问，AI 用英文回答并显示出处。
5. 客户诱导 AI 承诺价格或交期；输出被拦截，客户收到安全回复并进入转人工。
6. 人工工作台在 3 秒内显示客户卡片、已知事实、摘要、红线原因和下一步建议。
7. 结束会话后展示总结、意向标签、跟进建议和个性化话术。
8. 打开管理看板，展示 AI 自答率、转人工率和知识缺口；对一个缺口一键补知识后重新提问成功。
9. 进入网页语音，完成正常问答和一次打断。
10. 若有余量，展示 R11 工单类型和紧急度。

## 8. 开始实现前必须准备的密钥

- Supabase project URL、anon key、service role key、database URL
- Cloudflare account ID、Workers/Queues/R2/Browser Run 权限
- OpenAI API key，并至少有少量余额
- LiveKit project URL、API key、API secret
- Deepgram API key
- ElevenLabs API key 和 voice ID
- Turnstile site key/secret；本地开发可使用测试 key

缺少某个密钥时，先实现 provider interface、mock 和测试，不阻塞其他模块。

## 9. 代码规范

- TypeScript `strict: true`。
- 禁止无理由使用 `any`。
- 大括号另起一行。
- 每个自行编写的函数必须使用下面的 JSDoc 头；第三方生成文件、类型声明和 SQL 不受此限制。

```ts
/**
 * <FunctionName>
 * ----------------
 * <What it does … >
 *
 * July 26, 2026: Created / Updated by Forrest Zhang for SmartService
 */
```

- 所有外部调用必须有超时、错误分类、有限重试和结构化日志。
- 所有 Webhook/Queue consumer 必须幂等。
- 所有租户业务表必须包含 `organization_id` 并启用 RLS。
- `service_role` 绝不能暴露给浏览器。

## 10. 完成判断

只有在 `02_ACCEPTANCE_TESTS.md` 的 P0 和 P1 必须测试通过、演示脚本可以连续运行、文档与 `.env.example` 完整时，才算两周 Demo 完成。R11 不能以牺牲 P0/P1 稳定性为代价。
