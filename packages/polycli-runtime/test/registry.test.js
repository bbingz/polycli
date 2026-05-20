import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  PROVIDER_IDS,
  PROVIDER_OPERATION_NAMES,
  getProviderRuntime,
  listProviderRuntimes,
  runProviderPrompt,
  runProviderPromptStreaming,
} from "../src/index.js";

test("provider registry exposes the ten integrated runtimes", () => {
  assert.deepEqual(PROVIDER_IDS, ["gemini", "kimi", "qwen", "minimax", "claude", "copilot", "opencode", "pi", "cmd", "agy"]);
  assert.deepEqual(PROVIDER_OPERATION_NAMES, ["prompt"]);

  const runtimes = listProviderRuntimes();
  assert.deepEqual(runtimes.map((runtime) => runtime.id), PROVIDER_IDS);

  for (const runtime of runtimes) {
    assert.equal(typeof runtime.getAvailability, "function");
    assert.equal(typeof runtime.getAuthStatus, "function");
    assert.equal(typeof runtime.runPrompt, "function");
    assert.equal(typeof runtime.runPromptStreaming, "function");
    assert.equal(typeof runtime.capabilities.streaming, "boolean");
    assert.equal(typeof runtime.capabilities.sessionResume, "boolean");
    assert.deepEqual(runtime.capabilities.operations, PROVIDER_OPERATION_NAMES);
  }
});

test("cmd runtime reflects documented standalone headless session scope", () => {
  const runtime = getProviderRuntime("cmd");
  assert.equal(runtime.capabilities.sessionResume, false);
});

test("agy runtime reflects documented text-only session-resumable scope", () => {
  const runtime = getProviderRuntime("agy");
  assert.deepEqual(runtime.capabilities, {
    streaming: true,
    sessionResume: true,
    structuredOutput: false,
    operations: PROVIDER_OPERATION_NAMES,
  });
});

test("getProviderRuntime returns a stable runtime for each provider id", () => {
  for (const providerId of PROVIDER_IDS) {
    const runtime = getProviderRuntime(providerId);
    assert.equal(runtime.id, providerId);
  }
});

test("provider runtimes are frozen against accidental mutation", () => {
  const runtime = getProviderRuntime("claude");
  assert.equal(Object.isFrozen(runtime), true);
  assert.throws(() => {
    runtime.id = "mutated";
  }, /read only|Cannot assign|Cannot set property/i);
});

test("runProviderPromptStreaming ignores duplicate terminal summary text for providers with prior visible output", async () => {
  const cases = [
    {
      provider: "claude",
      lines: [
        '{"type":"system","subtype":"init","session_id":"claude-timing"}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
        '{"type":"result","subtype":"success","is_error":false,"result":"hello world"}',
      ],
    },
    {
      provider: "copilot",
      lines: [
        '{"type":"session_start","sessionId":"copilot-timing","model":"copilot-test"}',
        '{"type":"assistant.message_delta","data":{"messageId":"m-1","deltaContent":"hello "}}',
        '{"type":"assistant.message_delta","data":{"messageId":"m-1","deltaContent":"world"}}',
        '{"type":"assistant.message","data":{"messageId":"m-1","content":"hello world","phase":"final_answer"}}',
        '{"type":"result","sessionId":"copilot-timing","exitCode":0}',
      ],
    },
    {
      provider: "opencode",
      lines: [
        '{"type":"step_start","sessionID":"open-timing","part":{"sessionID":"open-timing","type":"step-start"}}',
        '{"type":"text","sessionID":"open-timing","part":{"sessionID":"open-timing","type":"text","text":"hello "}}',
        '{"type":"text","sessionID":"open-timing","part":{"sessionID":"open-timing","type":"text","text":"world"}}',
        '{"type":"result","text":"hello world"}',
      ],
    },
    {
      provider: "gemini",
      lines: [
        '{"type":"init","session_id":"gemini-timing","model":"gemini-test"}',
        '{"type":"message","role":"assistant","content":"hello "}',
        '{"type":"message","role":"assistant","delta":"world"}',
        '{"type":"result","text":"hello world","stats":{"turns":1}}',
      ],
    },
    {
      provider: "pi",
      lines: [
        '{"type":"session_header","sessionId":"pi-timing","model":"pi-test"}',
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello "}}',
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"world"}}',
        '{"type":"agent_end","result":{"text":"hello world"}}',
      ],
    },
  ];

  const realNow = Date.now;

  try {
    for (const { provider, lines } of cases) {
      let now = 1_000;
      Date.now = () => now;

      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write() {}, end() {}, on() {} };
      child.kill = () => {};
      child.unref = () => {};

      const result = await runProviderPromptStreaming({
        provider,
        prompt: "ping",
        cwd: process.cwd(),
        timeout: 5_000,
        nowMs: () => now,
        spawnImpl() {
          queueMicrotask(() => {
            now = 1_100;
            child.stdout.emit("data", `${lines[0]}\n`);
            now = 1_200;
            child.stdout.emit("data", `${lines[1]}\n`);
            now = 1_300;
            child.stdout.emit("data", `${lines[2]}\n`);
            now = 1_400;
            child.stdout.emit("data", `${lines[3]}\n`);
            if (lines[4]) {
              now = 1_450;
              child.stdout.emit("data", `${lines[4]}\n`);
            }
            now = 1_700;
            child.emit("close", 0, null);
          });
          return child;
        },
      });

      assert.equal(result.ok, true, provider);
      assert.equal(result.response.trim(), "hello world", provider);
      assert.equal(result.timing.metrics.ttft.ms, 200, provider);
      assert.equal(result.timing.metrics.tail.ms, 400, provider);
    }
  } finally {
    Date.now = realNow;
  }
});

