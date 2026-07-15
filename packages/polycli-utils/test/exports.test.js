import test from "node:test";
import assert from "node:assert/strict";

import * as utils from "../src/index.js";

test("utils index exports expected surface", () => {
  assert.deepEqual(Object.keys(utils).sort(), [
    "LockfileTimeoutError",
    "UUID_SESSION_ID_REGEX",
    "appendNdjson",
    "appendNdjsonBatch",
    "binaryAvailable",
    "createLineDecoder",
    "ensureParentDir",
    "formatCommandFailure",
    "matchSessionId",
    "parseArgs",
    "parseStreamJsonLine",
    "parseStreamJsonText",
    "readNdjson",
    "resolveSessionId",
    "runCommand",
    "runCommandChecked",
    "splitRawArgumentString",
    "tailNdjson",
    "terminateProcessTree",
    "withLockfile",
    "writeFileAtomic",
    "writeJsonAtomic",
  ]);
});
