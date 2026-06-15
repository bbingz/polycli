# Claude Workflow 编排设计

英文原文：[2026-06-15-claude-workflow-orchestration-design.md](./2026-06-15-claude-workflow-orchestration-design.md)

## 目标

定义一条可实现的路线：用 Codex xhigh 做 Claude Code Dynamic Workflows 的规划层，让它根据目标、仓库约束和验证门槛生成 workflow JavaScript；实际执行仍交给 Claude Code 官方 workflow runtime，并通过 polycli 现有的 Claude tmux TUI 路径启动，避免 Claude 子 agent 工作默认回到 `claude -p` 或 Agent SDK credit 路径。

最终结果应该让人类或 host agent 可以通过 polycli 生产、启动、观察和归档可复用的多 agent workflow run，同时不把 polycli 变成新的 agent framework。

## 当前事实

- Claude Code Dynamic Workflows 是 JavaScript 脚本，用来大规模编排 subagents，可后台运行，并把 run 进度保存在 Claude session 目录下。
- Claude Code 官方文档把 workflows 定位为 codebase audit、大规模迁移、交叉验证研究和可复用质量流程的合适原语。
- 从 2026-06-15 开始，Claude Agent SDK 和订阅计划里的 `claude -p` usage 会消耗单独的 Agent SDK credit。因此 SDK 和 `-p` 不适合作为本目标的默认路径。
- polycli 已经让 Claude `ask` 和 `review` 保持在 `executionMode: "tmux-tui"`，避免静默回到 `claude -p`。
- 本地 workflow 证据显示，有效模式是：
  - 实现类 wave 使用互斥文件所有权、TDD-first 指令和精确 focused test command；
  - review 类 wave 使用“一条 finding 一个 auditor”、逐字证据要求、adversarial verification 和 synthesis 阶段；
  - run metadata 已经可以从 Claude 的 `workflows/wf_*.json` 以及 `subagents/workflows/<run-id>/*.jsonl` 获取。

主要参考：

- Claude Dynamic Workflows: https://code.claude.com/docs/en/workflows
- Claude Agent SDK overview and 2026-06-15 credit note: https://code.claude.com/docs/en/agent-sdk/overview
- Claude subagents: https://code.claude.com/docs/en/sub-agents
- Codex subagents: https://developers.openai.com/codex/subagents
- Codex xhigh profile configuration: https://developers.openai.com/codex/config-advanced

## 非目标

- 不在 polycli 里实现通用 workflow runtime。
- 不添加 provider base class、agent base class 或 template-method runtime。
- 不把 `claude -p` 或 Claude Agent SDK 作为默认执行路径。
- 不要求所有 provider 都支持 Claude workflows。这个 track 明确是 Claude-runner-specific，polycli 只提供 host-neutral control 和 observability surface。
- worker task 不手工编辑生成出来的 companion bundles。
- 不把 workflow 脚本当成直接操作 shell 或文件系统的执行体。workflow 脚本只负责编排 agents；读取、编辑和命令执行由 Claude Code 权限模型下的 agents 完成。

## 推荐架构

### 1. Planner: Codex xhigh

Codex xhigh 用来根据用户目标、仓库约束和验证门槛创建或修订 workflow 脚本。

输入：

- objective text；
- repo root；
- 相关 AGENTS.md / CLAUDE.md / project memory context；
- 可选 scope，例如文件、目录、PR、audit finding list 或 release task；
- 期望 workflow kind：`implementation`、`review`、`research` 或 `release-closeout`。

输出：

- Claude Code 可运行的 workflow JavaScript 脚本；
- 一个短 manifest，包含 name、kind、owner、expected phases、file ownership 和 validation commands；
- 除非 caller 明确要求 planner patch 现有 workflow script，否则不编辑业务源代码。

Codex xhigh 是 planner/compiler，不是 executor。如果 planner 不可用，用户可以手工提供脚本并跳过 planning step。

### 2. Runner: Claude tmux TUI

