# polycli 架构提案 — 跨插件公共库讨论 + 2 轮红队审查

**日期**: 2026-04-21
**讨论主持**: Claude (Opus 4.7)
**参与视角**: Codex / Gemini / Kimi / Qwen / MiniMax (5-way) + 2 轮红队 (Codex+MiniMax, Gemini+Kimi)
**状态**: 待 Codex 独立判断后决定走 Path A 还是 Path B

---

## TL;DR

维护 4 个 Claude Code 子代理插件 (gemini/kimi/qwen/minimax-plugin-cc)，每家 800-1100 行 companion，重复度 40-50%。想抽公共库。

**两个真实动机**：
1. **多视角咨询**：利用各家 AI 提供不同视角
2. **跨 AI 能力对比**：通过 timing 数据反映各家能力差距（冷启动/TTFT/tool 延迟）

**经过 1 次初方案 + 5-way 视角咨询 + 2 轮共 4 家红队（投票 3×b + 1×c，无 a）**，Claude 当前倾向从 **framework 退到 utility library + 独立 timing schema**。本文档请 Codex 独立研判后给最终意见。

---

## 1. 背景与量化数据

### 1.1 现状结构
- 4 个插件本地仓库：`gemini-plugin-cc`、`kimi-plugin-cc`、`qwen-plugin-cc`、`minimax-plugin-cc`（均位于 `~/-Code-/`）
- Codex 插件（`openai-codex`）作为**对齐参考但不纳入合并**
- 每个插件结构一致：`plugins/<provider>/{agents, commands, hooks, prompts, scripts, schemas, skills}`
- 共享命令表面：`setup / ask / review / adversarial-review / rescue / status / result / cancel`（gemini 额外有 `timing`）

### 1.2 漂移量化（diff 行数）

| 文件 | gemini↔kimi | ↔qwen | ↔minimax | 判读 |
|---|---|---|---|---|
| `lib/args.mjs` | 0 | 0 | 0 | **完全相同，4 份拷贝** |
| `lib/process.mjs` | 6 | 0 | 0 | 近乎相同 |
| `session-lifecycle-hook.mjs` | 25 | 138 | 128 | 已漂移 |
| `stop-review-gate-hook.mjs` | 107 | 177 | 190 | **严重漂移** |

gemini v0.6.0 的 6 段 timing telemetry（cold / ttft / gen / tool / retry / tail）+ `timings.ndjson` 全局历史，**其余 3 家无此能力**。

### 1.3 未来扩展
grok / mimo / deepseek。

---

## 2. Phase 0: 研究同类项目

