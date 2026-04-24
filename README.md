# polycli

`polycli` 是一个面向多 AI CLI 的 monorepo，提供两层东西：

1. 给最终用户安装的宿主插件和 OpenCode 包
2. 给仓库维护者复用的 runtime / utils / timing 包

它的边界保持收窄：

- 做多 provider CLI 的 companion / wrapper
- 做独立 timing contract
- 不做公共 runtime 基类
- 不做 provider 差异被抹平的伪统一框架

## Who This Is For

### 1. 终端用户 / AI CLI 使用者

如果你的目标是“装上插件，然后尽快开始用”，先看这一节，不需要先理解 monorepo 内部结构。

当前支持的宿主：

- Claude Code
- Codex
- GitHub Copilot CLI
- OpenCode

当前接入的 provider runtime：

- `claude`
- `copilot`
- `opencode`
- `pi`
- `gemini`
- `kimi`
- `qwen`
- `minimax`

### 2. 仓库维护者 / 发布者

如果你的目标是“在这个仓库里改实现、跑测试、发版”，看后面的 `Packages`、`Development` 和 `Release` 章节。

## Install And First Run

### Claude Code

安装：

```bash
claude plugin marketplace add bbingz/polycli
claude plugin install polycli@polycli-hosts
```

第一次验证：

```text
/polycli:health
/polycli:timing --provider qwen
```

### Codex

安装：

```bash
codex plugin marketplace add bbingz/polycli
```

第一次验证：

```text
/polycli-codex:polycli health
/polycli-codex:polycli timing --provider qwen --json
```

### GitHub Copilot CLI

安装：

```bash
copilot plugin marketplace add bbingz/polycli
copilot plugin install polycli-copilot@polycli-hosts
```

第一次验证：

```text
polycli health
polycli timing --provider qwen --json
```

### OpenCode

安装：

```bash
opencode plugin @bbingz/polycli-opencode
```

第一次验证思路：

- 运行 `polycli_run`，参数传 `["health","--json"]`
- 或直接运行 `polycli_timing` 读取 timing 记录

## User Mental Model

无论宿主是什么，`polycli` 都是同一套命令面：

- `setup`: 检查 provider CLI 是否安装、是否已登录
- `health`: 对 provider 做端到端短 prompt 探测，返回 `healthyProviders`，并写入 timing
- `ask`: 单次提问
- `rescue`: 长一点的排障/分析任务
- `review`: 基于当前 git diff 做代码审查
- `adversarial-review`: 更偏攻击面的审查
- `status`: 查看后台 job
- `result`: 读取后台 job 结果
- `cancel`: 取消后台 job
- `timing`: 查看 timing 历史和聚合

第一次接入某个 provider、登录状态变化、或 provider 命令失败时，跑一次：

```text
health
```

它会检查所有 integrated provider。只诊断单个 provider 时再传 `health --provider <provider>`。

日常使用不需要每次先跑 `setup` 或 `health`。provider 已出现在 `healthyProviders` 后，直接运行：

```text
ask --provider <provider> ...
review --provider <provider> ...
rescue --provider <provider> ...
```

`setup --provider <provider>` 是更便宜的诊断命令，只检查安装和认证状态，不发送模型请求。需要长任务时再用 `--background` 配合 `status/result`，最后用 `timing` 看记录是否已经落库。

## Background Jobs

`ask` / `rescue` / `review` / `adversarial-review` 支持 `--background`。

通用流程：

1. 启动：`... --background`
2. 轮询：`status <jobId>` 或 `status <jobId> --wait`
3. 取结果：`result <jobId>`
4. 必要时取消：`cancel <jobId>`

## Current Scope

当前仓库已经落地三层能力：

- `@bbingz/polycli-utils`
- `@bbingz/polycli-timing`
- `@bbingz/polycli-runtime`
- multi-host plugin adapters (`Claude` / `Codex` / `Copilot` / `OpenCode`)

`v1` 阶段只有前两个包；从 `v2` 开始，`claude` / `copilot` / `opencode` / `pi` / `gemini` / `kimi` / `qwen` / `minimax` 的 runtime adapter 已经进入本仓。旧 provider plugin repo 只作为 reference implementation，不再作为运行依赖。

## Packages

- `@bbingz/polycli-utils`
  - 参数解析、进程执行、stream 解码、NDJSON、atomic save、session id、stream JSON parsing
- `@bbingz/polycli-timing`
  - timing schema、运行时校验、percentiles、capability-aware aggregation
- `@bbingz/polycli-runtime`
  - provider registry、availability/auth probes、prompt args builder、foreground / streaming execution、stream / log parsing

## Timing Contract

`polycli-timing` 的核心不是“统一 6 段数值”，而是**统一状态表达**。每个 metric 都必须明确标记为：

- `measured`: 有数据且大于 0
- `zero`: 明确贡献了 0
- `missing`: 理论上能测，但本次没拿到
- `unsupported`: provider / runtime 根本不具备这个指标

这保证跨 AI 能力对比时不会把“没能力”“没数据”“贡献 0”混成一列。

此外，record 里保留两个关键字段：

- `runtimePersistence`: `ephemeral | session | daemon`
- `measurementScope`: `request | turn | job`

## Repository Map

- `packages/polycli-utils`
- `packages/polycli-timing`
- `packages/polycli-runtime`
- `plugins/polycli`
- `plugins/polycli-codex`
- `plugins/polycli-copilot`
- `plugins/polycli-opencode`
- `docs/`

## Development

要求：

- Node.js `>=20`
- 在仓库根目录安装依赖：`npm install`

常用验证：

```bash
npm test
node --test packages/polycli-utils/test/*.test.js
node --test packages/polycli-timing/test/*.test.js
node --test packages/polycli-runtime/test/*.test.js
```

插件打包：

```bash
npm run build:plugins
```

发布前检查：

```bash
npm run release:check
npm run pack:opencode
```

## Maintainer Notes

维护时优先看这些文件：

- [packages/polycli-runtime/README.md](/home/user/-Code-/polycli/packages/polycli-runtime/README.md)
- [plugins/polycli/README.md](/home/user/-Code-/polycli/plugins/polycli/README.md)
- [docs/release.md](/home/user/-Code-/polycli/docs/release.md)
- [docs/session-memory-2026-04-22.md](/home/user/-Code-/polycli/docs/session-memory-2026-04-22.md)

与宿主插件发布相关的 marketplace 文件：

- [.claude-plugin/marketplace.json](/home/user/-Code-/polycli/.claude-plugin/marketplace.json)
- [.agents/plugins/marketplace.json](/home/user/-Code-/polycli/.agents/plugins/marketplace.json)
- [.github/plugin/marketplace.json](/home/user/-Code-/polycli/.github/plugin/marketplace.json)

## Release

当前发布流说明见：

- [docs/release.md](/home/user/-Code-/polycli/docs/release.md)
- [docs/release-notes-v0.4.0.md](/home/user/-Code-/polycli/docs/release-notes-v0.4.0.md)
