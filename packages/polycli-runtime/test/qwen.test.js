import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import { TRANSIENT_PROBE_ERROR_PATTERNS as QWEN_TRANSIENT_PROBE_ERROR_PATTERNS } from "../src/qwen.js";
import {
  buildQwenEnv,
  buildQwenInvocation,
  extractQwenText,
  getQwenAuthStatus,
  parseQwenStreamText,
  runQwenPrompt,
  runQwenPromptStreaming,
} from "../src/index.js";

function withFakeQwenBin(source, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-qwen-sync-"));
  const bin = path.join(root, "qwen");
  fs.writeFileSync(bin, source, { mode: 0o755 });
  const env = {
    PATH: `${root}:${process.env.PATH || ""}`,
    HOME: process.env.HOME || root,
    LANG: process.env.LANG || "en_US.UTF-8",
  };

  try {
    return fn({ root, env });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("buildQwenInvocation defaults to yolo and validates uuid session ids", () => {
  const invocation = buildQwenInvocation({
    prompt: "review this diff",
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.deepEqual(invocation.args, [
    "--session-id",
    "123e4567-e89b-12d3-a456-426614174000",
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--max-session-turns",
    "20",
    "review this diff",
  ]);

  assert.throws(
    () => buildQwenInvocation({ prompt: "x", sessionId: "not-a-uuid" }),
    /UUID/
  );
});

test("buildQwenInvocation supports resume-last and lets callers override approval mode to plan", () => {
  const invocation = buildQwenInvocation({
    prompt: "continue",
    resumeLast: true,
    maxSteps: 5,
  });

  assert.deepEqual(invocation.args, [
    "-c",
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--max-session-turns",
    "5",
    "continue",
  ]);

  const planInvocation = buildQwenInvocation({
    prompt: "x",
    approvalMode: "plan",
  });
  assert.equal(planInvocation.args.includes("plan"), true);
  assert.equal(planInvocation.args.includes("yolo"), false);
});

test("buildQwenInvocation appends extra args after the prompt for array options", () => {
  const invocation = buildQwenInvocation({
    prompt: "review this diff",
    approvalMode: "plan",
    extraArgs: ["--exclude-tools", "read_file"],
  });

  assert.deepEqual(invocation.args, [
    "--output-format",
    "stream-json",
    "--approval-mode",
    "plan",
    "--max-session-turns",
    "20",
    "review this diff",
    "--exclude-tools",
    "read_file",
  ]);
});

test("buildQwenInvocation forwards an explicit model before the prompt", () => {
  const invocation = buildQwenInvocation({
    prompt: "review this diff",
    model: "qwen-plus",
  });

  const modelIndex = invocation.args.indexOf("--model");
  const promptIndex = invocation.args.indexOf("review this diff");
  assert.notEqual(modelIndex, -1);
  assert.equal(invocation.args[modelIndex + 1], "qwen-plus");
  assert.ok(modelIndex < promptIndex);
});

test("buildQwenEnv injects proxy settings without overwriting explicit env", () => {
  const env = buildQwenEnv(
    { proxy: "http://127.0.0.1:7890" },
    {
      PATH: "/bin",
      HTTPS_PROXY: "http://keep.me:9000",
      OPENAI_API_KEY: "secret",
      ANTHROPIC_API_KEY: "secret-2",
    }
  );

  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, "http://keep.me:9000");
  assert.equal(env.HTTP_PROXY, "http://keep.me:9000");
  assert.equal(env.PATH, "/bin");
  assert.match(env.NO_PROXY, /localhost/);
});

test("parseQwenStreamText keeps assistant text, tool calls, and result event", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-1","model":"qwen-max","mcp_servers":["fs"]}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"1","name":"bash","input":{"cmd":"pwd"}}]}}',
      '{"type":"result","subtype":"success"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-1");
  assert.equal(parsed.response, "hello");
  assert.equal(parsed.toolUses.length, 1);
  assert.deepEqual(parsed.mcpServers, ["fs"]);
  assert.deepEqual(parsed.resultEvent, { type: "result", subtype: "success" });
});

test("parseQwenStreamText falls back to result text when assistant text is missing", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-2","model":"qwen-max"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}',
      '{"type":"result","subtype":"success","result":"No issues found."}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-2");
  assert.equal(parsed.response, "No issues found.");
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "success",
    result: "No issues found.",
  });
});

test("extractQwenText falls back to successful result event text", () => {
  assert.equal(
    extractQwenText({ type: "result", subtype: "success", result: "No issues found." }),
    "No issues found."
  );
});

test("extractQwenText ignores error result events", () => {
  assert.equal(
    extractQwenText({ type: "result", subtype: "error", is_error: true, result: "permission denied" }),
    ""
  );
  assert.equal(
    extractQwenText({ type: "result", subtype: "error", result: "permission denied" }),
    ""
  );
});

test("parseQwenStreamText does not treat error result text as a successful response", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-err","model":"qwen-max"}',
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}',
      '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}',
    ].join("\n")
  );

  assert.equal(parsed.sessionId, "q-err");
  assert.equal(parsed.response, "");
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "error",
    is_error: true,
    result: "permission denied",
  });
});

test("parseQwenStreamText treats subtype-only result errors as failures", () => {
  const parsed = parseQwenStreamText(
    [
      '{"type":"system","subtype":"init","session_id":"q-subtype-err","model":"qwen-max"}',
      '{"type":"result","subtype":"error","result":"permission denied"}',
    ].join("\n")
  );

  assert.equal(parsed.response, "");
  assert.deepEqual(parsed.resultEvent, {
    type: "result",
    subtype: "error",
    result: "permission denied",
  });
});