polycli 通过 detached tmux TUI session 启动 Claude Code，保留现有 Claude cost-path 约束。

runner prompt 应该要求 Claude 执行一个明确的 workflow script，或从明确 prompt 创建 workflow。对于 saved workflows，可以要求 Claude 运行对应 saved slash command。runner 返回 detached startup metadata，而不是 LLM 答案：

```json
{
  "detached": true,
  "responseKind": "workflow_tui_session_started",
  "tmuxSession": "polycli-claude-...",
  "attachCommand": "tmux attach -t polycli-claude-...",
  "workflow": {
    "requested": true,
    "runId": null,
    "scriptPath": null,
    "status": "starting"
  }
}
```

`runId` 和 `scriptPath` 在启动时可以为 null，因为 workflow 是 Claude session 内部启动后才创建的。后续 observation commands 通过扫描 Claude workflow artifacts 补齐这些字段。

### 3. Workflow Runtime: Claude Code Dynamic Workflows

workflow script 保持为 Claude Code workflow script，不定义 polycli DSL。

允许使用的 workflow primitives：

- `meta`：命名 workflow 并描述 phases；
- `phase(...)`；
- `agent(...)`；
- `parallel(...)`；
- `pipeline(...)`：当前一阶段输出要喂给后一阶段时使用；
- worker 输出的 JSON schemas。

实现类 workflow 应该采用这个模式：

1. recon 或 plan 阶段，只读。
2. 一个或多个并行 implementation waves，每个 worker 有互斥文件所有权。
3. integrator 阶段，负责处理冲突、重新生成 bundles、运行 broad verification，并写 durable notes。

review 类 workflow 应该采用这个模式：

1. finder 或 claim-expansion 阶段。
2. 每个 claim 或区域一个独立 auditor。
3. 对会存活的 finding 做至少两个独立视角的 adversarial verification。
4. synthesis 阶段输出 status、evidence、severity、remediation 和 unverified scope。

### 4. Polycli Control Surface

新增一个 companion command group：

```text
workflow plan   [--kind <implementation|review|research|release-closeout>] [--profile <codex-profile>] [--output <path>] <objective>
workflow start  [--script <path> | --saved <name> | --prompt <text>] [--json]
workflow list   [--json]
workflow status [workflow-run-ref] [--json]
workflow result [workflow-run-ref] [--json]
workflow cancel [workflow-run-ref] [--json]
```

第一实现切片：

- 如果从 polycli 调 Codex 还不稳定，`workflow plan` 可以先做成 documented/manual handoff。
- `workflow start` 必须使用 Claude tmux TUI，并返回 detached startup metadata。
- `workflow list/status/result` 应读取已知 Claude config roots 下的 workflow artifacts，并与当前 workspace 关联。
- `workflow cancel` 可以延后，除非存在可靠的 TUI/workflow artifact stop path，不需要靠猜测。

第一切片不为 `workflow start` 添加 provider option。runner 明确是 Claude Code。其他 providers 仍可由 workflow author 在 worker prompts 中通过现有 polycli commands 调用。

### 5. Artifact Discovery

workflow observation 读取 Claude stores，不从模型输出里猜。

候选 roots：

- `~/.claude/projects/<encoded-workspace>/workflows/wf_*.json`
- `~/.claude/projects/<encoded-workspace>/subagents/workflows/<wf-id>/`
- 本地已经使用过的 wrapper stores：
  - `~/.claude-qwen/projects/<encoded-workspace>/...`
  - `~/.claude-minimax/projects/<encoded-workspace>/...`
  - `~/.claude-kimi/projects/<encoded-workspace>/...`
  - `~/.claude-mimosg/projects/<encoded-workspace>/...`

实现必须把这些格式当作“已观察到的本地事实”，不是 guaranteed public API。reader 应宽松：

