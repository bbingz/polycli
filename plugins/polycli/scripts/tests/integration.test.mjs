import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClaudeFixtureReplay } from "./helpers/fixture-replay.mjs";
import { readLastUsedProvider, resolveWorkspaceRoot } from "../lib/state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionPath = path.resolve(__dirname, "..", "polycli-companion.bundle.mjs");

function createFakeQwenBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-qwen-"));
  const bin = path.join(root, "qwen");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
function logEvent(event) {
  if (!process.env.QWEN_EVENT_LOG) return;
  fs.appendFileSync(process.env.QWEN_EVENT_LOG, JSON.stringify({ provider: "qwen", event, time: Date.now() }) + "\\n");
}
if (args.includes("--version")) {
  process.stdout.write("qwen 0.0.0-test\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
if (process.env.QWEN_ARGV_LOG) {
  fs.writeFileSync(process.env.QWEN_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const prompt = args.at(-1) || "";
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : Number.parseInt(process.env.QWEN_DELAY_MS || "0", 10);
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const toolDelayMatch = prompt.match(/__toolDelay=(\\d+)/);
const toolDelay = toolDelayMatch ? Number.parseInt(toolDelayMatch[1], 10) : 0;
const useTool = prompt.includes("__tool=1");
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.QWEN_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
const appendSystemIndex = args.indexOf("--append-system-prompt");
const hasAppendSystem = appendSystemIndex >= 0 && Boolean(args[appendSystemIndex + 1]);
(async () => {
  logEvent("start");
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-1111-1111-1111-111111111111", model: "qwen-test" }) + "\\n");
  if (delay > 0) await sleep(delay);
  if (useTool) {
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "shell", input: { cmd: "pwd" } }] } }) + "\\n");
    if (toolDelay > 0) await sleep(toolDelay);
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: false }] } }) + "\\n");
  }
  if (process.env.QWEN_REQUIRE_APPEND_SYSTEM === "1" && !hasAppendSystem) {
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "missing final-answer constraint" }] } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", result: "", is_error: false, permission_denials: [] }) + "\\n");
    return;
  }
  if (process.env.QWEN_EMIT_THINKING === "1") {
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "thinking before final" }] } }) + "\\n");
  }
  if (process.env.QWEN_RESULT_ONLY !== "1") {
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: reply }] } }) + "\\n");
  }
  if (tailDelay > 0) await sleep(tailDelay);
  process.stdout.write(JSON.stringify({ type: "result", result: reply, is_error: false, permission_denials: [] }) + "\\n");
  logEvent("end");
})();
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeGeminiBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-gemini-"));
  const bin = path.join(root, "gemini");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);

