# SmartService 操作指南 — 让 Codex 牵头完成项目

## 当前进度

G0 已批准，Day 1–3 已在本地完成并通过验证。当前环境已经具备 pnpm workspace、React 登录壳、Hono Worker、Supabase 有序 migration、强制 RLS、三套虚构 Demo 身份，以及 PDF / DOCX / URL 知识导入路径。公开 `/chat` 页面已完成中英文 RAG、范围受限的 Conversation Token、Turnstile、混合检索、Structured Output、引用校验、知识不足转人工、Cursor/ETag 轮询和完整审计记录。下一步是 Day 4 Guardrail 和客服工作台。

## 推荐工作方式

- 使用 ChatGPT/Codex 桌面应用中的 Codex 项目作为“项目经理 + 主开发”。
- 代码仓库本地打开，VS Code 用于人工查看、调试和必要的小改动。
- 第一次使用 Local 模式完成 Gate 0 和仓库骨架。
- 独立的测试、审查和调查工作可以交给 Subagents 或 Worktrees；数据库架构和关键业务代码由主 Lead 线程统一集成。
- 不使用无沙箱的 `--yolo` 模式。

## 第一次开工

1. 使用私有 GitHub 仓库 `https://github.com/helloxtech/SmartService.git`。
2. 将本 ZIP 解压后的全部内容复制到仓库根目录。
3. 初始化并提交文档：

```bash
git init
git add .
git commit -m "docs: initialize SmartService lead pack"
git branch -M main
```

4. 创建 `.env.local`，只放真实凭证；不要提交。
5. 在 Codex 桌面应用中选择该本地仓库，使用 Local 模式，新建一个名为 `Project Lead` 的持久聊天。
6. 把 `CODEX_PROJECT_LEAD_PROMPT.md` 全文发给它。
7. 首次启动时 Codex 只完成 Gate 0；本仓库的 Gate 0 已经批准，后续应从 `docs/STATUS.md` 记录的当前切片继续。

## 本地基础命令

```bash
pnpm install
pnpm db:start
pnpm db:reset
pnpm bootstrap:local
pnpm verify:local-access
pnpm check
pnpm test:e2e
pnpm db:test
pnpm db:lint
pnpm fixtures:ingestion
pnpm verify:ingestion
pnpm verify:conversation
```

`pnpm db:start` 和 `pnpm db:status` 会隐藏 Supabase 生成的本地凭证。三套虚构 Demo 登录值只写入被 Git 忽略且权限为 `0600` 的 `.env.local`，不要粘贴到聊天或提交到 Git。

运行 `pnpm verify:ingestion` 前，先执行 `pnpm db:reset` 和 `pnpm bootstrap:local`。该验证会用真实 Chromium 登录，导入固定 PDF、DOCX 和 URL fixture，检查 3 个 Ready source、Embedding、禁用/启用以及 390 像素移动端布局。截图只写入 `/tmp`。

知识导入完成后，运行 `pnpm verify:conversation`。该验证会通过本地 Worker 和 Supabase 跑完 12 个范围内问题及 8 个范围外问题，并检查引用、Knowledge Gap、转人工包、Token 隔离、幂等和轮询缓存。

本地知识导入、Chat 和 Turnstile 明确使用 deterministic mock provider，不产生付费调用；G1 前仍需要补齐 Hosted Supabase、R2、Queue、Browser Run、Turnstile 和 OpenAI 的真实验证。Production 配置不会允许任何 mock provider。

## 你应该怎样提供资源

不要把 API Key 粘贴到聊天中。

- 普通本地密钥：写入 `.env.local`。
- Cloudflare Worker 部署密钥：使用 `wrangler secret put <NAME>`。
- GitHub Actions 密钥：放入 GitHub Repository Secrets。
- Codex-managed local worktree 需要的忽略文件：由 `.worktreeinclude` 指定复制。

填好后，只需回复 Codex：

```text
Gate 0 resources have been provisioned in the documented local/provider secret locations.
Verify them with non-destructive checks without printing any secret values.
Update docs/RESOURCE_REQUEST.md and report only remaining blockers.
If all BLOCKING-NOW and BLOCKING-P0 items are ready, start P0 and continue autonomously through its vertical slices.
```

## 你只需要重点介入三次

1. G0：提供账户、密钥、权限、预算和 Demo 输入。
2. G1：看 P0 演示和测试结果，决定是否进入 P1。
3. G2：看 P1 语音、打断、延迟和完整演示结果。

R11 只有在 G2 获用户接受后、P0/P1 全绿、无严重缺陷且记录决策时至少剩余 4 个不间断工作小时时才做。

## 权限建议

使用默认 Auto / workspace-write / on-request：

- 允许 Codex在仓库内读写和运行测试。
- 网络访问、仓库外写入、部署和高权限操作仍需批准。
- 允许无破坏性的本地命令和测试。
- 对数据库 reset、公开部署、资源创建、付费操作保持人工确认。

## 每天不需要重新解释需求

Codex 必须把长期状态写进：

- `AGENTS.md`
- `docs/STATUS.md`
- `docs/DECISIONS.md`
- `docs/RESOURCE_REQUEST.md`

聊天中只处理当前阻塞和验收，不重复粘贴整份规格。

## 正常的结束报告应该包含

- 完成了哪个垂直切片。
- 哪些文件和 migration 改了。
- 跑了哪些命令和测试。
- 哪些测试通过、失败或未运行。
- 实际 provider 调用和成本。
- 当前阻塞、风险和下一步。
