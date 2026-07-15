# polycli v0.6.31

[English](./release-notes-v0.6.31.md) · **简体中文** · [日本語](./release-notes-v0.6.31.ja.md)

这是基于 `v0.6.30` 的 review-remediation 补丁版本。它关闭了发布后全面 review 确认的全部问题，同时保留 Path B 边界：provider adapter 继续保持扁平、显式，runtime package 继续为私有包，也没有引入 provider protocol framework。

## 变更内容

### 真实可靠的 CLI 与观测契约

- 无变更的后台 review 现在返回真实的 skipped 结果，不再伪造一个实际并未创建 job 的 `job.started` 记录。
- `setup` 和 `health` 会在访问 provider、认证或状态之前，拒绝位置参数与 flag 同时指定 provider 的歧义用法。
- TUI 的 agent-context effects 现在会披露本地 recovery-state 写入；默认 status 在限制 terminal history 数量的同时，仍会展示全部 active job。
- 所有持久化 ledger preview 都在存储边界完成脱敏。

### 有界的 provider 执行与安全的 prompt 传输

- 在 POSIX 上，timeout、abort、decoder overflow、终止失败以及缺失 `close` 事件的路径，都会终止或升级终止 provider process group，并且只以规范化类型错误完成一次。Windows streaming 路径保留 direct-child termination fallback。
- stdout 与 stderr 的聚合捕获分别设置上限，同时保留总字节数用于诊断。
- Claude 和 Gemini 会通过经过验证的 stdin 传输超长 prompt。仅支持 argv 的 provider 会在 spawn 前拒绝不安全的命令行，并返回带有处理建议的 `argument_list_too_long` 类型错误；除非调用方显式传入 `--max-diff-bytes`，review 输入仍不设默认上限。
- Claude、Copilot、OpenCode 和 Qwen 不再把回答正文中的任意 UUID 提升为 provider session identity。

### 可恢复的后台生命周期

- 取消操作会先持久化非终态的取消意图，只有在 worker identity 得到验证且 worker 已停止后，才会发布 `cancelled`。
- SessionEnd 在一个统一 deadline 内委托给权威 cancel 路径；该 deadline 同时约束 state/ledger lock、process identity probe 和 Windows `taskkill` 调用。
- Config、log、open 和 spawn 失败会使用私有 recovery sidecar，因此 envelope 生成前的瞬时失败不会留下永久的无 pid queued job。
- Worker、取消和 terminal-ledger 之间的竞态只会保留一组完整的 terminal pair；terminal state 对外可见前，会先清理本 job 拥有的 runtime、config 和 recovery artifact。

### 可复现的生成产物

- `validate:bundles` 现在通过 esbuild `write:false` 从源码渲染预期 bundle 与 terminal metadata，再逐字节比较所有 tracked artifact，全程不覆盖现有文件。
- GitHub CI 和 `release:check` 会在 `npm test` 进行原地构建前先运行该 freshness gate。
- 新增回归测试：修改源码但让五份 tracked bundle 继续彼此一致，证明 pre-build validator 仍会拒绝这些过期产物。

## 兼容性

- 现有公开 `--json` payload 保持兼容；JSON v2 仍需显式选择。
- Review collection 默认仍不设上限；只有显式传入 `--max-diff-bytes` 才会截断输入。
- `@bbingz/polycli-runtime` 继续保持私有，provider module 继续保持扁平。
- Host plugin、OpenCode 和 terminal CLI 升至 `0.6.31`；`@bbingz/polycli-utils` 升至 `1.0.5`；`@bbingz/polycli-timing` 仍为 `1.0.2`。

## 验证

- 五个独立实现组都通过了独立的 spec-compliance 与 code-quality review。
- 最终全分支 review 在裁决全部 14 项 finding 后给出 `Spec Compliance: PASS`、`Code Quality: APPROVED` 和 `Release Readiness: READY`。
- 本地完整测试通过：906 个测试，906 通过，0 失败。
- `npm run release:check` 通过 source-derived bundle freshness、strict fixture freshness、manifest、host map、Codex guidance、已安装 CLI 的 review flag drift、两项 Claude plugin validation，以及所有 npm package dry-run。
- 当时没有可用的原生 Windows 执行环境。Windows argv budgeting 与 `taskkill`/deadline 分支由确定性模拟覆盖；只有 POSIX process-group 和 live process-tree 行为获得原生执行覆盖。
- PR #16 CI 与合并后的 main CI 均通过。一次干净的 registry install 在不调用 provider 的情况下执行了 terminal `agent-context --json`（schema 1、build `0.6.31`、20 个命令、解析到 utils `1.0.5`），并成功导入 OpenCode package。

## 发布产物

- GitHub release：`v0.6.31` — tag commit `a70eb093bc7892e2f6b653ed29ca8bba5d66489b`，发布于 `2026-07-15T14:39:17Z`
- npm：`@bbingz/polycli@0.6.31` — `57d0f77811767c4310623af03f27af82375abae8`
- npm：`@bbingz/polycli-opencode@0.6.31` — `65c990f89df099bb0a1a95104a0a8400abb0f6ca`
- npm：`@bbingz/polycli-utils@1.0.5` — `99df508a6bffe601e79569927bedf4016d3d471f`
- 未变更的 npm package：`@bbingz/polycli-timing@1.0.2`