(async () => {
  if (args.includes("-v")) {
    process.stdout.write("gemini 0.0.0-test\\n");
    process.exit(0);
  }
  if (process.env.GEMINI_ARGV_LOG) {
    fs.writeFileSync(process.env.GEMINI_ARGV_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + "\\n");
  }
  const outputFormat = args[args.indexOf("-o") + 1] || "json";
  const prompt = args[args.indexOf("-p") + 1] || "";
  const omitStreamModel = process.env.GEMINI_OMIT_STREAM_MODEL === "1";
  const pingDelay = prompt === "ping" ? Number.parseInt(process.env.GEMINI_PING_DELAY_MS || "0", 10) : 0;
  if (pingDelay > 0) await sleep(pingDelay);
  const delayMatch = prompt.match(/__delay=(\\d+)/);
  const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : 0;
  const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
  const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
  const replyMatch = prompt.match(/__reply=([^\\n]+)/);
  const reply = process.env.GEMINI_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt || "ping");
  if (outputFormat === "json") {
    process.stdout.write(JSON.stringify({
      response: reply,
      session_id: "22222222-2222-2222-2222-222222222222",
      stats: { models: { "gemini-test": 1 } }
    }) + "\\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ type: "init", session_id: "22222222-2222-2222-2222-222222222222", ...(omitStreamModel ? {} : { model: "gemini-test" }) }) + "\\n");
  if (delay > 0) await sleep(delay);
  process.stdout.write(JSON.stringify({ type: "message", role: "assistant", content: reply }) + "\\n");
  if (tailDelay > 0) await sleep(tailDelay);
  process.stdout.write(JSON.stringify(omitStreamModel ? { type: "result" } : { type: "result", stats: { models: { "gemini-test": 1 } } }) + "\\n");
})();
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeKimiBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-kimi-"));
  const bin = path.join(root, "kimi");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
function logEvent(event) {
  if (!process.env.KIMI_EVENT_LOG) return;
  fs.appendFileSync(process.env.KIMI_EVENT_LOG, JSON.stringify({ provider: "kimi", event, time: Date.now() }) + "\\n");
}
if (args.includes("-V")) {
  process.stdout.write("kimi 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.KIMI_ARGV_LOG) {
  fs.writeFileSync(process.env.KIMI_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const promptIndex = args.indexOf("-p");
const prompt = promptIndex >= 0 ? (args[promptIndex + 1] || "") : "ping";
const noThinking = args.includes("--no-thinking");
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : Number.parseInt(process.env.KIMI_DELAY_MS || "0", 10);
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.KIMI_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
(async () => {
  logEvent("start");
  process.stderr.write("To resume: kimi -r 33333333-3333-4333-8333-333333333333\\n");
  if (delay > 0) await sleep(delay);
  if (process.env.KIMI_REQUIRE_NO_THINKING === "1" && !noThinking) {
    process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "think", think: "missing no-thinking constraint" }] }) + "\\n");
    return;
  }
  if (process.env.KIMI_CONTENT_MODE === "string") {
    process.stdout.write(JSON.stringify({ role: "assistant", content: reply, model: "kimi-test" }) + "\\n");
  } else if (process.env.KIMI_EMIT_THINKING === "1" && !noThinking) {
    process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "think", think: "thinking before final" }, { type: "text", text: reply }], model: "kimi-test" }) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "text", text: reply }], model: "kimi-test" }) + "\\n");
  }
  if (tailDelay > 0) await sleep(tailDelay);
  logEvent("end");
})();
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeMiniMaxFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-minimax-"));
  const logDir = path.join(root, "logs");
  const configDir = path.join(root, "config");
  const configPath = path.join(configDir, "config.yaml");
  const bin = path.join(root, "mini-agent");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    [
      'api_key: "test-key"',
      'api_base: "https://api.example.test"',
      'model: "MiniMax-M1"',
    ].join("\n")
  );
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("mini-agent 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.MINI_AGENT_ENV_LOG) {
  fs.writeFileSync(process.env.MINI_AGENT_ENV_LOG, JSON.stringify({
    argv: args,
    MINI_AGENT_CONFIG_PATH: process.env.MINI_AGENT_CONFIG_PATH || null,
  }) + "\\n");
}
if (process.env.MINI_AGENT_CONFIG_SNAPSHOT && process.env.MINI_AGENT_CONFIG_PATH) {
  fs.copyFileSync(process.env.MINI_AGENT_CONFIG_PATH, process.env.MINI_AGENT_CONFIG_SNAPSHOT);
}
const prompt = args[args.indexOf("-t") + 1] || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.MINI_AGENT_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
const logDir = process.env.MINI_AGENT_LOG_DIR;
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, "mini-agent-test.log");
fs.writeFileSync(
  logPath,
  [
    "[1] RESPONSE",
    "{",
    '  "content": ' + JSON.stringify(reply) + ",",
    '  "finish_reason": "stop",',
    '  "tool_calls": []',
    "}",
  ].join("\\n")
);
process.stdout.write("Log file: " + logPath + "\\n");
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    logDir,
    configPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeClaudeBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-claude-"));
  const bin = path.join(root, "claude");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("claude 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.CLAUDE_ARGV_LOG) {
  fs.writeFileSync(process.env.CLAUDE_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const outputFormat = readArg("--output-format") || "text";
const hasVerbose = args.includes("--verbose");
const promptIndex = args.indexOf("-p");
const prompt = promptIndex >= 0 && args[promptIndex + 1] && !args[promptIndex + 1].startsWith("-")
  ? args[promptIndex + 1]
  : fs.readFileSync(0, "utf8");
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : 0;
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.CLAUDE_FIXED_REPLY || (replyMatch ? replyMatch[1] : (prompt || "ping"));
if (outputFormat === "json") {
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: reply,
    session_id: "44444444-4444-4444-8444-444444444444",
    duration_ms: 321
  }) + "\\n");
  process.exit(0);
}
if (outputFormat === "stream-json" && !hasVerbose) {
  process.stderr.write("Error: When using --print, --output-format=stream-json requires --verbose\\n");
  process.exit(1);
}
(async () => {
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "44444444-4444-4444-8444-444444444444", model: "claude-test" }) + "\\n");
  if (delay > 0) await sleep(delay);
  process.stdout.write(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } }) + "\\n");
  if (tailDelay > 0) await sleep(tailDelay);
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply, session_id: "44444444-4444-4444-8444-444444444444", duration_ms: 654 }) + "\\n");
})();
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeCopilotBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-copilot-"));
  const bin = path.join(root, "copilot");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write("copilot 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.COPILOT_ARGV_LOG) {
  fs.writeFileSync(process.env.COPILOT_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const prompt = readArg("-p") || readArg("--prompt") || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.COPILOT_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
const sessionId = "55555555-5555-4555-8555-555555555555";
process.stdout.write(JSON.stringify({ type: "session_start", sessionId, model: "copilot-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant.message_delta", data: { messageId: "copilot-msg-1", deltaContent: reply.slice(0, Math.max(1, Math.floor(reply.length / 2))) } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant.message", data: { messageId: "copilot-msg-1", content: reply, phase: "final_answer" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", sessionId, exitCode: 0 }) + "\\n");
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakeOpenCodeBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-opencode-"));
  const bin = path.join(root, "opencode");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write("opencode 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.OPENCODE_ARGV_LOG) {
  fs.writeFileSync(process.env.OPENCODE_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
if (process.env.OPENCODE_ENV_LOG) {
  fs.writeFileSync(process.env.OPENCODE_ENV_LOG, JSON.stringify({
    OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT || null,
  }) + "\\n");
}
if (args[0] !== "run") {
  process.stderr.write("expected run\\n");
  process.exit(1);
}
const prompt = args[1] || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.OPENCODE_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
process.stdout.write(JSON.stringify({ type: "step_start", sessionID: "open-555", part: { sessionID: "open-555", type: "step-start", model: "opencode-test" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "text", sessionID: "open-555", part: { sessionID: "open-555", type: "text", text: reply, model: "opencode-test" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "step_finish", sessionID: "open-555", part: { sessionID: "open-555", type: "step-finish", reason: "stop" } }) + "\\n");
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createFakePiBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-pi-"));
  const bin = path.join(root, "pi");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write("pi 0.0.0-test\\n");
  process.exit(0);
}
if (process.env.PI_ARGV_LOG) {
  fs.writeFileSync(process.env.PI_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const prompt = args.at(-1) || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.PI_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
process.stdout.write(JSON.stringify({ type: "session_header", sessionId: "pi-555", model: "pi-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: reply } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: { text: reply } }) + "\\n");
`,
    { mode: 0o755 }
  );
  return {
    root,
    bin,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const key of ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function runCompanion(args, { cwd, env, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [companionPath, ...args], {
      cwd,
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout after ${timeout}ms`));
    }, timeout);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readJsonLine(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").trim());
}

function createKimiSessionFixture({ home, cwd, sessionId }) {
  const realCwd = fs.realpathSync(cwd);
  const cwdHash = createHash("md5").update(realCwd).digest("hex");
  fs.mkdirSync(path.join(home, ".kimi", "sessions", cwdHash, sessionId), { recursive: true });
  fs.writeFileSync(path.join(home, ".kimi", "sessions", cwdHash, sessionId, "context.jsonl"), "{}\n");
  fs.writeFileSync(
    path.join(home, ".kimi", "kimi.json"),
    `${JSON.stringify({ work_dirs: [{ path: realCwd, kaos: "local", last_session_id: sessionId }] })}\n`
  );
  return { cwdHash, realCwd };
}

async function waitForTerminalJob(jobId, context) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await runCompanion(["status", "--json", jobId], context);
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    if (parsed.job.status !== "queued" && parsed.job.status !== "running") {
      return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not finish in time`);
}

async function assertSetupAndAsk(provider, env, prompt = "__reply=PONG") {
  const setup = await runCompanion(["setup", "--json", "--provider", provider], {
    cwd: process.cwd(),
    env,
  });
  assert.equal(setup.code, 0, setup.stderr);
  const setupPayload = JSON.parse(setup.stdout);
  assert.equal(setupPayload.length, 1);
  assert.equal(setupPayload[0].provider, provider);
  assert.equal(setupPayload[0].available, true);
  assert.equal(setupPayload[0].loggedIn, true);

  const ask = await runCompanion(
    ["ask", "--provider", provider, "--json", prompt],
    { cwd: process.cwd(), env }
  );
  assert.equal(ask.code, 0, ask.stderr);
  const askPayload = JSON.parse(ask.stdout);
  assert.equal(askPayload.provider, provider);
  assert.equal(askPayload.response, "PONG");
  assert.ok(
    askPayload.model && typeof askPayload.model === "string" && askPayload.model.length > 0,
    `${provider} ask result should include model`
  );
  assert.ok(askPayload.timing, "ask result should include timing");
  return askPayload;
}

function assertJsonError(result, expectedCode) {
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(typeof payload.error, "string");
  assert.equal(payload.code, expectedCode);
  return payload;
}

test("integration: subcommand help exits before provider dispatch", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: "__must_not_be_called__",
    });
    const commands = [
      "setup",
      "health",
      "ask",
      "rescue",
      "review",
      "adversarial-review",
      "status",
      "result",
      "cancel",
      "timing",
    ];
    for (const command of commands) {
      const result = await runCompanion([command, "--help", "--provider", "qwen"], {
        cwd: process.cwd(),
        env,
      });
      assert.equal(result.code, 0, `${command}: ${result.stderr}`);
      assert.match(result.stdout, /Usage:/, command);
      assert.equal(result.stderr, "");
    }
  } finally {
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: json errors keep structured shape", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  try {
    const context = {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    };
    const cases = [
      { args: ["ask", "--json"], code: "missing_provider" },
      { args: ["ask", "--provider", "nonexistent", "--json", "hi"], code: "unknown_provider" },
      { args: ["review", "--provider", "claude", "--scope", "wrong", "--json"], code: "invalid_scope" },
      { args: ["bogus", "--json"], code: "unknown_subcommand" },
      { args: ["result", "--json"], code: "no_completed_job" },
      { args: ["status", "fake", "--json"], code: "job_not_found" },
    ];
    for (const entry of cases) {
      const result = await runCompanion(entry.args, context);
      assert.equal(result.code, 1, entry.args.join(" "));
      assertJsonError(result, entry.code);
    }
  } finally {
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: cancel no-op uses exit 1 in text and json modes", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  try {
    const context = {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    };
    const text = await runCompanion(["cancel"], context);
    assert.equal(text.code, 1, text.stderr);
    assert.match(text.stdout, /No active job found to cancel\./);

    const json = await runCompanion(["cancel", "--json"], context);
    assert.equal(json.code, 1, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.cancelled, false);
    assert.equal(payload.reason, "not_found");
  } finally {
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: timing validates provider and history arguments", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  try {
    const context = {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    };

    const unknownProvider = await runCompanion(["timing", "--provider", "nonexistent", "--json"], context);
    assert.equal(unknownProvider.code, 1, unknownProvider.stderr);
    assertJsonError(unknownProvider, "unknown_provider");

    for (const rawHistory of ["abc", "-1"]) {
      const invalidHistory = await runCompanion(["timing", "--history", rawHistory, "--json"], context);
      assert.equal(invalidHistory.code, 1, invalidHistory.stderr);
      assertJsonError(invalidHistory, "invalid_history");
    }

    const zeroHistory = await runCompanion(["timing", "--history", "0", "--json"], context);
    assert.equal(zeroHistory.code, 0, zeroHistory.stderr);
    assert.equal(JSON.parse(zeroHistory.stdout).records.length, 0);

    const validProvider = await runCompanion(["timing", "--provider", "claude", "--history", "5", "--json"], context);
    assert.equal(validProvider.code, 0, validProvider.stderr);
    assert.ok(Array.isArray(JSON.parse(validProvider.stdout).records));
  } finally {
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup reports qwen as available when fake binary is configured", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const result = await runCompanion(["setup", "--json", "--provider", "qwen"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].provider, "qwen");
    assert.equal(parsed[0].available, true);
    assert.equal(parsed[0].loggedIn, true);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health verifies qwen with an end-to-end probe and records timing", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_FIXED_REPLY: "POLYCLI_HEALTH_OK",
    });
    const health = await runCompanion(["health", "--json", "--provider", "qwen"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 0, health.stderr);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.anyHealthy, true);
    assert.equal(payload.allHealthy, true);
    assert.deepEqual(payload.healthyProviders, ["qwen"]);
    assert.deepEqual(payload.unhealthyProviders, []);
    assert.equal(payload.results.length, 1);
    const report = payload.results[0];
    assert.equal(report.provider, "qwen");
    assert.equal(report.available, true);
    assert.equal(report.loggedIn, null);
    assert.equal(report.authDetail, "not checked by health");
    assert.equal(report.probe.ok, true);
    assert.equal(report.probe.responseMatched, true);
    assert.equal(report.probe.responsePreview, "POLYCLI_HEALTH_OK");
    assert.ok(report.probe.timing, "health result should include timing");

    const timing = await runCompanion(["timing", "--json", "--provider", "qwen", "--history", "1"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(timing.code, 0, timing.stderr);
    const timingPayload = JSON.parse(timing.stdout);
    assert.equal(timingPayload.records.length, 1);
    assert.equal(timingPayload.records[0].kind, "health");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health verifies claude with a captured cli fixture replay", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const replay = createClaudeFixtureReplay("health-ok");
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: replay.bin,
    });
    const health = await runCompanion(["health", "--json", "--provider", "claude"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 0, health.stderr);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.anyHealthy, true);
    assert.equal(payload.allHealthy, true);
    assert.deepEqual(payload.healthyProviders, ["claude"]);
    assert.deepEqual(payload.unhealthyProviders, []);
    assert.equal(payload.results.length, 1);
    const report = payload.results[0];
    assert.equal(report.provider, "claude");
    assert.equal(report.available, true);
    assert.equal(report.loggedIn, null);
    assert.equal(report.authDetail, "not checked by health");
    assert.equal(report.model, replay.meta.expected.model);
    assert.equal(report.probe.ok, true);
    assert.equal(report.probe.responseMatched, true);
    assert.equal(report.probe.responsePreview, replay.meta.expected.response);
    assert.ok(report.probe.timing, "health result should include timing");

    const timing = await runCompanion(["timing", "--json", "--provider", "claude", "--history", "1"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(timing.code, 0, timing.stderr);
    const timingPayload = JSON.parse(timing.stdout);
    assert.equal(timingPayload.records.length, 1);
    assert.equal(timingPayload.records[0].kind, "health");
  } finally {
    replay.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health exits nonzero when the provider probe does not match", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_FIXED_REPLY: "WRONG",
    });
    const health = await runCompanion(["health", "--json", "--provider", "qwen"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 2);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.anyHealthy, false);
    assert.equal(payload.allHealthy, false);
    assert.deepEqual(payload.healthyProviders, []);
    assert.deepEqual(payload.unhealthyProviders, ["qwen"]);
    const report = payload.results[0];
    assert.equal(report.probe.ok, true);
    assert.equal(report.probe.responseMatched, false);
    assert.equal(report.probe.responsePreview, "WRONG");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health does not wait for a provider auth probe", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeGeminiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
      GEMINI_FIXED_REPLY: "POLYCLI_HEALTH_OK",
      GEMINI_PING_DELAY_MS: "31000",
    });
    const startedAt = Date.now();
    const health = await runCompanion(["health", "--json", "--provider", "gemini"], {
      cwd: process.cwd(),
      env,
      timeout: 5_000,
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(health.code, 0, health.stderr);
    assert.equal(elapsedMs < 5_000, true, `health waited for auth probe, took ${elapsedMs}ms`);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, true);
    const report = payload.results[0];
    assert.equal(report.loggedIn, null);
    assert.equal(report.authDetail, "not checked by health");
    assert.equal(report.probe.ok, true);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health rejects --model without a single provider", async () => {
  const health = await runCompanion(["health", "--json", "--model", "provider-specific-model"], {
    cwd: process.cwd(),
  });

  assert.equal(health.code, 1);
  const payload = assertJsonError(health, "error");
  assert.match(payload.error, /--model requires --provider/i);
});

test("integration: health without provider returns every healthy provider", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fakeQwen = createFakeQwenBin();
  const fakeKimi = createFakeKimiBin();
  const missingBin = path.join(pluginData, "missing-provider-bin");
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: missingBin,
      CMD_CLI_BIN: missingBin,
      COPILOT_CLI_BIN: missingBin,
      GEMINI_CLI_BIN: missingBin,
      KIMI_CLI_BIN: fakeKimi.bin,
      MINI_AGENT_BIN: missingBin,
      OPENCODE_CLI_BIN: missingBin,
      PI_CLI_BIN: missingBin,
      QWEN_CLI_BIN: fakeQwen.bin,
      QWEN_FIXED_REPLY: "POLYCLI_HEALTH_OK",
      KIMI_FIXED_REPLY: "WRONG",
    });
    const health = await runCompanion(["health", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 0, health.stderr);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.anyHealthy, true);
    assert.equal(payload.allHealthy, false);
    assert.deepEqual(payload.healthyProviders, ["qwen"]);
    assert.deepEqual(payload.unhealthyProviders.sort(), ["claude", "cmd", "copilot", "gemini", "kimi", "minimax", "opencode", "pi"].sort());
    assert.equal(payload.results.length, 9);
    assert.equal(payload.results.find((result) => result.provider === "qwen").ok, true);
    assert.equal(payload.results.find((result) => result.provider === "kimi").ok, false);
    assert.equal(payload.results.find((result) => result.provider === "kimi").probe.responseMatched, false);
  } finally {
    fakeQwen.cleanup();
    fakeKimi.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health without provider probes providers concurrently", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fakeQwen = createFakeQwenBin();
  const fakeKimi = createFakeKimiBin();
  const missingBin = path.join(pluginData, "missing-provider-bin");
  const eventLog = path.join(pluginData, "health-events.ndjson");
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: missingBin,
      CMD_CLI_BIN: missingBin,
      COPILOT_CLI_BIN: missingBin,
      GEMINI_CLI_BIN: missingBin,
      KIMI_CLI_BIN: fakeKimi.bin,
      MINI_AGENT_BIN: missingBin,
      OPENCODE_CLI_BIN: missingBin,
      PI_CLI_BIN: missingBin,
      QWEN_CLI_BIN: fakeQwen.bin,
      QWEN_FIXED_REPLY: "POLYCLI_HEALTH_OK",
      KIMI_FIXED_REPLY: "POLYCLI_HEALTH_OK",
      QWEN_DELAY_MS: "600",
      KIMI_DELAY_MS: "600",
      QWEN_EVENT_LOG: eventLog,
      KIMI_EVENT_LOG: eventLog,
    });
    const health = await runCompanion(["health", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 0, health.stderr);
    const events = fs.readFileSync(eventLog, "utf8").trim().split(/\n+/).map((line) => JSON.parse(line));
    const qwenStart = events.find((event) => event.provider === "qwen" && event.event === "start")?.time;
    const qwenEnd = events.find((event) => event.provider === "qwen" && event.event === "end")?.time;
    const kimiStart = events.find((event) => event.provider === "kimi" && event.event === "start")?.time;
    const kimiEnd = events.find((event) => event.provider === "kimi" && event.event === "end")?.time;
    assert.equal(typeof qwenStart, "number");
    assert.equal(typeof qwenEnd, "number");
    assert.equal(typeof kimiStart, "number");
    assert.equal(typeof kimiEnd, "number");
    assert.equal(qwenStart < kimiEnd && kimiStart < qwenEnd, true, `expected overlapping probes, saw ${JSON.stringify(events)}`);

    const timing = await runCompanion(["timing", "--json", "--history", "10"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(timing.code, 0, timing.stderr);
    const timingPayload = JSON.parse(timing.stdout);
    const healthProviders = timingPayload.records
      .filter((record) => record.kind === "health")
      .map((record) => record.provider)
      .sort();
    assert.deepEqual(healthProviders, ["kimi", "qwen"]);
  } finally {
    fakeQwen.cleanup();
    fakeKimi.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: ask constrains qwen to emit a visible final answer", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "qwen-ask-argv.jsonl");
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_ARGV_LOG: argLog,
      QWEN_REQUIRE_APPEND_SYSTEM: "1",
      QWEN_EMIT_THINKING: "1",
      QWEN_FIXED_REPLY: "QWEN_ASK_OK",
    });
    const ask = await runCompanion(
      ["ask", "--provider", "qwen", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const payload = JSON.parse(ask.stdout);
    assert.equal(payload.response, "QWEN_ASK_OK");

    const logged = readJsonLine(argLog);
    const argv = logged.argv.join(" ");
    assert.match(argv, /--max-session-turns 1/);
    assert.match(argv, /--append-system-prompt/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: gemini ask parses --write and --effort into runtime options", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "gemini-flags-argv.jsonl");
  const fake = createFakeGeminiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
      GEMINI_ARGV_LOG: argLog,
      GEMINI_FIXED_REPLY: "GEMINI_FLAGS_OK",
    });
    const ask = await runCompanion(
      ["ask", "--provider", "gemini", "--write", "--effort", "high", "--json", "__reply=IGNORED"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const payload = JSON.parse(ask.stdout);
    assert.equal(payload.response, "GEMINI_FLAGS_OK");

    const logged = readJsonLine(argLog);
    const approvalIndex = logged.argv.indexOf("--approval-mode");
    assert.notEqual(approvalIndex, -1);
    assert.equal(logged.argv[approvalIndex + 1], "auto_edit");
    const prompt = logged.argv[logged.argv.indexOf("-p") + 1];
    assert.match(prompt, /^Think step by step\./);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: foreground ask records the last-used provider for stop-review gate lookup", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_FIXED_REPLY: "PONG",
    });
    const ask = await runCompanion(
      ["ask", "--provider", "qwen", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);

    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    try {
      assert.equal(readLastUsedProvider(resolveWorkspaceRoot(process.cwd())), "qwen");
    } finally {
      if (previous == null) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: kimi ask parses --resume-last, --resume, and --fresh", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-cwd-"));
  const argLog = path.join(pluginData, "kimi-flags-argv.jsonl");
  const fake = createFakeKimiBin();
  const sessionId = "33333333-3333-4333-8333-333333333333";
  try {
    createKimiSessionFixture({ home, cwd, sessionId });
    const env = cleanEnv({
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_ARGV_LOG: argLog,
      KIMI_FIXED_REPLY: "KIMI_FLAGS_OK",
    });

    const resumeLast = await runCompanion(
      ["ask", "--provider", "kimi", "--resume-last", "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(resumeLast.code, 0, resumeLast.stderr);
    let logged = readJsonLine(argLog);
    assert.deepEqual(logged.argv.slice(logged.argv.indexOf("-r"), logged.argv.indexOf("-r") + 2), ["-r", sessionId]);

    const explicitResume = await runCompanion(
      ["rescue", "--provider", "kimi", "--resume", sessionId, "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(explicitResume.code, 0, explicitResume.stderr);
    logged = readJsonLine(argLog);
    assert.deepEqual(logged.argv.slice(logged.argv.indexOf("-r"), logged.argv.indexOf("-r") + 2), ["-r", sessionId]);

    const fresh = await runCompanion(
      ["ask", "--provider", "kimi", "--fresh", "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(fresh.code, 0, fresh.stderr);
    logged = readJsonLine(argLog);
    assert.equal(logged.argv.includes("-r"), false);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("integration: unsupported flags emit one-line notes and continue", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fakeKimi = createFakeKimiBin();
  const fakeQwen = createFakeQwenBin();
  try {
    const kimiWrite = await runCompanion(
      ["ask", "--provider", "kimi", "--write", "--json", "__reply=PONG"],
      {
        cwd: process.cwd(),
        env: cleanEnv({
          CLAUDE_PLUGIN_DATA: pluginData,
          KIMI_CLI_BIN: fakeKimi.bin,
        }),
      }
    );
    assert.equal(kimiWrite.code, 0, kimiWrite.stderr);
    assert.equal(
      kimiWrite.stderr,
      "Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks.\n"
    );

    const qwenResume = await runCompanion(
      ["ask", "--provider", "qwen", "--resume-last", "--json", "__reply=PONG"],
      {
        cwd: process.cwd(),
        env: cleanEnv({
          CLAUDE_PLUGIN_DATA: pluginData,
          QWEN_CLI_BIN: fakeQwen.bin,
        }),
      }
    );
    assert.equal(qwenResume.code, 0, qwenResume.stderr);
    assert.match(qwenResume.stderr, /^--resume-last is kimi-specific; qwen will proceed without it\.\n$/);
  } finally {
    fakeKimi.cleanup();
    fakeQwen.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: kimi explicit resume mismatch emits a warning after spawn", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-kimi-cwd-"));
  const fake = createFakeKimiBin();
  const requested = "123e4567-e89b-42d3-a456-426614174000";
  const returned = "33333333-3333-4333-8333-333333333333";
  try {
    createKimiSessionFixture({ home, cwd, sessionId: requested });
    const result = await runCompanion(
      ["ask", "--provider", "kimi", "--resume", requested, "--json", "__reply=PONG"],
      {
        cwd,
        env: cleanEnv({
          HOME: home,
          USERPROFILE: home,
          CLAUDE_PLUGIN_DATA: pluginData,
          KIMI_CLI_BIN: fake.bin,
        }),
      }
    );

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.resumeMismatched, true);
    assert.match(
      result.stderr,
      new RegExp(`Warning: requested --resume ${requested} did not match returned session ${returned}`)
    );
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for gemini via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeGeminiBin();
  try {
    const askPayload = await assertSetupAndAsk("gemini", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
    }), "__delay=25 __tail=35 __reply=PONG");
    assert.equal(askPayload.timing.runtimePersistence, "session");
    assert.equal(askPayload.timing.metrics.ttft.status, "measured");
    assert.equal(askPayload.timing.metrics.gen.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.status, "measured");
    assert.equal(askPayload.timing.metrics.tool.status, "unsupported");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: ask uses cached setup model when a provider stream omits model", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeGeminiBin();
  try {
    const askPayload = await assertSetupAndAsk("gemini", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
      GEMINI_OMIT_STREAM_MODEL: "1",
    }));
    assert.equal(askPayload.model, "gemini-test");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: gemini setup stays logged in when auth probe times out but ask still works", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeGeminiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
      GEMINI_PING_DELAY_MS: "31000",
    });

    const setup = await runCompanion(["setup", "--json", "--provider", "gemini"], {
      cwd: process.cwd(),
      env,
      timeout: 40_000,
    });
    assert.equal(setup.code, 0, setup.stderr);

    const setupPayload = JSON.parse(setup.stdout);
    assert.equal(setupPayload.length, 1);
    assert.equal(setupPayload[0].provider, "gemini");
    assert.equal(setupPayload[0].available, true);
    assert.equal(setupPayload[0].loggedIn, true);
    assert.match(setupPayload[0].authDetail, /timed out/i);

    const ask = await runCompanion(
      ["ask", "--provider", "gemini", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const askPayload = JSON.parse(ask.stdout);
    assert.equal(askPayload.response, "PONG");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for kimi via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeKimiBin();
  try {
    const askPayload = await assertSetupAndAsk("kimi", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
    }), "__delay=20 __tail=30 __reply=PONG");
    assert.equal(askPayload.timing.runtimePersistence, "session");
    assert.equal(askPayload.timing.metrics.ttft.status, "measured");
    assert.equal(askPayload.timing.metrics.gen.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.status, "measured");
    assert.equal(askPayload.timing.metrics.tool.status, "unsupported");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: ask constrains kimi to a visible non-thinking answer", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "kimi-ask-argv.jsonl");
  const fake = createFakeKimiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_ARGV_LOG: argLog,
      KIMI_REQUIRE_NO_THINKING: "1",
      KIMI_FIXED_REPLY: "KIMI_ASK_OK",
    });
    const ask = await runCompanion(
      ["ask", "--provider", "kimi", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const payload = JSON.parse(ask.stdout);
    assert.equal(payload.response, "KIMI_ASK_OK");

    const logged = readJsonLine(argLog);
    const argv = logged.argv.join(" ");
    assert.match(argv, /--no-thinking/);
    assert.match(argv, /--max-steps-per-turn 1/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains kimi to one non-thinking turn", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "kimi-argv.jsonl");
  const fake = createFakeKimiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_ARGV_LOG: argLog,
      KIMI_FIXED_REPLY: "REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "kimi", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "REVIEW_OK");

    const logged = JSON.parse(fs.readFileSync(argLog, "utf8").trim());
    assert.match(logged.argv.join(" "), /--no-thinking/);
    assert.match(logged.argv.join(" "), /--max-steps-per-turn 1/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review --background preserves kimi runtime options and stored response", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "kimi-background-argv.jsonl");
  const fake = createFakeKimiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_ARGV_LOG: argLog,
      KIMI_FIXED_REPLY: "BACKGROUND_KIMI_OK",
    });
    const start = await runCompanion(
      ["review", "--provider", "kimi", "--background", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.ok, true);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.response, "BACKGROUND_KIMI_OK");
    assert.equal(payload.job.jobId, started.job.jobId);

    const logged = JSON.parse(fs.readFileSync(argLog, "utf8").trim());
    assert.match(logged.argv.join(" "), /--no-thinking/);
    assert.match(logged.argv.join(" "), /--max-steps-per-turn 1/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review --background preserves qwen runtime options and stored response", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "qwen-background-argv.jsonl");
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_ARGV_LOG: argLog,
      QWEN_FIXED_REPLY: "BACKGROUND_QWEN_OK",
    });
    const start = await runCompanion(
      ["review", "--provider", "qwen", "--background", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.ok, true);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.response, "BACKGROUND_QWEN_OK");
    assert.equal(payload.job.jobId, started.job.jobId);
    assert.equal(payload.stdout, undefined);
    assert.equal(payload.stderr, undefined);
    assert.equal(payload.events, undefined);
    assert.equal(typeof payload.stdoutBytes, "number");
    assert.equal(
      payload.stderrBytes === undefined || typeof payload.stderrBytes === "number",
      true
    );
    assert.equal(
      payload.eventCount === undefined || typeof payload.eventCount === "number",
      true
    );

    const logged = JSON.parse(fs.readFileSync(argLog, "utf8").trim());
    const argv = logged.argv.join(" ");
    assert.match(argv, /--max-session-turns 1/);
    assert.match(argv, /--append-system-prompt/);

    const logText = fs.readFileSync(started.job.logFile, "utf8");
    const occurrences = (logText.match(/BACKGROUND_QWEN_OK/g) || []).length;
    assert.equal(occurrences, 1);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: qwen result-only review still records timing text and preview", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
      QWEN_FIXED_REPLY: "RESULT_ONLY_QWEN_OK",
      QWEN_RESULT_ONLY: "1",
    });
    const start = await runCompanion(
      ["review", "--provider", "qwen", "--background", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.response, "RESULT_ONLY_QWEN_OK");
    assert.equal(payload.job.jobId, started.job.jobId);
    assert.equal(payload.timing.metrics.ttft.status, "measured");
    assert.equal(payload.timing.metrics.gen.status, "measured");
    assert.equal(payload.timing.metrics.tail.status, "measured");

    const logText = fs.readFileSync(started.job.logFile, "utf8");
    assert.match(logText, /RESULT_ONLY_QWEN_OK/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: kimi string-content review still records preview text", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeKimiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_FIXED_REPLY: "STRING_KIMI_OK",
      KIMI_CONTENT_MODE: "string",
    });
    const start = await runCompanion(
      ["review", "--provider", "kimi", "--background", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.response, "STRING_KIMI_OK");
    assert.equal(payload.job.jobId, started.job.jobId);

    const logText = fs.readFileSync(started.job.logFile, "utf8");
    assert.match(logText, /STRING_KIMI_OK/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains claude to one turn with no tools", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "claude-review-argv.jsonl");
  const fake = createFakeClaudeBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: fake.bin,
      CLAUDE_ARGV_LOG: argLog,
      CLAUDE_FIXED_REPLY: "CLAUDE_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "claude", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "CLAUDE_REVIEW_OK");

    const logged = readJsonLine(argLog);
    assert.match(logged.argv.join(" "), /--max-turns 1/);
    const toolsIndex = logged.argv.indexOf("--tools");
    assert.notEqual(toolsIndex, -1);
    assert.equal(logged.argv[toolsIndex + 1], "");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains gemini with isolated cwd and disabled extensions/mcp", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "gemini-review-argv.jsonl");
  const fake = createFakeGeminiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      GEMINI_CLI_BIN: fake.bin,
      GEMINI_ARGV_LOG: argLog,
      GEMINI_FIXED_REPLY: "GEMINI_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "gemini", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "GEMINI_REVIEW_OK");

    const logged = readJsonLine(argLog);
    assert.notEqual(logged.cwd, process.cwd());
    assert.equal(fs.existsSync(logged.cwd), false);
    assert.match(logged.argv.join(" "), /--approval-mode plan/);
    const extensionsIndex = logged.argv.indexOf("--extensions");
    assert.notEqual(extensionsIndex, -1);
    assert.equal(logged.argv[extensionsIndex + 1], "");
    const mcpIndex = logged.argv.indexOf("--allowed-mcp-server-names");
    assert.notEqual(mcpIndex, -1);
    assert.equal(logged.argv[mcpIndex + 1], "__polycli_review_no_mcp__");
    assert.equal(logged.argv.includes("--policy"), false);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains copilot with exhaustive tool exclusion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "copilot-review-argv.jsonl");
  const fake = createFakeCopilotBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      COPILOT_CLI_BIN: fake.bin,
      COPILOT_ARGV_LOG: argLog,
      COPILOT_FIXED_REPLY: "COPILOT_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "copilot", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "COPILOT_REVIEW_OK");

    const logged = readJsonLine(argLog);
    const excludedIndex = logged.argv.indexOf("--excluded-tools");
    assert.notEqual(excludedIndex, -1);
    assert.match(logged.argv[excludedIndex + 1], /apply_patch/);
    assert.match(logged.argv[excludedIndex + 1], /ask_user/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains opencode with plan agent and deny-all config", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "opencode-review-argv.jsonl");
  const envLog = path.join(pluginData, "opencode-review-env.jsonl");
  const fake = createFakeOpenCodeBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      OPENCODE_CLI_BIN: fake.bin,
      OPENCODE_ARGV_LOG: argLog,
      OPENCODE_ENV_LOG: envLog,
      OPENCODE_FIXED_REPLY: "OPENCODE_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "opencode", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "OPENCODE_REVIEW_OK");

    const loggedArgs = readJsonLine(argLog);
    assert.match(loggedArgs.argv.join(" "), /--agent plan/);
    assert.equal(loggedArgs.argv.includes("--dangerously-skip-permissions"), false);

    const loggedEnv = readJsonLine(envLog);
    assert.deepEqual(JSON.parse(loggedEnv.OPENCODE_CONFIG_CONTENT), {
      "$schema": "https://opencode.ai/config.json",
      permission: "deny",
    });
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains pi with no-tools", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "pi-review-argv.jsonl");
  const fake = createFakePiBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      PI_CLI_BIN: fake.bin,
      PI_ARGV_LOG: argLog,
      PI_FIXED_REPLY: "PI_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "pi", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "PI_REVIEW_OK");

    const logged = readJsonLine(argLog);
    assert.match(logged.argv.join(" "), /--no-tools/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains minimax with a tool-disabled config override", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const envLog = path.join(pluginData, "minimax-review-env.jsonl");
  const configSnapshot = path.join(pluginData, "minimax-review-config.yaml");
  const fake = createFakeMiniMaxFixture();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      MINI_AGENT_BIN: fake.bin,
      MINI_AGENT_LOG_DIR: fake.logDir,
      MINI_AGENT_CONFIG_PATH: fake.configPath,
      MINI_AGENT_ENV_LOG: envLog,
      MINI_AGENT_CONFIG_SNAPSHOT: configSnapshot,
      MINI_AGENT_FIXED_REPLY: "MINIMAX_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "minimax", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: process.cwd(), env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "MINIMAX_REVIEW_OK");

    const loggedEnv = readJsonLine(envLog);
    assert.match(loggedEnv.MINI_AGENT_CONFIG_PATH, /polycli-review-minimax-config-/);
    const configText = fs.readFileSync(configSnapshot, "utf8");
    assert.match(configText, /enable_file_tools: false/);
    assert.match(configText, /enable_bash: false/);
    assert.match(configText, /enable_note: false/);
    assert.match(configText, /enable_skills: false/);
    assert.match(configText, /enable_mcp: false/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review surfaces auto-scope warnings when branch diff fallback fails", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-auto-"));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("git", ["init", "-b", "scratch"], { cwd: repoRoot });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git init exited ${code}`)));
      child.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      const child = spawn("git", ["config", "user.name", "Test User"], { cwd: repoRoot });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git config name exited ${code}`)));
      child.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      const child = spawn("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git config email exited ${code}`)));
      child.on("error", reject);
    });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n", "utf8");
    await new Promise((resolve, reject) => {
      const child = spawn("git", ["add", "README.md"], { cwd: repoRoot });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git add exited ${code}`)));
      child.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      const child = spawn("git", ["commit", "-m", "init"], { cwd: repoRoot });
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`git commit exited ${code}`)));
      child.on("error", reject);
    });

    const review = await runCompanion(
      ["review", "--provider", "qwen", "--json"],
      { cwd: repoRoot, env: cleanEnv() }
    );
    assert.equal(review.code, 0, review.stderr);

    const payload = JSON.parse(review.stdout);
    assert.equal(payload.verdict, "no_changes");
    assert.ok(Array.isArray(payload.warnings));
    assert.match(payload.warnings.join("\n"), /branch diff failed/i);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for minimax via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeMiniMaxFixture();
  try {
    const askPayload = await assertSetupAndAsk("minimax", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      MINI_AGENT_BIN: fake.bin,
      MINI_AGENT_LOG_DIR: fake.logDir,
      MINI_AGENT_CONFIG_PATH: fake.configPath,
    }));
    assert.equal(askPayload.timing.runtimePersistence, "ephemeral");
    assert.equal(askPayload.timing.metrics.ttft.status, "unsupported");
    assert.equal(askPayload.timing.metrics.gen.status, "unsupported");
    assert.equal(askPayload.timing.metrics.tail.status, "unsupported");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for claude via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const replay = createClaudeFixtureReplay("ask-ok");
  try {
    const askPayload = await assertSetupAndAsk("claude", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: replay.bin,
    }), "Reply with only: PONG");
    assert.equal(askPayload.response, replay.meta.expected.response);
    assert.equal(askPayload.sessionId, replay.meta.expected.sessionId);
    assert.equal(askPayload.model, replay.meta.expected.model);
    assert.equal(askPayload.timing.runtimePersistence, "session");
    assert.equal(askPayload.timing.metrics.ttft.status, "measured");
    assert.equal(askPayload.timing.metrics.gen.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.status, "measured");
    assert.equal(askPayload.timing.metrics.tool.status, "unsupported");
  } finally {
    replay.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for copilot via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeCopilotBin();
  try {
    const askPayload = await assertSetupAndAsk("copilot", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      COPILOT_CLI_BIN: fake.bin,
    }));
    assert.equal(askPayload.timing.runtimePersistence, "session");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for opencode via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeOpenCodeBin();
  try {
    const askPayload = await assertSetupAndAsk("opencode", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      OPENCODE_CLI_BIN: fake.bin,
    }));
    assert.equal(askPayload.timing.runtimePersistence, "session");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: setup and ask succeed for pi via bundled companion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakePiBin();
  try {
    const askPayload = await assertSetupAndAsk("pi", cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      PI_CLI_BIN: fake.bin,
    }));
    assert.equal(askPayload.timing.runtimePersistence, "session");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: qwen foreground ask records session, tool, and tail timing", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const ask = await runCompanion(
      ["ask", "--provider", "qwen", "--json", "__delay=25 __tool=1 __toolDelay=30 __tail=40 __reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const askPayload = JSON.parse(ask.stdout);
    assert.equal(askPayload.response, "PONG");
    assert.equal(askPayload.timing.runtimePersistence, "session");
    assert.equal(askPayload.timing.metrics.ttft.status, "measured");
    assert.equal(askPayload.timing.metrics.gen.status, "measured");
    assert.equal(askPayload.timing.metrics.tool.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.ms >= 20, true);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: rescue --background can be polled and fetched via result", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const start = await runCompanion(
      ["rescue", "--provider", "qwen", "--background", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.ok, true);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const parsed = JSON.parse(stored.stdout);
    assert.equal(parsed.job.jobId, started.job.jobId);
    assert.equal(parsed.response, "PONG");
    assert.equal(parsed.ok, true);
    assert.ok(parsed.timing);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: cancel stops an active background job", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const start = await runCompanion(
      ["rescue", "--provider", "qwen", "--background", "--json", "__delay=3000 __reply=LATE"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);

    const cancelled = await runCompanion(["cancel", "--json", started.job.jobId], {
      cwd: process.cwd(),
      env,
      timeout: 15_000,
    });
    assert.equal(cancelled.code, 0, cancelled.stderr);
    const cancelReport = JSON.parse(cancelled.stdout);
    assert.equal(cancelReport.cancelled, true);

    const status = await waitForTerminalJob(started.job.jobId, { cwd: process.cwd(), env });
    assert.equal(status.job.status, "cancelled");
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: timing command returns history and aggregate after a foreground ask", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const ask = await runCompanion(
      ["ask", "--provider", "qwen", "--json", "__reply=PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const askResult = JSON.parse(ask.stdout);
    assert.equal(askResult.response, "PONG");
    assert.ok(askResult.timing, "ask result should include timing");

    const timing = await runCompanion(["timing", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(timing.code, 0, timing.stderr);
    const payload = JSON.parse(timing.stdout);
    assert.ok(Array.isArray(payload.records));
    assert.ok(payload.records.length >= 1);
    assert.equal(payload.records[0].provider, "qwen");
    assert.equal(payload.aggregate.byProvider.qwen.recordCount >= 1, true);
    assert.equal(payload.aggregate.byProvider.qwen.runtimePersistenceCounts.session >= 1, true);
    assert.equal(payload.aggregate.byProvider.qwen.metrics.ttft.contributingCount >= 1, true);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});
