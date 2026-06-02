import test from "node:test";
import assert from "node:assert/strict";

import { classifyProviderFailure, formatProviderExitError } from "../src/errors.js";

test("formatProviderExitError maps special exit codes to semantic messages", () => {
  assert.equal(formatProviderExitError("claude", 124), "claude timed out");
  assert.equal(formatProviderExitError("claude", 130), "claude interrupted");
  assert.equal(formatProviderExitError("claude", 143), "claude terminated");
  assert.equal(formatProviderExitError("claude", 2), "claude exited with code 2");
});

test("classifyProviderFailure maps each failure signal to its class", () => {
  assert.equal(classifyProviderFailure("spawn cmd ENOENT"), "binary_missing");
  assert.equal(classifyProviderFailure("gemini timed out after 30s"), "timeout");
  assert.equal(classifyProviderFailure("process terminated by signal SIGTERM"), "terminated");
  assert.equal(classifyProviderFailure("process interrupted"), "cancelled");
  assert.equal(classifyProviderFailure("cmd produced no visible text"), "no_visible_text");
  assert.equal(classifyProviderFailure("401 invalid credential"), "auth");
  assert.equal(classifyProviderFailure(""), null);
  assert.equal(classifyProviderFailure("something unremarkable happened"), null);
});

test("classifyProviderFailure recognizes qwen max-session-turns only for qwen", () => {
  assert.equal(
    classifyProviderFailure("Maximum session turns exceeded", { provider: "qwen" }),
    "qwen_max_session_turns"
  );
  assert.notEqual(
    classifyProviderFailure("Maximum session turns exceeded"),
    "qwen_max_session_turns"
  );
});

test("classifyProviderFailure accepts an Error object and orders binary_missing before timeout", () => {
  assert.equal(classifyProviderFailure(new Error("spawn ENOENT")), "binary_missing");
  // 'not found' is checked before 'timed out', so binary_missing wins when both appear.
  assert.equal(classifyProviderFailure("binary not found; also timed out"), "binary_missing");
});