test("runQwenPrompt accepts result-only success responses", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-1", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "No issues found.", is_error: false }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, true);
      assert.equal(result.response, "No issues found.");
      assert.equal(result.error, null);
    }
  );
});

test("runQwenPrompt surfaces result-only errors", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-2", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "permission denied", is_error: true }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "");
      assert.equal(result.error, "permission denied");
      assert.equal(result.errorCode, "provider_error");
    }
  );
});

test("runQwenPrompt classifies maximum session turn failures", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "Maximum session turn limit reached", is_error: true }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "Maximum session turn limit reached");
      assert.equal(result.errorCode, "qwen_max_session_turns");
    }
  );
});

test("runQwenPrompt surfaces subtype-only result errors", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-subtype-err", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "permission denied" }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "");
      assert.equal(result.error, "permission denied");
    }
  );
});

test("runQwenPrompt fails when assistant text is followed by an error result", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "q-sync-3", model: "qwen-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "partial answer" }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "error", result: "permission denied", is_error: true }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.response, "partial answer");
      assert.equal(result.error, "permission denied");
    }
  );
});

test("runQwenPrompt falls back to stderr session ids when stdout has none", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stderr.write("resume 123e4567-e89b-42d3-a456-426614174000\\n");
process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello world" }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "hello world", is_error: false }) + "\\n");
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, true);
      assert.equal(result.sessionId, "123e4567-e89b-42d3-a456-426614174000");
    }
  );
});

test("runQwenPrompt does not leak stdout on non-zero exit", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", result: "secret token", is_error: false }) + "\\n");
process.exit(2);
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "qwen exited with code 2");
    }
  );
});

test("runQwenPrompt returns an explicit empty-output error on zero exit with no visible text", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
process.exit(0);
`,
    ({ root, env }) => {
      const result = runQwenPrompt({
        prompt: "ping",
        cwd: root,
        env,
      });

      assert.equal(result.ok, false);
      assert.equal(result.error, "qwen produced no visible text");
    }
  );
});

test("getQwenAuthStatus keeps loggedIn=true for transient probe failures", () => {
  const auth = getQwenAuthStatus(process.cwd(), {
    envBuilder() {
      return {};
    },
    promptRunner() {
      return { ok: false, error: "qwen timed out after 30s", model: null };
    },
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /timed out after 30s/i);
});

test("getQwenAuthStatus routes named transient probe patterns to inconclusive auth", () => {
  assert.ok(QWEN_TRANSIENT_PROBE_ERROR_PATTERNS.length > 0);

  for (const pattern of QWEN_TRANSIENT_PROBE_ERROR_PATTERNS) {
    const error = "synthetic probe timed out";
    assert.match(error, pattern);
    const auth = getQwenAuthStatus(process.cwd(), {
      envBuilder() {
        return {};
      },
      promptRunner() {
        return { ok: false, error, model: null };
      },
    });

    assert.equal(auth.loggedIn, true);
    assert.match(auth.detail, /inconclusive/i);
  }

  const auth = getQwenAuthStatus(process.cwd(), {
    envBuilder() {
      return {};
    },
    promptRunner() {
      return { ok: false, error: "401 Unauthorized: bad token" };
    },
  });
  assert.equal(auth.loggedIn, false);
});

test("parseQwenStreamText replays a captured real cli fixture", () => {
  const { stream, meta } = loadStreamFixture("qwen", "stream-success");
  const parsed = parseQwenStreamText(stream);

  assert.equal(parsed.response, meta.expected.response);
  assert.equal(parsed.sessionId, meta.expected.sessionId);
});

test("runQwenPrompt normalizes a real spawn timeout so the auth probe stays inconclusive", () => {
  withFakeQwenBin(
    `#!/usr/bin/env node
setTimeout(() => {}, 5000);
`,
    ({ root, env }) => {
      const result = runQwenPrompt({ prompt: "ping", cwd: root, env, timeout: 200 });

      assert.equal(result.ok, false);
      assert.match(result.error, /qwen timed out after/i);

      // The normalized message must classify as transient so auth stays inconclusive,
      // never regressing a timeout to loggedIn:false.
      const auth = getQwenAuthStatus(root, {
        envBuilder: () => env,
        promptRunner: () => result,
      });
      assert.equal(auth.loggedIn, true);
      assert.match(auth.detail, /inconclusive/i);
    }
  );
});

test("runQwenPromptStreaming returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn qwen ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
});

test("runQwenPromptStreaming passes explicit model to the qwen invocation", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};
  let spawnedArgs = null;

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    model: "qwen-plus",
    spawnImpl(_bin, args) {
      spawnedArgs = args;
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-2","model":"qwen-plus"}\n');
        child.stdout.emit("data", '{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(spawnedArgs.includes("--model"), true);
  assert.equal(spawnedArgs[spawnedArgs.indexOf("--model") + 1], "qwen-plus");
});

test("runQwenPromptStreaming returns an explicit error when no visible assistant text is emitted", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-3","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hidden"}]}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"success"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "qwen produced no visible text");
});

test("runQwenPromptStreaming surfaces result-event errors when the process exits cleanly", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-4","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "permission denied");
});

test("runQwenPromptStreaming surfaces subtype-only result errors", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-4b","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "permission denied");
});

test("runQwenPromptStreaming fails when assistant text is followed by an error result event", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runQwenPromptStreaming({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"system","subtype":"init","session_id":"q-5","model":"qwen-test"}\n');
        child.stdout.emit("data", '{"type":"assistant","message":{"content":[{"type":"text","text":"partial answer"}]}}\n');
        child.stdout.emit("data", '{"type":"result","subtype":"error","is_error":true,"result":"permission denied"}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.response, "partial answer");
  assert.equal(result.error, "permission denied");
});
