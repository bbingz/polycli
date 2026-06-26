import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildMiniMaxInvocation,
  extractMiniMaxLogPath,
  extractMiniMaxResponseFromLogText,
  getMiniMaxAuthStatus,
  parseMiniMaxResponseBlocks,
  runMiniMaxPrompt,
  stripAnsiSgr,
} from "../src/index.js";

test("buildMiniMaxInvocation targets mmx text chat in non-interactive json mode", () => {
  const invocation = buildMiniMaxInvocation({
    prompt: "fix the bug",
    cwd: "/tmp/project",
    extraArgs: ["--model", "MiniMax-M1"],
  });

  assert.deepEqual(invocation.args, [
    "text",
    "chat",
    "--message",
    "fix the bug",
    "--output",
    "json",
    "--non-interactive",
    "--model",
    "MiniMax-M1",
  ]);
});

test("runMiniMaxPrompt parses mmx json responses without log files", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runMiniMaxPrompt({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", `${JSON.stringify({
          model: "MiniMax-M2.7",
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        })}\n`);
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "pong");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.model, "MiniMax-M2.7");
});

test("runMiniMaxPrompt parses real mmx content arrays and ignores auth notices on success", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runMiniMaxPrompt({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stderr.emit("data", "API key saved to /Users/example/.mmx/config.json\n");
        child.stdout.emit("data", `${JSON.stringify({
          model: "MiniMax-M2.7",
          content: [
            { type: "thinking", thinking: "hidden chain of thought" },
            { type: "text", text: "pong" },
          ],
          stop_reason: "end_turn",
        })}\n`);
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.response, "pong");
  assert.equal(result.error, null);
  assert.equal(result.model, "MiniMax-M2.7");
  // Anthropic-shape responses carry `stop_reason`, not `finish_reason`.
  assert.equal(result.finishReason, "end_turn");
});

test("minimax log helpers extract response blocks and sanitize ansi", () => {
  const logText = [
    "[1] RESPONSE",
    '{',
    '  "content": "done",',
    '  "finish_reason": "stop",',
    '  "tool_calls": []',
    '}',
  ].join("\n");

  assert.equal(stripAnsiSgr("\u001b[31merror\u001b[0m"), "error");
  assert.equal(extractMiniMaxLogPath("Log file: /tmp/run.log\n"), "/tmp/run.log");
  assert.equal(parseMiniMaxResponseBlocks(logText).length, 1);
  assert.deepEqual(extractMiniMaxResponseFromLogText(logText), {
    response: "done",
    finishReason: "stop",
    toolCalls: [],
  });
});

test("minimax log parser keeps braces inside JSON strings balanced", () => {
  const logText = [
    "[1] RESPONSE",
    '{',
    '  "content": "done with {braces} intact",',
    '  "finish_reason": "stop",',
    '  "tool_calls": [{"id":"call-1","arguments":"{\\"a\\":1}"}]',
    '}',
  ].join("\n");

  assert.equal(parseMiniMaxResponseBlocks(logText).length, 1);
  assert.deepEqual(extractMiniMaxResponseFromLogText(logText), {
    response: "done with {braces} intact",
    finishReason: "stop",
    toolCalls: [{ id: "call-1", arguments: '{"a":1}' }],
  });
});

test("runMiniMaxPrompt returns a structured failure on spawn error", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runMiniMaxPrompt({
    prompt: "ping",
    defaultModel: "minimax-fallback",
    spawnImpl() {
      queueMicrotask(() => {
        const error = new Error("spawn mmx ENOENT");
        error.code = "ENOENT";
        child.emit("error", error);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /ENOENT/);
  assert.equal(result.model, "minimax-fallback");
});

test("runMiniMaxPrompt reports empty mmx output as no visible text", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {}, on() {} };
  child.kill = () => {};

  const result = await runMiniMaxPrompt({
    prompt: "ping",
    spawnImpl() {
      queueMicrotask(() => {
        child.stdout.emit("data", `${JSON.stringify({ choices: [{ message: { content: "" } }] })}\n`);
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /minimax produced no visible text/i);
});

test("minimax helpers replay a captured real cli fixture", () => {
  const { stream, logText, meta } = loadStreamFixture("minimax", "run-success");

  assert.ok(extractMiniMaxLogPath(stream));
  assert.deepEqual(extractMiniMaxResponseFromLogText(logText), meta.expected);
});

test("getMiniMaxAuthStatus stays inconclusive (loggedIn:true) on a probe timeout", async () => {
  const auth = await getMiniMaxAuthStatus(process.cwd(), {
    runner: () => ({
      error: { code: "ETIMEDOUT", message: "spawnSync mmx ETIMEDOUT" },
      status: null,
      stdout: "",
      stderr: "",
    }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getMiniMaxAuthStatus stays inconclusive on a transient non-zero exit", async () => {
  const auth = await getMiniMaxAuthStatus(process.cwd(), {
    runner: () => ({ error: null, status: 1, stdout: "", stderr: "503 service unavailable, try again" }),
  });

  assert.equal(auth.loggedIn, true);
  assert.match(auth.detail, /inconclusive/i);
});

test("getMiniMaxAuthStatus reports loggedIn=false on an explicit auth failure", async () => {
  const auth = await getMiniMaxAuthStatus(process.cwd(), {
    runner: () => ({ error: null, status: 1, stdout: "", stderr: "401 unauthorized: invalid api key" }),
  });

  assert.equal(auth.loggedIn, false);
});
