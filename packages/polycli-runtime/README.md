# @bbingz/polycli-runtime

`@bbingz/polycli-runtime` 是 `polycli v2` 的 provider runtime 集成层。

它提供四家 adapter：

- `gemini`
- `kimi`
- `qwen`
- `minimax`

## Scope

这个包负责：

- provider registry
- availability / auth probes
- provider-specific args builder
- foreground prompt execution
- streaming execution
- stream / log parsing

这个包不负责：

- 持久化 job state
- background job orchestration
- command markdown / prompt 模板
- 把四家硬压成同一种协议

## Public Surface

统一入口：

- `getProviderRuntime()`
- `listProviderRuntimes()`
- `runProviderPrompt()`
- `runProviderPromptStreaming()`

Provider registry 常量：

- `PROVIDER_IDS`
- `PROVIDER_OPERATION_NAMES`

`PROVIDER_OPERATION_NAMES` 当前明确只有：

- `prompt`

也就是说，这一层只承诺 runtime 级 prompt 执行能力，不承诺已经内置 command-level 的 `task` / `review` / `adversarial-review` 语义编排。

Provider-specific helpers：

- `buildGeminiInvocation()`
- `buildKimiInvocation()`
- `buildQwenInvocation()`
- `buildQwenEnv()`
- `buildMiniMaxInvocation()`
- `parseGeminiStreamText()`
- `parseKimiStreamText()`
- `parseQwenStreamText()`
- `parseMiniMaxResponseBlocks()`
- `extractMiniMaxResponseFromLogText()`
- `extractMiniMaxLogPath()`
- `extractGeminiText()`
- `extractKimiText()`
- `stripAnsiSgr()`

Provider-specific runtime methods：

- `getGeminiAvailability()` / `getGeminiAuthStatus()` / `runGeminiPrompt()` / `runGeminiPromptStreaming()`
- `getKimiAvailability()` / `getKimiAuthStatus()` / `runKimiPrompt()` / `runKimiPromptStreaming()`
- `getQwenAvailability()` / `getQwenAuthStatus()` / `runQwenPrompt()` / `runQwenPromptStreaming()`
- `getMiniMaxAvailability()` / `getMiniMaxAuthStatus()` / `runMiniMaxPrompt()` / `runMiniMaxPromptStreaming()`

## Example

```js
import {
  getProviderRuntime,
  runProviderPrompt
} from "./src/index.js";

const runtime = getProviderRuntime("qwen");
const availability = runtime.getAvailability(process.cwd());

const result = await runProviderPrompt({
  provider: "gemini",
  prompt: "ping",
  cwd: process.cwd()
});
```