- 缺失字段变为 `null`；
- verbose JSON 保留未知字段；
- agent transcript 里的 malformed JSONL 单行跳过，并记录 warning count；
- artifact paths 需要 realpath-check，且必须位于预期 Claude root 下；
- 除非路径或脚本 metadata 能证明属于当前 workspace，否则不得把 workflow 归属到当前 workspace。

## 命令语义

### `workflow plan`

目的：从 objective 生成可复用 workflow script。

行为：

- 读取项目约束和输入 context；
- 请求 Codex xhigh 起草 script 和 manifest；
- 写入 `docs/workflows/<slug>.workflow.js` 或 caller 提供的 `--output`；
- 不运行脚本；
- 除非明确要求，不编辑 workflow artifact 之外的项目源代码。

fallback：

- 如果 Codex 不可用，返回结构化错误，并提示可用 `workflow start --script <path>` 启动手写脚本。

### `workflow start`

目的：在 tmux TUI 中启动 Claude Code，并触发 Dynamic Workflow。

行为：

- 验证 tmux 和 Claude 可用；
- 用当前 Claude TUI prompt run 相同的窄环境变量传播策略启动 Claude；
- 粘贴明确引用 script 或 saved workflow 的 prompt；
- 返回 startup metadata；
- 记录 run-ledger event，包含 `kind: "workflow"`、`phase: "workflow_start_requested"` 和 `tmuxDetached: true`。

它不能声称 workflow 已完成，也不能声称 agents 已完成。它只证明 TUI 已启动，并且 request 已交给 Claude。

### `workflow list/status/result`

目的：观察完成中或已完成的 workflow artifacts。

行为：

- 扫描当前 workspace 的已知 Claude workflow roots；
- 按 timestamp 或 mtime 倒序排序；
- 暴露 `workflowName`、`runId`、`status`、`durationMs`、`agentCount`、`totalTokens`、`totalToolCalls` 等顶层字段；
- 可选展示 phase 和 agent summaries；
- 返回 artifact paths，方便 attach/debug。

`result` 返回已保存的 workflow result 和 artifact paths。如果还没有 terminal result，则返回 `status` 和明确的 “not complete” 信息。

## Workflow 模板

### Implementation Wave Template

必需字段：

- objective；
- 每个 worker 的 file ownership list；
- 每个 worker 的 forbidden files；
- 每个 worker 的 exact focused test command；
- 明确禁止 worker 跑 broad tests 或 regenerate bundles；
- integrator-only broad verification list。

worker schema：

```json
{
  "task": "string",
  "status": "done | partial | blocked",
  "filesChanged": ["string"],
  "testsAdded": ["string"],
  "focusedTestCmd": "string",
  "focusedTestResult": "string",
  "deviationsFromSpec": ["string"],
  "risksOrNotes": ["string"]
}
```

### Review And Reaudit Template

必需字段：

- finding 或 scope id；
- 可用时提供 file 和 line targets；
- evidence requirement；
- allowed statuses；
- 不确定时采用 conservative default。

auditor schema：

```json
{
  "finding_id": "string",
  "status": "fixed | still-present | false-positive | mitigated | not-applicable",
  "evidence": "string",
  "reasoning": "string",
  "fixed_by": "string",
  "residual": "string"
}
```

verifier schema：

```json
{
  "real": true,
  "confidence": "high | medium | low",
  "reasoning": "string"
}
```

只有达到配置投票阈值的 finding 才保留。默认阈值是 3 个独立 verifiers 中至少 2 个确认。

## 错误处理

- 缺少 tmux：在创建 workflow job 前失败，并说明此路径需要 tmux 执行 Claude workflow。
- 缺少 Claude：在 planning startup 前失败。
- 缺少 Codex planner：`workflow plan` 失败，但 `workflow start --script` 仍可用。
- startup 后缺少 workflow artifacts：返回 `status: "starting"` 或 `status: "unobserved"`；不要在 TUI 进程退出或 Claude 记录错误前标记失败。
- workspace roots 歧义：JSON 返回所有 candidates，要求 caller 选择 run ref。
- artifact 部分解析失败：报告 warning counts，不丢弃整个 run。

