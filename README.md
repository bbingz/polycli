# polycli

`polycli` 是一个刻意收窄到 Path B 的 monorepo：只提供可复用工具层和独立 timing contract，不提供公共 runtime、继承树或 hook framework。

## What it is

这个仓库面向多 provider companion / wrapper 项目，目标有两个：

1. 把低语义风险的公共工具抽出来，避免 4 份近似拷贝。
2. 把 timing 对比 contract 独立出来，避免把“没能力”“没数据”“贡献 0”混成一列。

## Current Scope

当前仓库已经落地三层能力：

- `@bbingz/polycli-utils`
- `@bbingz/polycli-timing`
- `@bbingz/polycli-runtime`
- multi-host plugin adapters (`Claude` / `Codex` / `Copilot` / `OpenCode`)

`v1` 阶段只有前两个包；从 `v2` 开始，`gemini` / `kimi` / `qwen` / `minimax` 的 runtime adapter 已经进入本仓，集中在 `@bbingz/polycli-runtime`。旧 4 个 plugin repo 仍然是 reference implementation，不再作为运行依赖。

## Packages

- `@bbingz/polycli-utils`
  - `args`: 命令行参数解析与原始字符串切词
  - `process`: 命令执行、可用性探测、进程树终止
  - `stream`: UTF-8 安全的按行解码
  - `atomic-save`: 原子写与锁文件
  - `ndjson`: 追加 / 读取 / tail NDJSON
  - `session-id`: 从 stdout / stderr / 文件值中提取 session id
  - `parse-stream-json`: 消化前缀噪声并解析 JSON 行

- `@bbingz/polycli-timing`
  - `timing.schema.json`: timing record 契约
  - `validateTimingRecord()`: 运行时校验
  - `calculatePercentiles()`: p50 / p95 / p99
  - `aggregateTimingRecords()`: capability-aware 聚合

- `@bbingz/polycli-runtime`
  - provider registry
  - `gemini` / `kimi` / `qwen` / `minimax` runtime adapter
  - availability / auth probes
  - prompt args builder
  - prompt-level foreground / streaming runtime execution
  - stream / log parsing

- `plugins/polycli`
  - repo-local Claude plugin entry
  - `/polycli:setup` / `ask` / `rescue` / `review` / `adversarial-review`
  - background job lifecycle with `/polycli:status` / `result` / `cancel`
  - persisted per-workspace plugin state for background runs
  - timing history with `/polycli:timing`

- host adapters
  - `plugins/polycli` for Claude Code
  - `plugins/polycli-codex` for Codex
  - `plugins/polycli-copilot` for GitHub Copilot CLI
  - `plugins/polycli-opencode` plus `.opencode/plugins/polycli.mjs` for OpenCode
  - repo marketplaces:
    - `.claude-plugin/marketplace.json`
    - `.agents/plugins/marketplace.json`
    - `.github/plugin/marketplace.json`

## Quick Start

仓库当前是 monorepo 本地开发形态，先进入根目录：

```bash
cd /home/user/-Code-/polycli
npm test
```

## Published Install Targets

发布态安装入口已经固定为：

- Claude Code: `claude plugin marketplace add bbingz/polycli` 然后 `claude plugin install polycli@polycli-hosts`
- Codex: `codex plugin marketplace add bbingz/polycli`
- GitHub Copilot CLI: `copilot plugin marketplace add bbingz/polycli` 然后 `copilot plugin install polycli-copilot@polycli-hosts`
- OpenCode: `opencode plugin @bbingz/polycli-opencode`

仓库内可重复执行的发布前校验：

```bash
npm run release:check
npm run pack:opencode
```

在本仓内直接从源码引用：

```js
import { parseArgs, createLineDecoder, appendNdjson } from "./packages/polycli-utils/src/index.js";
import { validateTimingRecord, aggregateTimingRecords } from "./packages/polycli-timing/src/index.js";
```

未来发布到 npm 后，调用方式会是：

```js
import { parseArgs } from "@bbingz/polycli-utils";
import { validateTimingRecord } from "@bbingz/polycli-timing";
```

