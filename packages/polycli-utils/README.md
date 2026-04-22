# @bbingz/polycli-utils

`@bbingz/polycli-utils` 只收低语义风险、跨 provider 可复用的工具模块。

## Exports

- `args`
- `process`
- `stream`
- `atomic-save`
- `ndjson`
- `session-id`
- `parse-stream-json`

## Example

```js
import {
  parseArgs,
  createLineDecoder,
  parseStreamJsonLine,
  appendNdjson,
  resolveSessionId
} from "./src/index.js";
```

## Notes

- `terminateProcessTree()` 在 POSIX 上优先尝试按 process-group 终止；调用方最好传入 pgid/leader pid，而不是任意子进程 pid。
- `parseStreamJsonLine()` 只负责单行噪声前缀剥离和 JSON 解析，不负责 provider-specific canonical event 映射。
- `appendNdjson()` 会在同目录创建 `*.lock` 锁文件，并在超限时按比例裁剪历史。

## Public Surface

v1 稳定根导出以 `src/index.js` 和导出测试为准：

- `parseArgs`
- `splitRawArgumentString`
- `runCommand`
- `runCommandChecked`
- `binaryAvailable`
- `formatCommandFailure`
- `terminateProcessTree`
- `createLineDecoder`
- `ensureParentDir`
- `writeFileAtomic`
- `writeJsonAtomic`
- `withLockfile`
- `LockfileTimeoutError`
- `appendNdjson`
- `readNdjson`
- `tailNdjson`
- `UUID_SESSION_ID_REGEX`
- `matchSessionId`
- `resolveSessionId`
- `parseStreamJsonLine`
- `parseStreamJsonText`
