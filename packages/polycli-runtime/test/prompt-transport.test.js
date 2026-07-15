import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildClaudeInvocation,
  buildGeminiInvocation,
  runClaudePrompt,
  runClaudePromptStreaming,
  runCmdPrompt,
  runCmdPromptStreaming,
  runCopilotPrompt,
  runCopilotPromptStreaming,
  runGeminiPrompt,
  runGeminiPromptStreaming,
  runGrokPrompt,
  runGrokPromptStreaming,
  runKimiPrompt,
  runKimiPromptStreaming,
  runMiniMaxPrompt,
  runMiniMaxPromptStreaming,
  runOpenCodePrompt,
  runOpenCodePromptStreaming,
  runPiPrompt,
  runPiPromptStreaming,
  runQwenPrompt,
  runQwenPromptStreaming,
} from "../src/index.js";

const LARGE_PROMPT = `UNIQUE_LARGE_PROMPT_MARKER_${"x".repeat(220_000)}`;

function createFakeChild({ stdout = "", stderr = "", status = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdinText = "";
  child.stdin.write = (chunk) => {
    child.stdinText += String(chunk);
    return true;
  };
  child.stdin.end = () => {};
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", status, null);
  });
  return child;
}

test("Claude and Gemini switch sub-100KB prompts to stdin when the effective argv budget is smaller", () => {
  const prompt = `WINDOWS_BUDGET_MARKER_${"x".repeat(30_000)}`;
  for (const [provider, invocation] of [
    ["claude", buildClaudeInvocation({ prompt, env: { PATH: "C:\\bin" }, argvBudgetBytes: 24 * 1024 })],
    ["gemini", buildGeminiInvocation({ prompt, env: { PATH: "C:\\bin" }, argvBudgetBytes: 24 * 1024 })],
  ]) {
    assert.equal(invocation.useStdin, true, provider);
    assert.equal(invocation.input, prompt, provider);
    assert.equal(invocation.args.includes(prompt), false, provider);
  }
});

test("Claude and Gemini sync runners send >200KB prompts completely through stdin", () => {
  const cases = [
    {
      provider: "claude",
      run: runClaudePrompt,
      stdout: JSON.stringify({ type: "result", result: "ok", session_id: "claude-session" }),
    },
    {
      provider: "gemini",
      run: runGeminiPrompt,
      stdout: JSON.stringify({ response: "ok", session_id: "gemini-session", stats: { models: { test: 1 } } }),
    },
  ];

  for (const entry of cases) {
    let observed = null;
    const result = entry.run({
      prompt: LARGE_PROMPT,
      env: { PATH: "/bin" },
      bin: `${entry.provider}-fake`,
      spawnImpl(bin, args, options) {
        observed = { bin, args, options };
        return { status: 0, signal: null, stdout: entry.stdout, stderr: "", error: null };
      },
    });

    assert.equal(result.ok, true, entry.provider);
    assert.equal(observed?.options.input, LARGE_PROMPT, entry.provider);
    assert.equal(observed?.args.includes(LARGE_PROMPT), false, entry.provider);
    assert.equal(observed?.args.join(" ").includes("UNIQUE_LARGE_PROMPT_MARKER"), false, entry.provider);
  }
});