## Usage

### 1. `@bbingz/polycli-utils`

参数解析：

```js
import { parseArgs } from "./packages/polycli-utils/src/index.js";

const parsed = parseArgs(
  ["--json", "-t", "5000", "ask", "--", "--literal"],
  {
    booleanOptions: ["json"],
    valueOptions: ["timeout"],
    aliasMap: { t: "timeout" }
  }
);

// parsed.options => { json: true, timeout: "5000" }
// parsed.positionals => ["ask", "--literal"]
```

流式按行解码：

```js
import { createLineDecoder } from "./packages/polycli-utils/src/index.js";

const decoder = createLineDecoder();
decoder.push(Buffer.from("hello\nwor"));
decoder.push(Buffer.from("ld\n"));
decoder.end();
```

带噪声前缀的 JSON 行解析：

```js
import { parseStreamJsonLine } from "./packages/polycli-utils/src/index.js";

const parsed = parseStreamJsonLine('MCP issues detected... {"type":"init","session_id":"abc"}');
if (parsed.ok) {
  console.log(parsed.event.type); // "init"
}
```

NDJSON 历史写入：

```js
import { appendNdjson, readNdjson, tailNdjson } from "./packages/polycli-utils/src/index.js";

appendNdjson("/tmp/polycli-history.ndjson", { id: 1, ok: true });
appendNdjson("/tmp/polycli-history.ndjson", { id: 2, ok: true });

const all = readNdjson("/tmp/polycli-history.ndjson");
const last = tailNdjson("/tmp/polycli-history.ndjson", 1);
```

session id 解析：

```js
import { resolveSessionId } from "./packages/polycli-utils/src/index.js";

const result = resolveSessionId({
  stdout: "",
  stderr: "To resume: kimi -r 123e4567-e89b-12d3-a456-426614174000",
  fileValue: null,
  priority: ["stderr", "stdout", "file"]
});
```

### 2. `@bbingz/polycli-timing`

`polycli-timing` 的核心不是“统一 6 段数值”，而是**统一状态表达**。每个 metric 都必须明确标记为：

- `measured`: 有数据且大于 0
- `zero`: 明确贡献了 0
- `missing`: 理论上能测，但本次没拿到
- `unsupported`: provider / runtime 根本不具备这个指标

这保证跨 AI 能力对比时不会把“没能力”“没数据”“贡献 0”混成一列。

此外，record 里保留了两个强约束字段：

- `runtimePersistence`: `ephemeral | session | daemon`
- `measurementScope`: `request | turn | job`

这样就不会把 daemon 型 provider 的“常驻预热”误算成一次请求的冷启动。

最小 record 示例：

```js
const record = {
  version: 1,
  provider: "gemini",
  runtimePersistence: "ephemeral",
  measurementScope: "request",
  completedAt: "2026-04-22T00:00:00.000Z",
  metrics: {
    cold:  { status: "measured", ms: 1200 },
    ttft:  { status: "measured", ms: 800 },
    gen:   { status: "measured", ms: 2400 },
    tool:  { status: "zero", ms: 0 },
    retry: { status: "missing", ms: null },
    tail:  { status: "measured", ms: 100 },
    total: { status: "measured", ms: 4500 }
  }
};
```

校验与聚合：

```js
import {
  validateTimingRecord,
  aggregateTimingRecords
} from "./packages/polycli-timing/src/index.js";

const validation = validateTimingRecord(record);
if (!validation.ok) {
  console.error(validation.errors);
}

const summary = aggregateTimingRecords([record]);
console.log(summary.byProvider.gemini.metrics.cold.p50);
```

## Files

- 根说明：`README.md`
- v1 public surface：`docs/polycli-v1-public-surface.md`
- utils 包说明：`packages/polycli-utils/README.md`
- timing 包说明：`packages/polycli-timing/README.md`
- runtime 包说明：`packages/polycli-runtime/README.md`
- plugin 说明：`plugins/polycli/README.md`
- timing schema：`packages/polycli-timing/timing.schema.json`

## Development

```bash
npm run build:plugins
npm test
```