- **[OpenClaw (github.com/Enderfga/openclaw-claude-code)](https://github.com/Enderfga/openclaw-claude-code)** —— 最接近参考。单插件，`ISession` 接口 + `BaseOneShotSession` 抽象类。核心洞察："子类只实现 `_run()`，消灭每引擎 200 LOC 重复"
- **[claude-code-router (musistudio/claude-code-router)](https://github.com/musistudio/claude-code-router)** —— 方向相反（让 Claude Code 调其他模型），不适用

Claude 最初直接照搬 OpenClaw → V1 方案。

---

## 3. Phase 1: V1 方案（照搬 OpenClaw）

```
@bbingz/polycli-core + per-provider wrapper
├── BaseSession (基类)
│   ├── 共享: stats / history / timing / cancel / EventEmitter / 原子写
│   └── 子类必填 5 个 hook:
│       _run / _parseStreamLine / probeAuth / getSessionId / listModels
```

---

## 4. Phase 2: 5-way 视角咨询

同一套 4 题派给 5 家 agent：命名建议 / 作为被集成 CLI 的陷阱 / 架构盲区 / 扩展性风险。

### 4.1 命名投票全清单

| 词根 | 出现次数 | 候选 | 出处 |
|---|---|---|---|
| **poly** | 3 | `polycli`, `polyagent-core`, `poly-cli-companion` | Kimi / Qwen / Gemini |
| 网络结构 | 3 | `Sidecar Grid`, `subagent-swarm`, `LatticeAgent` | Codex / Qwen / MiniMax |
| **nexus** | 2 | `NexusCLI`, `nexus-subagent-core` | MiniMax / Gemini |
| cli 显性 | 3 | `polycli`, `cli-agent-hub`, `NexusCLI` | Kimi / Qwen / MiniMax |
| 中文双关 | 1 | **`qimen` (奇门)** | Kimi |
| 品牌感 | 4 | `Relay Forge`, `agentshell`, `PromptFlux`, `omni-agent-base` | Codex / Kimi / MiniMax / Gemini |

**Claude 初推**: `polycli`（3 票共识 + npm 域名友好）；`qimen` 作为唯一中文双关候选保留。

### 4.2 5 家共识盲点（按提出频次）

1. 🔴 **单 `_run()` hook 不够** — 所有家都提出需要额外 lifecycle/capability hook
   - Codex: handshake / capability negotiation / interrupt / resume / backpressure / heartbeat
   - MiniMax: `_setup()` + `_teardown()` 承载多轮状态机
   - Gemini: `verifyPrerequisites()` 必须在冷启动测量前执行
   - Kimi: `getSessionId(stdout, stderr, fsFallback)` / `probeAuth()` / `listConfiguredModels()`
   - Qwen: `protocolAdapter` / `authStrategy` / `providerCapabilities`

2. 🔴 **Timing 统一化是最深陷阱** — Gemini / Kimi / Codex
   - Gemini: TTFT 跨 CLI 不可比；必须分 `Platform_Init_Time` vs `LLM_Response_Time`
   - Gemini: 并发工具执行时总耗时计算崩溃
   - Kimi: stream-json 不吐 stats，统一表若预留 tokens 列则 kimi 行永远 null，聚合 p50 误导
   - Codex: token accounting 有的按 usage 报、有的增量、有的不报

3. 🔴 **Stream 格式 / 事件 schema 异构** — 4 家都提到
   - Gemini: 噪声前缀必须 `parseStreamChunk()` 钩子
   - Kimi: per-message JSONL 不是 per-token delta
   - Codex: 事件名 / 增量粒度 / tool call 包装 / stderr 混入方式都不同
   - Qwen: Grok 可能是 SSE `data:` 行不是 NDJSON

4. 🔴 **Exit code 语义碎裂** — Codex / Kimi / Gemini
   - Codex: "0 可能代表代理正常结束但任务失败"
   - Kimi: 130/143/124 已分离，qwen 的 2 复用给 `--scope`
   - Gemini: 53 = Turn Limit 要映射到 `TURN_LIMIT_EXCEEDED`

5. 🟡 **CapabilityMatrix 一等公民** — Gemini 明说，Qwen 隐含，MiniMax 暗示

### 4.3 独特贡献

| 家 | 最锋利单点 |
|---|---|
| **Codex** | app-server 长连接根本不是 one-shot — "退出即完成"的前提不成立 |
| **Gemini** | 不同 CLI 底层语言不同（Rust vs Node）中断响应差异巨大 |
| **Kimi** | 长上下文 prompt >100K 不能假设 `-p <str>`，要有 stdin 管道钩子 |
| **Qwen** | rate limit 头部格式不同（X-RateLimit-Remaining vs ratelimit-remaining） |
| **MiniMax** | 原子写要覆盖 agent 状态，不止文件；MCP 工具注册时机 |

---

## 5. Phase 3: V2 方案（基于 5-way 反馈的第一次修订）

```
2 层抽象
BaseSession
├── OneShotSession      ← gemini / kimi / qwen
├── AgenticSession      ← minimax (多轮状态机)
└── LongRunningSession  ← 未来 codex app-server

Provider 必填 hooks: _run / _parseStreamLine / probeAuth / getSessionId / listModels (5 个)

Timing: core 6 段 wall-clock；token/tool provider-optional (contributes?())
事件: 不透传 stdout，强制 SubagentEventSchema
错误: errorCodeMap per-provider override
迁移 3 步: args+process → timing → BaseSession
```

---

## 6. Phase 4: 第 1 轮红队（Codex + MiniMax）→ V2 被打碎

### 6.1 Codex 打击点（投 b 大改后推进）

**最犀利的 5 句原话**：

1. "把正交维度硬塞进单继承层级，类型边界从一开始就错了" — Transport / Runtime / Capability 是 3 条独立变化轴
2. "接口已经过拟合...把实现细节误判成通用契约" — `getSessionId(stdout, stderr, fsFallback)` 把 CLI 副作用编码进核心接口
3. "你一边依赖原始流做状态恢复和语义提取，一边在外部 API 上禁止用户获得原始流" — SubagentEventSchema 自相矛盾
4. "errorCodeMap per-provider override → UNKNOWN 最终会成为真实错误的垃圾桶"
5. "先抽 args.mjs+process.mjs 再抽 BaseSession，会把当前 CLI 假设提前固化成公共 API" — 迁移顺序是倒序

### 6.2 MiniMax 打击点（投 c 推翻重做）

1. "AgenticSession 根本不应该存在—它是伪装成子类的运行时" — 多轮状态机不是 session 子类，是 runtime
2. "timing 可选贡献是统计数据的定时炸弹" — p50 残缺必然误导产品决策
3. "SubagentEventSchema 强制标准化是在重写所有 provider 的灵魂" — 翻译层必然有语义丢失
4. "minimax 多轮 turn 内有多次 LLM 调用，6 段 timing 语义对应不上" — 迁移第 2 步抽 timing 时 minimax 没有对应
5. "errorCodeMap 是维护地狱" — 双向映射谁负责未定义

### 6.3 终审
| | Codex | MiniMax |
|---|---|---|
| 投票 | (b) 大改后推进 | (c) 推翻重做 |
| 解决方案 | 拆三轴正交层 | 承认有些 provider "自带 runtime" |

---

## 7. Phase 5: V2 修订版（Claude 基于第 1 轮红队修订）

```
四层正交（组合不继承）
Transport: spawnArgs / readline / kill tree / 双通道事件 (raw.line + canonical.event)
Runtime:   runOneShot / runAgentic / runLongRunning (函数，不是类)
Capability: ProviderAdapter = { id, capabilities, hooks? }
             唯一必填 hook: _run()
             可选: probeAuth / listModels / getSessionId / parseStreamLine / contributeTiming
Facade:    timing wall-clock / atomic save / cancel / canonical schema + raw passthrough

错误: { native_code, canonical_type } 双字段，不强制映射表
Timing: capability flag 区分"没能力"vs"没数据"
迁移 6 步: 画 contract → 最小 core → 迁 gemini 验证 → 测回归 → 推广 kimi/qwen → minimax 单独评估
```

---

## 8. Phase 6: 第 2 轮红队（Gemini + Kimi）→ V2 修订版又被打碎

### 8.1 Gemini 打击点（投 b 再改后推进）

1. **Runtime 纯函数化是错的**：取消/缓冲/统计无处安放 → 巨大 Context 胖对象透传；`runOneShot` 和 `runAgentic` 必然 60% 重合 → 回调地狱
2. **双通道事件 = 两本账灾难**：时序撕裂 + 信任危机 + 脏活踢回调用方
3. **只剩 `_run()` = 放弃控制反转**：CapabilityMatrix 成君子协定无法强制；重试/限流会被 provider 复制粘贴回大泥球
4. **Transport/Capability 悖论**：Gemini 输出脏（噪声前缀 + thought block + 并发 tool call），Transport 必须懂协议才能做 canonical，但三轴要求 Transport 通用
5. **Step 3 选 gemini 作首迁错了**：最复杂会迎合它的特殊逻辑，毁掉泛化到 kimi/qwen 的可能
6. **v0.6.0 p50/p95 基线和 v2 打点位置不同不可比**：必须双轨并行期重建 v2 基准

### 8.2 Kimi 打击点（投 b 再改后推进）

1. **Runtime 函数化是"参数传递地狱"**：多轮状态（conversation_id / 上下文窗口剩余 / 系统 prompt 注入点）要么塞 opts 口袋对象要么下沉 Adapter → 4 种偷偷实现
2. **双通道 = "对称性暴政"**：canonical 成功时 raw 冗余；canonical 失败时 raw 兜底语义不明；下游要写两套渲染器
3. **Transport/Capability 边界幻觉**：stdin 缓冲区上限（4-8MB） + UTF-8 多字节切割 → Transport 不懂语义会切坏字符
4. **CapabilityMatrix 是"静态墓碑"**：没有生命周期管理；Kimi v0.1 不吐 stats, v0.2 吐了，matrix 怎么同步？
5. **可选 `getSessionId` 杀死 session 恢复标准化**：resume 对 agentic/longRunning 是基础设施不是锦上添花
6. **Step 3 选 gemini 是"easy mode 自欺欺人"**：应该先迁 kimi 或 minimax（和 Gemini 结论相反但**都反对该选择**）

### 8.3 终审
| | Codex | MiniMax | Gemini | Kimi |
|---|---|---|---|---|
| V1 投票 | (b) | (c) | — | — |
| V2 投票 | — | — | (b) | (b) |
| **总** | **3×b + 1×c + 0×a** | | | |

---

## 9. Claude 当前的诚实反思

### 9.1 观察
- V1 被打碎（继承树混了正交轴）
- V2 被打碎（函数化 + 双通道 + hook 过少 + Transport 悖论）
- 每轮修正都在暴露新的正交变化点 → **典型"抽象过度综合征"**

### 9.2 回到用户真实动机
1. **多视角咨询**：不同 AI 提供不同视角的咨询能力
2. **跨 AI timing 能力对比**：冷启动 / TTFT / tool 延迟可比数据

**这两个动机都需要 framework 吗？** Claude 认为：**不需要**。
- 动机 1 靠"每个 plugin 独立 command 定义 + 文档约束"可管理
- 动机 2 只需要**独立的 timing schema contract**，不需要绑定运行时 framework

### 9.3 真实 drift 的来源
- 40-50% 是 utility 层（args / process / spawn / timing 收集器）
- 10-20% 是 hook 层（session-lifecycle / stop-review-gate，漂移 107-190 行）
- framework 抽象本来就不是主要 drift 来源

---

## 10. 两条路径

### Path A: V3 Framework（基于 4 轮红队继续修正）

**修订方向**（4 轮反馈指向）：
- Runtime 引入 **Context ctx 对象 + middleware 管道**（Koa/Express 风格）承载状态
- 事件**单通道**：Adapter 入口消化脏数据 + 明确 `parseError` 事件
- 必填 hook 扩到 3-4 个：`_run` + `getSessionId`（允许返回 null）+ lifecycle hooks
- CapabilityMatrix **动态探测 + 版本化**
- 迁移顺序：选**中等复杂度** provider 首迁（非 gemini 非 minimax）；双轨期重建 baseline

**代价**：预计还要 2-3 轮红队 + 2-3 周架构定稿，代码还没开始写
**收益**：长远架构完整；跨 provider timing schema 强一致

### Path B: Utility library + 独立 Timing Schema

放弃 framework，只抽 utility。单独做**最小 timing schema contract**服务动机 2。

```
@bbingz/polycli-utils      ← utility 包
├── args.mjs              ← 4 份 0 diff，直接抽
├── spawn.mjs             ← 进程 + kill tree (强制 SIGKILL 树)
├── stream.mjs            ← readline + UTF-8 safe chunk
├── timing.mjs            ← 6 段 wall-clock 收集器（纯工具）
├── parse-stream-json.mjs ← 消化噪声前缀 + 返回 { event, parseError }
├── atomic-save.mjs       ← 原子写 + 去抖
├── ndjson-tail.mjs       ← jsonl 历史读取
├── session-id.mjs        ← stdout/stderr/fs 三路查找助手
└── hooks/
    ├── session-lifecycle.mjs  ← 消灭 25-138 行漂移
    └── stop-review-gate.mjs   ← 消灭 107-190 行漂移

@bbingz/polycli-timing-schema  ← 独立 schema 包（为动机 2 服务）
├── timing.schema.json     ← 6 段最小集 + optional 扩展（含 capability flag）
├── aggregate.mjs          ← 带 capability-aware null 处理的聚合器
└── percentile.mjs         ← p50/p95/p99，显式区分"无能力"vs"无数据"
```

**每个 plugin 的 companion 保留自己主流程**，import 公共 utility + 符合 timing schema。
**不提供**：继承、事件总线、runtime、强制 adapter 接口。

**代价**：调用接口一致性靠文档不靠编译器；没有继承抽象
**收益**：下周开始写代码；风险远低于 Path A；半年后真需要 framework 仍可加

---

## 11. 用户真实动机对 Path 选择的影响

### 动机 1（多视角咨询）
- Path A ✅ 强制接口一致
- Path B ⚠️ 靠文档约束（4 个 plugin 规模下可管理，每个 command 定义独立维护本来就要做）

### 动机 2（跨 AI timing 能力对比）
- Path A ✅ Timing schema 天然一致（嵌入 framework）
- Path B ✅ **独立 timing-schema 包可以完全满足**
  - **关键**：MiniMax 的"统计数据定时炸弹"警告依然适用 — **capability flag 必须保留**
  - 聚合器必须区分：(a) provider 没能力贡献 (b) 有能力但未贡献数据 (c) 贡献了数据

---

## 12. Claude 当前倾向

**走 Path B**。理由：
1. 动机 2（timing 对比）可通过独立 schema 包实现，不需要绑定运行时
2. 动机 1（多视角咨询）在 4 个 plugin 规模下靠文档 + code review 可管理
3. 4 轮红队的"抽象过度综合征"说明继续 framework 风险递增
4. Utility 有明确退路（半年后真需要 framework 仍可在其上加）

---

## 13. 请 Codex 研判的问题

1. **方向判断**：Utility vs Framework 的取舍是否正确？尤其考虑动机 2，Path B 的独立 timing-schema 包是否足够？
2. **包结构**：timing schema 应该是独立包（`@bbingz/polycli-timing-schema`）还是 utility 包的子模块？前者可复用性高，后者简单
3. **头 3 个月优先级**：若走 Path B，先抽哪些 utility？以什么标准选？（建议：漂移严重的 + 零漂移已成熟的）
4. **命名最终确定**：`polycli` 主品牌基本确定（3 票共识），子包后缀建议？(`-utils` / `-kit` / `-core` / `-lib`)
5. **MiniMax 的特殊性**：多轮 agent 框架是否应该完全脱离公共库？只在 utility 层部分 import？
6. **遗漏视角**：Codex 作为 app-server 模式代表，对 4 轮红队的打击点有无补充？有没有更深的架构判断？
7. **若最终决定走 Path A**：Codex 愿意作为"首迁 provider"吗？（因为 app-server 复杂度最高，能暴露最多边界）

---

## 附录 A: 量化数据采集方法

```bash
# drift 统计（在 ~/-Code- 父目录下执行）
for f in session-lifecycle-hook.mjs stop-review-gate-hook.mjs; do
  for p2 in kimi-plugin-cc qwen-plugin-cc minimax-plugin-cc; do
    base=$(find gemini-plugin-cc/plugins -name $f | head -1)
    other=$(find $p2/plugins -name $f | head -1)
    diff "$base" "$other" | grep -c '^[<>]'
  done
done
```

## 附录 B: 4 轮红队的 agent 投票矩阵

| 阶段 | 审查者 | 方案 | 投票 | 主要打击点 |
|---|---|---|---|---|
| Phase 4-1 | Codex | V1 | b | 正交轴压缩；过拟合接口；迁移倒序 |
| Phase 4-2 | MiniMax | V1 | c | AgenticSession 不存在；timing 定时炸弹；翻译层丢语义 |
| Phase 6-1 | Gemini | V2 | b | Runtime 函数化；双通道两本账；Transport 悖论 |
| Phase 6-2 | Kimi | V2 | b | 参数传递地狱；对称性暴政；easy mode 自欺欺人 |

## 附录 C: 关键原话引用（每家最锋利 1 句）

- **Codex**: "你现在用 2-tier 去承载至少三条轴：会话模式、进程模型、provider 能力面，这会直接导致后续某个 provider 同时具有 agentic 和 long-running 特性时无法自然落位"
- **MiniMax**: "BaseSession 无法同时服务单轮执行和多轮状态机两种运行时...这些问题不是实现细节，是架构假设层面的根本冲突"
- **Gemini**: "既要规范又怕丢细节，这是一种懒惰的架构妥协...这是经典的两本账灾难"
- **Kimi**: "Transport 与 Capability 的边界是幻觉...它用不丢数据的伪安全，掩盖了解析责任归属不明的真问题"

## 附录 D: OpenClaw 可借鉴点（被证明部分失效）

- ✅ **依然可借鉴**: 原子写 + 去抖保存；强制 kill 树；event 常量表
- ⚠️ **部分可借鉴**: EventEmitter 基础设施（但不要强制 schema 标准化）
- ❌ **不应照搬**: BaseOneShotSession 单继承层级（混了正交轴）；单 `_run()` hook（过拟合）；ISession 接口的 30+ 方法（scope 不同）
