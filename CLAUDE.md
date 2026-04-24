# CLAUDE.md

Claude Code 专属补丁。基础规则见 [AGENTS.md](AGENTS.md)，此处只列与其冲突或补充的部分。

## Must-read before editing
- [AGENTS.md](AGENTS.md) — repo map、editing rules、delivery expectations
- [docs/roadmap.md](docs/roadmap.md) — 当前待做 / design questions / explicit non-goals
- [docs/polycli-v1-public-surface.md](docs/polycli-v1-public-surface.md) — utils/timing 的 v1 npm 公共契约；runtime/provider adapters 仍是内部实现
- [docs/session-memory-2026-04-22.md](docs/session-memory-2026-04-22.md) — 最近一次 Codex handoff；包含 release state

## Architecture boundary（硬约束）
这是 Path B monorepo，**不是** framework。违反以下任一条即为方向错误：

- 不要引入 shared runtime 基类、session 继承树、provider adapter 框架
- 不要把 provider-specific 协议解析挪进 `polycli-utils`
- `polycli-timing` 的四态（`measured` / `zero` / `missing` / `unsupported`）不可折叠或合并
- `cold` / `retry` 指标**故意未实现**（上游 CLI 无稳定信号）；禁止 fake、禁止静默降级成 `missing`
- legacy 仓库（`gemini-plugin-cc` / `qwen-plugin-cc` / `kimi-plugin-cc` / `minimax-plugin-cc`）仅作 reference，不要 grep、不要编辑

## 运行命令的优先级

| 任务类型 | 命令 |
|---|---|
| 动单个 package | `node --test packages/<pkg>/test/*.test.js` 先跑 |
| 改 runtime / host 之一 | 再跑 `npm test`（会先 `build:plugins` 再跑全量 119+ 测试） |
| 要发布前校验 | `npm run release:check`（依赖 `claude plugin validate`） |

注意 `npm test` 已内含 `build:plugins`，**不要**另外先手动 build 再 test。

## Claude-specific provider notes
- `claude` runtime 用 `--output-format stream-json` 时必须带 `--verbose`，这是 CLI 契约
- `claude` 可能通过 `subtype: "error"` 而非 `is_error` 报错，sync/streaming 两路错误处理必须对齐
- `gemini` 无独立 auth-status 子命令，auth probe 是推断式；不要把 timeout/429 倒退回 `loggedIn=false`
- `pi` 在 trivial prompt 上仍可能调 tool，属上游行为；非本地解析问题

## Cross-AI 协作约定（源自全局 CLAUDE.md）
- 每次落代码改动需同步更新根 `CHANGELOG.md`（reverse chronological，扁平条目，英文）
- 纠正/教训记入 `tasks/lessons.md`（目前尚未建立，出现首条时再创建）
- Memory 写在 `~/.claude/projects/-Users-bing--Code--polycli/memory/` 下（英文、分层）
