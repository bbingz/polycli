import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { loadStreamFixture } from "./helpers/fixture-replay.mjs";
import {
  buildMiniMaxInvocation,
  extractMiniMaxLogPath,
  extractMiniMaxResponseFromLogText,
  parseMiniMaxResponseBlocks,
  runMiniMaxPrompt,
  stripAnsiSgr,
} from "../src/index.js";

test("buildMiniMaxInvocation targets mini-agent task mode", () => {
  const invocation = buildMiniMaxInvocation({
    prompt: "fix the bug",
    cwd: "/tmp/project",
    extraArgs: ["--model", "MiniMax-M1"],
  });

  assert.deepEqual(invocation.args, ["-t", "fix the bug", "-w", "/tmp/project", "--model", "MiniMax-M1"]);
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
        const error = new Error("spawn mini-agent ENOENT");
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

test("minimax helpers replay a captured real cli fixture", () => {
  const { stream, logText, meta } = loadStreamFixture("minimax", "run-success");

  assert.ok(extractMiniMaxLogPath(stream));
  assert.deepEqual(extractMiniMaxResponseFromLogText(logText), meta.expected);
});