## 安全与成本约束

- 默认路径不得调用 `claude -p`。
- 默认路径不得 import 或依赖 Claude Agent SDK。
- Claude tmux 环境变量传播保持 allowlist。
- workflow script paths 必须是绝对路径，或解析到 workspace、`.claude/workflows`、`~/.claude/workflows` 下。
- 对不可信路径的任意 workflow script，不得静默执行；startup payload 必须展示路径。
- run ledger 默认不存完整 prompts。只存 preview、path、run id 和 command metadata。
- observation commands 是只读的。

## 测试策略

第一实现切片的 focused tests：

- `workflow` subcommands 的 CLI parsing。
- `workflow start` 使用 fake tmux / Claude binaries 构建预期 Claude tmux prompt 和 detached JSON payload。
- 缺少 tmux、缺少 Claude 返回结构化失败。
- workflow artifact reader 处理：
  - 有效 `wf_*.json`；
  - 缺失 optional fields；
  - agent transcript 中的 malformed JSONL line；
  - 多个 Claude roots；
  - 拒绝 allowed root 之外的 path。
- 实现后，host command map validator 覆盖新命令面。

实现后的 manual smoke：

1. 通过 tmux TUI 启动一个只有一个只读 agent 的 tiny Claude workflow。
2. attach 到 tmux session，确认 Claude 显示 workflow request。
3. 运行 `workflow list`，确认能看到 run。
4. 运行 `workflow status <run>`，确认 agent count、status 和 artifact paths。
5. workflow 完成后运行 `workflow result <run>`。

实现后的 broad verification：

- focused workflow tests；
- `npm test`；
- `npm run validate:host-map`；
- `npm run validate:bundles`；
- `npm run release:check`。

## 实施分期

Stage 1：design-only 和 artifact reader spike。

- 添加本 spec。
- 在测试保护下写 read-only artifact reader module。
- artifact discovery 可靠前，不新增 user-facing command。

Stage 2：command surface。

- 添加 `workflow list/status/result`。
- 更新 host-map docs 和 validator。
- `workflow start` 先由 fake tmux / Claude 的 focused integration test 保护。

Stage 3：planner integration。

- 等 Codex invocation contract 稳定后添加 `workflow plan`。
- 支持类似 `deep-review` 的 profile 配置，包含 `model_reasoning_effort = "xhigh"`。
- 保留手工 `--script` start path 作为可靠 fallback。

Stage 4：saved workflow 和 cancellation。

- 增加 `.claude/workflows` 和 `~/.claude/workflows` 下的 saved workflow discovery。
- 只有存在可靠 workflow-run stop primitive，且不需要脆弱 TUI 文本 scraping 时，才添加 cancellation。

## 验收标准

第一份 implementation plan 只有在以下条件满足时才算完成：

- 用户能通过 tmux TUI 启动 Claude Dynamic Workflow，且不走 `claude -p`；
- polycli 能列出并检查当前 workspace 的 workflow artifact；
- JSON 输出能区分 startup、running、completed、failed 和 unobserved；
- 测试能在不依赖 live Claude 的情况下证明 artifact parsing 和 tmux-start behavior；
- 文档明确说明 Agent SDK 和 `claude -p` 因 2026-06-15 credit 行为只能作为 opt-in；
- 未引入 Path-B runtime abstraction 或 provider base class。

## Implementation Plan 阶段的待定决策

1. 初始 workflow artifact 位置默认用 `docs/workflows/`，除非 implementation 发现更强的既有约定。
2. 初始命令可做成 companion subcommand group：`workflow`。如果 host adapters 无法自然表达 nested command，需要在 `docs/host-command-map.md` 记录 host-specific shape。
3. `workflow cancel` 先延后，除非存在稳定 stop primitive。
4. 如果直接调用 Codex 会引入脆弱的进程编排，第一版 planner execution 可以保留为手工流程。