test("Claude and Gemini streaming runners send >200KB prompts completely through stdin", async () => {
  const cases = [
    {
      provider: "claude",
      run: runClaudePromptStreaming,
      stdout: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session" }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
        JSON.stringify({ type: "result", result: "ok", session_id: "claude-session" }),
      ].join("\n") + "\n",
    },
    {
      provider: "gemini",
      run: runGeminiPromptStreaming,
      stdout: [
        JSON.stringify({ type: "init", session_id: "gemini-session" }),
        JSON.stringify({ type: "message", role: "assistant", content: "ok" }),
        JSON.stringify({ type: "result" }),
      ].join("\n") + "\n",
    },
  ];

  for (const entry of cases) {
    let observed = null;
    const result = await entry.run({
      prompt: LARGE_PROMPT,
      env: { PATH: "/bin" },
      bin: `${entry.provider}-fake`,
      spawnImpl(bin, args, options) {
        const child = createFakeChild({ stdout: entry.stdout });
        observed = { bin, args, options, child };
        return child;
      },
    });

    assert.equal(result.ok, true, entry.provider);
    assert.equal(observed?.child.stdinText, LARGE_PROMPT, entry.provider);
    assert.equal(observed?.args.includes(LARGE_PROMPT), false, entry.provider);
    assert.equal(observed?.args.join(" ").includes("UNIQUE_LARGE_PROMPT_MARKER"), false, entry.provider);
  }
});

const ARGV_ONLY_PROVIDERS = [
  { provider: "copilot", sync: runCopilotPrompt, streaming: runCopilotPromptStreaming },
  { provider: "opencode", sync: runOpenCodePrompt, streaming: runOpenCodePromptStreaming },
  { provider: "qwen", sync: runQwenPrompt, streaming: runQwenPromptStreaming },
  { provider: "pi", sync: runPiPrompt, streaming: runPiPromptStreaming },
  { provider: "cmd", sync: runCmdPrompt, streaming: runCmdPromptStreaming },
  { provider: "kimi", sync: runKimiPrompt, streaming: runKimiPromptStreaming },
  { provider: "minimax", sync: runMiniMaxPrompt, streaming: runMiniMaxPromptStreaming },
  { provider: "grok", sync: runGrokPrompt, streaming: runGrokPromptStreaming },
];

test("all argv-only review providers reject >200KB prompts before sync spawn", async (t) => {
  for (const entry of ARGV_ONLY_PROVIDERS) {
    await t.test(entry.provider, async () => {
      let spawnCalls = 0;
      const result = await entry.sync({
        prompt: LARGE_PROMPT,
        env: {},
        cwd: process.cwd(),
        bin: `__${entry.provider}_must_not_spawn__`,
        spawnImpl() {
          spawnCalls += 1;
          throw new Error("spawn must not be called");
        },
      });

      assert.equal(spawnCalls, 0);
      assert.equal(result.spawnErrorCode, "E2BIG");
      assert.equal(result.errorCode, "argument_list_too_long");
      assert.match(result.error, /--max-diff-bytes/);
      assert.doesNotMatch(result.error, /UNIQUE_LARGE_PROMPT_MARKER/);
    });
  }
});

test("all argv-only review providers reject >200KB prompts before streaming spawn", async (t) => {
  for (const entry of ARGV_ONLY_PROVIDERS) {
    await t.test(entry.provider, async () => {
      let spawnCalls = 0;
      const result = await entry.streaming({
        prompt: LARGE_PROMPT,
        env: {},
        cwd: process.cwd(),
        bin: `__${entry.provider}_must_not_spawn__`,
        spawnImpl() {
          spawnCalls += 1;
          throw new Error("spawn must not be called");
        },
      });

      assert.equal(spawnCalls, 0);
      assert.equal(result.spawnErrorCode, "E2BIG");
      assert.equal(result.errorCode, "argument_list_too_long");
      assert.match(result.error, /--max-diff-bytes/);
      assert.doesNotMatch(result.error, /UNIQUE_LARGE_PROMPT_MARKER/);
    });
  }
});

test("all argv-only review providers still call streaming spawn for short prompts", async (t) => {
  for (const entry of ARGV_ONLY_PROVIDERS) {
    await t.test(entry.provider, async () => {
      let spawnCalls = 0;
      await entry.streaming({
        prompt: "short",
        env: {},
        cwd: process.cwd(),
        bin: `${entry.provider}-fake`,
        spawnImpl() {
          spawnCalls += 1;
          return createFakeChild({ status: 1, stderr: "fixture failure" });
        },
      });
      assert.equal(spawnCalls, 1);
    });
  }
});
