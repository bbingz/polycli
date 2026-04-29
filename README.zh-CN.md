<div align="center">

# polycli

**在你已经在用的 AI host 里，用一套命令驱动 8 个 AI coding CLI。**

[![npm: polycli-utils](https://img.shields.io/npm/v/@bbingz/polycli-utils?label=%40bbingz%2Fpolycli-utils&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-utils)
[![npm: polycli-timing](https://img.shields.io/npm/v/@bbingz/polycli-timing?label=%40bbingz%2Fpolycli-timing&color=cb3837)](https://www.npmjs.com/package/@bbingz/polycli-timing)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

[English](./README.md) · **简体中文** · [日本語](./README.ja.md)

</div>

---

## polycli 是什么？

`polycli` 让你在 Claude Code、Codex、GitHub Copilot CLI 或 OpenCode 中，用同一套命令（`health`、`ask`、`review`、`rescue`、`timing`）驱动 8 个 AI coding CLI：**`claude`**、**`gemini`**、**`kimi`**、**`qwen`**、**`copilot`**、**`opencode`**、**`pi`** 和 **`mini-agent`**（MiniMax）。

这是一个 **utility-only 的 Path B monorepo**：不假装能抹平 provider 之间的差异，也不引入 runtime 基类。它把官方上游 CLI 作为子进程组合起来，统一命令面，并通过四态 timing schema 如实暴露能力差异。

## 为什么要用 polycli？

大多数"多 AI 编排器"为了凑出统一 API，会对能力差异说谎。polycli 反着来：

- **诚实的 4 态 timing** —— 每个指标都是 `measured`、`zero`、`missing` 或 `unsupported`，绝不折叠。你永远清楚是哪个 provider 没法测，还是哪个只是恰好没数据，或是恰好贡献了 0。
- **不假装统一** —— provider 之间的差异（session resume、tool 支持、结构化输出）写在 capability matrix 里明示，不用胶水代码遮掩。
- **直通 CLI** —— 直接 spawn 官方 CLI（`gemini`、`kimi` 等）作为子进程。复用你现有的登录态和配置；polycli 拿不到任何 API key，也不需要维护协议适配。
- **多 host、单一命令面** —— 同一套命令在 Claude Code、Codex、Copilot CLI、OpenCode 都生效。换 host 不用重学。

## Host 和 Provider

| Host（polycli 安装在哪里） | Provider（polycli 能调什么） |
|---|---|
| Claude Code · Codex · GitHub Copilot CLI · OpenCode | `claude` · `copilot` · `gemini` · `kimi` · `qwen` · `opencode` · `pi` · `mini-agent` |

各 provider 支持的能力详见 [Capability matrix](#capability-matrix)。

## 安装

### Claude Code

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

### Codex

```bash
codex plugin marketplace add bbingz/polycli
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

### OpenCode

```bash
opencode plugin @bbingz/polycli-opencode
```

## 快速上手

装完之后在 host 里验证：

```text
# Claude Code
/polycli:health

# Codex
/polycli-codex:polycli health

# GitHub Copilot CLI
polycli health

# OpenCode（调 polycli_run 传 ["health","--json"]）
```

`health` 会对所有已认证的 provider 跑一次端到端探针，并把存活的列在 `healthyProviders` 里。之后日常使用就直接调：

```text
ask --provider qwen "解释这个 stack trace ..."
review --provider claude            # 对当前 git diff 做 review
rescue --provider gemini "..."      # 较长的任务，可以加 --background
```

长任务加 `--background`，再用 `status <jobId>` / `result <jobId>` 取结果。

## 核心命令

所有命令在每个 host 行为一致：

| 命令 | 作用 |
|---|---|
| `setup` | 检查 provider CLI 是否安装、是否登录（不发模型请求，便宜） |
| `health` | 端到端短 prompt 探针，返回 `healthyProviders` 并写入 timing |
| `ask` | 单次提问 |
| `review` | 基于当前 `git diff` 做代码审查 |
| `rescue` | 较长的排障 / 分析任务 |
| `adversarial-review` | 偏攻击面的审查 |
| `timing` | 查看 timing 历史和聚合 |
| `status` / `result` / `cancel` | 后台 job 控制 |

只在以下情况跑 `health`：(a) 第一次接入某个 provider，(b) 认证状态变了，(c) 某个 provider 命令失败。日常使用不需要每次先跑。

## Capability matrix

事实来源：[`packages/polycli-runtime/src/registry.js`](./packages/polycli-runtime/src/registry.js) 的 `RUNTIMES` + `TIMING_SUPPORT`。`✓` = 支持；`—` = 设计上不适用（在 timing 里报 `unsupported`，不会假装成 `missing` 或 `0`）。

| Provider | streaming | sessionResume | structuredOutput | ttft | gen | tail | tool |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `claude` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `copilot` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `gemini` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `kimi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `qwen` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mini-agent` | ✓ | — | — | — | — | — | — |
| `opencode` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `pi` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

说明：

- `cold` 和 `retry` 对所有 provider 都是 `unsupported`：上游 CLI 没有稳定信号，polycli 拒绝伪造。`total` 永远是 `measured`。
- `mini-agent` 走日志回放协议，不支持 session resume、不支持结构化输出、不支持细粒度 streaming timing —— 这是上游限制，不是 polycli 的 bug。
- 只有 `qwen` 声明 `tool: true`。当 `qwen` 没触发 tool 调用时报 `missing`（可观测但本次未发生），其他 provider 报 `unsupported`（能力上不跟踪）。两个状态语义不同，不要合并。

## Timing 语义

polycli 的 timing 契约统一的是**状态表达**，不是数值。每个指标都明确标记为四种状态之一：

| 状态 | 含义 |
|---|---|
| `measured` | 真实非零的数据 |
| `zero` | 明确贡献了 0 |
| `missing` | 理论上能测，但本次没拿到 |
| `unsupported` | provider / runtime 根本不具备这个指标 |

这样跨 provider 比较时，"没能力"、"没数据"、"贡献 0" 不会被混进同一列。

每条 timing 记录还带：

- `runtimePersistence` —— `ephemeral | session | daemon`
- `measurementScope` —— `request | turn | job`

## Packages

| Package | 用途 |
|---|---|
| [`@bbingz/polycli-utils`](./packages/polycli-utils) | 参数解析、进程执行、stream 解码、NDJSON、原子保存、session id、stream JSON 解析 |
| [`@bbingz/polycli-timing`](./packages/polycli-timing) | timing schema、运行时校验、百分位、capability-aware 聚合 |
| [`@bbingz/polycli-runtime`](./packages/polycli-runtime) | provider registry、可用性 / 认证探针、命令构造器、前台 / streaming 执行、stream / log 解析 |

Plugin 发布产物：

- [`plugins/polycli`](./plugins/polycli) —— Claude Code host 插件
- [`plugins/polycli-codex`](./plugins/polycli-codex) —— Codex
- [`plugins/polycli-copilot`](./plugins/polycli-copilot) —— GitHub Copilot CLI
- [`plugins/polycli-opencode`](./plugins/polycli-opencode) —— OpenCode

## 开发

要求：Node.js `>=20`。

```bash
npm install
npm test                                       # build:plugins + 全量测试
node --test packages/polycli-runtime/test/     # 单 package 聚焦测试
npm run build:plugins                          # 重新打包 plugin 产物
npm run release:check                          # 发布前校验
```

`npm test` 已经会先跑 `build:plugins`，**不要**手动先 build 再 test。

## 发布

发布流程：[`docs/release.md`](./docs/release.md)。各版本 release notes：[`docs/release-notes-*.md`](./docs/)。

## 架构与贡献

提 PR 之前请读：

- [`AGENTS.md`](./AGENTS.md) —— 仓库地图、编辑规则、交付预期
- [`CLAUDE.md`](./CLAUDE.md) —— Claude Code 专属补丁
- [`docs/polycli-proposal.md`](./docs/polycli-proposal.md) —— 主要架构 / 产品上下文
- [`docs/roadmap.md`](./docs/roadmap.md) —— 实时进度清单

硬架构约束（请遵守）：

- provider-specific 协议解析放在 `polycli-runtime`，**不要**移到 `polycli-utils`。
- 四态 timing 不可折叠。`cold` 和 `retry` 故意不实现（上游 CLI 无稳定信号）。
- legacy 仓库（`gemini-plugin-cc` / `qwen-plugin-cc` / `kimi-plugin-cc` / `minimax-plugin-cc`）作为只读 reference 保留 —— 允许 `grep` 对比，不要编辑。

## License

[MIT](./LICENSE) —— 详见 [`LICENSE`](./LICENSE) 与各 package 的 [`packages/*/package.json`](./packages/) 元数据。
