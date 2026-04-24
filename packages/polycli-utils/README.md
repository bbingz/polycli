# @bbingz/polycli-utils

Low-semantic-risk utilities shared by polycli provider runtimes: argument parsing, child-process helpers, stream decoding, atomic JSON/file writes, NDJSON history, session-id matching, and stream JSON parsing. This package is not a provider framework: it does not define provider protocols, canonical event schemas, auth logic, retry policy, or session/runtime inheritance.

## Install

```sh
npm install @bbingz/polycli-utils
```

## Root Exports

The root export mirrors `src/index.js`:

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

## Subpath Exports

- `@bbingz/polycli-utils/args`
- `@bbingz/polycli-utils/process`
- `@bbingz/polycli-utils/stream`
- `@bbingz/polycli-utils/atomic-save`
- `@bbingz/polycli-utils/ndjson`
- `@bbingz/polycli-utils/session-id`
- `@bbingz/polycli-utils/parse-stream-json`

## Example

```js
import {
  parseArgs,
  createLineDecoder,
  parseStreamJsonLine,
  appendNdjson,
  resolveSessionId,
} from "@bbingz/polycli-utils";
```

## Semver Policy

v1.x is the first stable line. Additive exports and backward-compatible behavior are minor releases. Removing exports, changing documented return shapes, or collapsing existing error/status semantics requires a major version.

The authoritative v1 surface reference is [docs/polycli-v1-public-surface.md](../../docs/polycli-v1-public-surface.md).