test("runProviderPromptStreaming records cmd timing from plain stdout text", async () => {
  let now = 1_000;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runProviderPromptStreaming({
    provider: "cmd",
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    nowMs: () => now,
    spawnImpl() {
      queueMicrotask(() => {
        now = 1_200;
        child.stdout.emit("data", "hello\n");
        now = 1_300;
        child.stdout.emit("data", "world\n");
        now = 1_700;
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "hello\nworld");
  assert.equal(result.timing.runtimePersistence, "ephemeral");
  assert.equal(result.timing.metrics.ttft.ms, 200);
  assert.equal(result.timing.metrics.tail.ms, 400);
});

test("runProviderPromptStreaming records agy timing from plain stdout text with missing session id", async () => {
  let now = 1_000;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runProviderPromptStreaming({
    provider: "agy",
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    nowMs: () => now,
    spawnImpl() {
      queueMicrotask(() => {
        now = 1_200;
        child.stdout.emit("data", "hello\n");
        now = 1_300;
        child.stdout.emit("data", "world\n");
        now = 1_700;
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "hello\nworld");
  assert.equal(result.timing.runtimePersistence, "session");
  assert.equal(result.timing.meta.sessionIdMissing, true);
  assert.equal(result.timing.metrics.ttft.ms, 200);
  assert.equal(result.timing.metrics.tail.ms, 400);
  assert.equal(result.timing.metrics.tool.status, "unsupported");
});

test("runProviderPromptStreaming passes defaultModel as final model fallback", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};
  child.unref = () => {};

  const result = await runProviderPromptStreaming({
    provider: "gemini",
    prompt: "ping",
    cwd: process.cwd(),
    timeout: 5_000,
    defaultModel: "fallback-model",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"type":"init","session_id":"gemini-fallback"}\n');
        child.stdout.emit("data", '{"type":"message","role":"assistant","content":"pong"}\n');
        child.stdout.emit("data", '{"type":"result","stats":{"turns":1}}\n');
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "fallback-model");
});

test("runProviderPrompt marks supported sync-only metrics as missing instead of unsupported", async () => {
  const result = await runProviderPrompt({
    provider: "gemini",
    prompt: "ping",
    cwd: process.cwd(),
    runtime: {
      runPrompt: async () => ({
        ok: true,
        response: "pong",
        sessionId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.timing.metrics.ttft.status, "missing");
  assert.equal(result.timing.metrics.gen.status, "missing");
  assert.equal(result.timing.metrics.tail.status, "missing");
  assert.equal(result.timing.runtimePersistence, "session");
});
