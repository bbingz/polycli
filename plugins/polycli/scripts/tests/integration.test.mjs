import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ensureStateDir,
  readLastUsedProvider,
  resolveJobLogFile,
  resolveWorkspaceRoot,
  upsertJob,
  writeJobConfigFile,
} from "../lib/state.mjs";
import { appendRunLedgerEvent, readRunLedgerEvents } from "../lib/run-ledger.mjs";

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
const prompt = args.find((arg) => /__reply=|Return exactly|regressions only|POLYCLI_FIXTURE_OK/.test(arg)) || args.at(-1) || "";
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
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : Number.parseInt(process.env.KIMI_DELAY_MS || "0", 10);
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.KIMI_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
const returnSession = process.env.KIMI_RETURN_SESSION || "session_33333333-3333-4333-8333-333333333333";
(async () => {
  logEvent("start");
  if (delay > 0) await sleep(delay);
  if (process.env.KIMI_CONTENT_MODE === "string") {
    process.stdout.write(JSON.stringify({ role: "assistant", content: reply, model: "kimi-test" }) + "\\n");
  } else if (process.env.KIMI_EMIT_THINKING === "1") {
    process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "think", think: "thinking before final" }, { type: "text", text: reply }], model: "kimi-test" }) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "text", text: reply }], model: "kimi-test" }) + "\\n");
  }
  // kimi-code emits the session id structurally in a resume_hint meta event (session_<uuid>).
  process.stdout.write(JSON.stringify({ role: "meta", type: "session.resume_hint", session_id: returnSession, command: "kimi -r " + returnSession }) + "\\n");
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
  const bin = path.join(root, "mmx");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("mmx 0.0.0-test\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ authenticated: true, model: "MiniMax-M2.7-test" }) + "\\n");
  process.exit(0);
}
if (process.env.MMX_ENV_LOG) {
  fs.writeFileSync(process.env.MMX_ENV_LOG, JSON.stringify({
    argv: args,
  }) + "\\n");
}
const prompt = args[args.indexOf("--message") + 1] || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.MMX_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
process.stdout.write(JSON.stringify({
  model: "MiniMax-M2.7-test",
  choices: [{ message: { content: reply }, finish_reason: "stop" }]
}) + "\\n");
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
if (args[0] === "auth" && args[1] === "status") {
  const loggedIn = process.env.CLAUDE_AUTH_LOGGED_IN !== "0";
  process.stdout.write(JSON.stringify({ loggedIn, model: "claude-test" }) + "\\n");
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

function createFakeTmuxBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-tmux-"));
  const bin = path.join(root, "tmux");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
if (process.env.TMUX_ARGV_LOG) {
  fs.appendFileSync(process.env.TMUX_ARGV_LOG, JSON.stringify({ argv: args, stdin }) + "\\n");
}
if (args[0] === "capture-pane") {
  process.stdout.write(process.env.TMUX_CAPTURE_TEXT || "Claude Code\\npaste again to expand\\n");
}
process.exit(Number.parseInt(process.env.TMUX_EXIT_CODE || "0", 10));
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
    PATH: process.env.PATH || null,
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

function createFakeAgyBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-agy-"));
  const bin = path.join(root, "agy");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("Usage: agy [options]\\n");
  process.exit(0);
}
if (process.env.AGY_ARGV_LOG) {
  fs.writeFileSync(process.env.AGY_ARGV_LOG, JSON.stringify({ argv: args }) + "\\n");
}
const prompt = args[args.indexOf("-p") + 1] || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = process.env.AGY_FIXED_REPLY || (replyMatch ? replyMatch[1] : prompt);
process.stdout.write(reply + "\\n");
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

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function gitSync(cwd, args) {
  const result = spawnSync("git", args, { cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function createReviewWorkspace() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-review-cwd-")));
  gitInitSync(cwd);
  fs.writeFileSync(path.join(cwd, "review.txt"), "before\n", "utf8");
  gitSync(cwd, ["add", "review.txt"]);
  gitSync(cwd, ["commit", "-m", "base"]);
  fs.writeFileSync(path.join(cwd, "review.txt"), "before\nafter\n", "utf8");
  gitSync(cwd, ["add", "review.txt"]);
  gitSync(cwd, ["commit", "-m", "change"]);
  return {
    cwd,
    cleanup() {
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
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
  if (provider === "agy") {
    assert.equal(askPayload.model, null);
  } else {
    assert.ok(
      askPayload.model && typeof askPayload.model === "string" && askPayload.model.length > 0,
      `${provider} ask result should include model`
    );
  }
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

test("integration: health preserves PATH when prompt constraints inject provider env", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeOpenCodeBin();
  const envLog = path.join(pluginData, "opencode-health-env.jsonl");
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      OPENCODE_FIXED_REPLY: "POLYCLI_HEALTH_OK",
      OPENCODE_ENV_LOG: envLog,
      PATH: `${fake.root}${path.delimiter}${process.env.PATH || ""}`,
    });
    const health = await runCompanion(["health", "--json", "--provider", "opencode"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 0, health.stderr);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.healthyProviders, ["opencode"]);
    const report = payload.results[0];
    assert.equal(report.probe.responseMatched, true);

    const loggedEnv = readJsonLine(envLog);
    assert.ok(loggedEnv.OPENCODE_CONFIG_CONTENT, "opencode prompt constraints should still inject config");
    assert.match(loggedEnv.PATH, new RegExp(fake.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health verifies claude with auth status without a prompt run", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeClaudeBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: fake.bin,
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
    assert.equal(report.loggedIn, true);
    assert.equal(report.authDetail, "authenticated");
    assert.equal(report.model, "claude-test");
    assert.equal(report.probe.ok, true);
    assert.equal(report.probe.kind, "auth_status");
    assert.equal(report.probe.authOnly, true);
    assert.equal(report.probe.responseMatched, true);
    assert.equal(report.probe.responsePreview, "authenticated");
    assert.equal(report.probe.timing, null);

    const timing = await runCompanion(["timing", "--json", "--provider", "claude", "--history", "1"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(timing.code, 0, timing.stderr);
    const timingPayload = JSON.parse(timing.stdout);
    assert.equal(timingPayload.records.length, 0);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: health reports claude auth status logout as unhealthy", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeClaudeBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: fake.bin,
      CLAUDE_AUTH_LOGGED_IN: "0",
    });
    const health = await runCompanion(["health", "--json", "--provider", "claude"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(health.code, 2);
    const payload = JSON.parse(health.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.anyHealthy, false);
    assert.equal(payload.allHealthy, false);
    assert.deepEqual(payload.healthyProviders, []);
    assert.deepEqual(payload.unhealthyProviders, ["claude"]);
    assert.equal(payload.results.length, 1);
    const report = payload.results[0];
    assert.equal(report.provider, "claude");
    assert.equal(report.available, true);
    assert.equal(report.loggedIn, false);
    assert.equal(report.authDetail, "not authenticated");
    assert.equal(report.probe.ok, false);
    assert.equal(report.probe.kind, "auth_status");
    assert.equal(report.probe.authOnly, true);
    assert.equal(report.probe.responseMatched, false);
    assert.equal(report.probe.error, "not authenticated");
    assert.equal(report.probe.timing, null);
  } finally {
    fake.cleanup();
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
      AGY_CLI_BIN: missingBin,
      CMD_CLI_BIN: missingBin,
      COPILOT_CLI_BIN: missingBin,
      GEMINI_CLI_BIN: missingBin,
      GROK_CLI_BIN: missingBin,
      KIMI_CLI_BIN: fakeKimi.bin,
      MMX_CLI_BIN: missingBin,
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
    assert.deepEqual(payload.unhealthyProviders.sort(), ["agy", "claude", "cmd", "copilot", "gemini", "grok", "kimi", "minimax", "opencode", "pi"].sort());
    assert.equal(payload.results.length, 11);
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
      AGY_CLI_BIN: missingBin,
      CMD_CLI_BIN: missingBin,
      COPILOT_CLI_BIN: missingBin,
      GEMINI_CLI_BIN: missingBin,
      GROK_CLI_BIN: missingBin,
      KIMI_CLI_BIN: fakeKimi.bin,
      MMX_CLI_BIN: missingBin,
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
    assert.doesNotMatch(argv, /--max-session-turns 1/);
    assert.match(argv, /--max-session-turns 20/);
    assert.match(argv, /--approval-mode plan/);
    assert.match(argv, /--exclude-tools/);
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
    const env = cleanEnv({
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PLUGIN_DATA: pluginData,
      KIMI_CLI_BIN: fake.bin,
      KIMI_ARGV_LOG: argLog,
      KIMI_FIXED_REPLY: "KIMI_FLAGS_OK",
    });

    // kimi-code resolves resume itself: --resume-last -> -C (continue last for this cwd).
    const resumeLast = await runCompanion(
      ["ask", "--provider", "kimi", "--resume-last", "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(resumeLast.code, 0, resumeLast.stderr);
    let logged = readJsonLine(argLog);
    assert.equal(logged.argv.includes("-C"), true);
    assert.equal(logged.argv.includes("--session"), false);

    // --resume <id> -> --session <id> passed straight through to the CLI.
    const explicitResume = await runCompanion(
      ["rescue", "--provider", "kimi", "--resume", sessionId, "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(explicitResume.code, 0, explicitResume.stderr);
    logged = readJsonLine(argLog);
    assert.deepEqual(logged.argv.slice(logged.argv.indexOf("--session"), logged.argv.indexOf("--session") + 2), ["--session", sessionId]);

    const fresh = await runCompanion(
      ["ask", "--provider", "kimi", "--fresh", "--json", "__reply=IGNORED"],
      { cwd, env }
    );
    assert.equal(fresh.code, 0, fresh.stderr);
    logged = readJsonLine(argLog);
    assert.equal(logged.argv.includes("--session"), false);
    assert.equal(logged.argv.includes("-C"), false);
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
    // kimi-code one-shot invocation; the removed --no-thinking/--max-steps-per-turn flags must NOT reappear.
    assert.match(argv, /-p /);
    assert.match(argv, /--output-format stream-json/);
    assert.doesNotMatch(argv, /--no-thinking|--max-steps-per-turn/);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains kimi to one non-thinking turn", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "REVIEW_OK");

    const logged = JSON.parse(fs.readFileSync(argLog, "utf8").trim());
    assert.match(logged.argv.join(" "), /--output-format stream-json/);
    // Check the legacy flags as discrete argv tokens, NOT as substrings of the joined string:
    // the reviewed diff is embedded inside the single `-p <prompt>` element and can legitimately
    // mention `--no-thinking`/`--max-steps-per-turn` as removed-code text (e.g. this very migration).
    assert.ok(
      !logged.argv.includes("--no-thinking") && !logged.argv.includes("--max-steps-per-turn"),
      `kimi review must not pass legacy python kimi-cli flags as arguments; argv: ${logged.argv.join(" ")}`
    );
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review --background preserves kimi runtime options and stored response", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.ok, true);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: reviewWorkspace.cwd, env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: reviewWorkspace.cwd,
      env,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.response, "BACKGROUND_KIMI_OK");
    assert.equal(payload.job.jobId, started.job.jobId);

    const logged = JSON.parse(fs.readFileSync(argLog, "utf8").trim());
    assert.match(logged.argv.join(" "), /--output-format stream-json/);
    // Check the legacy flags as discrete argv tokens, NOT as substrings of the joined string:
    // the reviewed diff is embedded inside the single `-p <prompt>` element and can legitimately
    // mention `--no-thinking`/`--max-steps-per-turn` as removed-code text (e.g. this very migration).
    assert.ok(
      !logged.argv.includes("--no-thinking") && !logged.argv.includes("--max-steps-per-turn"),
      `kimi review must not pass legacy python kimi-cli flags as arguments; argv: ${logged.argv.join(" ")}`
    );
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review --background preserves qwen runtime options and stored response", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.ok, true);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: reviewWorkspace.cwd, env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: reviewWorkspace.cwd,
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
    assert.doesNotMatch(argv, /--max-session-turns 1/);
    assert.match(argv, /--append-system-prompt/);
    assert.match(argv, /--exclude-tools/);
    const promptIndex = logged.argv.findIndex((arg) => arg.includes("regressions only"));
    assert.equal(promptIndex >= 0, true);
    assert.equal(logged.argv.indexOf("--exclude-tools") > promptIndex, true);

    const logText = fs.readFileSync(started.job.logFile, "utf8");
    const occurrences = (logText.match(/BACKGROUND_QWEN_OK/g) || []).length;
    assert.equal(occurrences, 1);
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: qwen result-only review still records timing text and preview", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: reviewWorkspace.cwd, env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: reviewWorkspace.cwd,
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
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: kimi string-content review still records preview text", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(start.code, 0, start.stderr);
    const started = JSON.parse(start.stdout);

    const finalStatus = await waitForTerminalJob(started.job.jobId, { cwd: reviewWorkspace.cwd, env });
    assert.equal(finalStatus.job.status, "completed");

    const stored = await runCompanion(["result", "--json", started.job.jobId], {
      cwd: reviewWorkspace.cwd,
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
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review runs claude print mode with no tools", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "CLAUDE_REVIEW_OK");
    assert.equal(payload.detached, undefined);
    assert.equal(payload.responseKind, undefined);
    assert.equal((payload.timing.meta || {}).tmuxDetached, undefined);

    const logged = readJsonLines(argLog);
    const args = logged[0].argv;
    assert.equal(args[0], "-p");
    assert.match(args[1], /regressions only/);
    assert.match(args[1], /Git diff:/);
    assert.deepEqual(args.slice(2, 5), ["--output-format", "stream-json", "--verbose"]);
    assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args[args.indexOf("--mcp-config") + 1], "{\"mcpServers\":{}}");
    assert.equal(args.includes("--strict-mcp-config"), true);
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: _job-worker preserves explicit claude tmux TUI runtime path", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-explicit-tmux-cwd-")));
  const fakeTmux = createFakeTmuxBin();
  const tmuxLog = path.join(pluginData, "explicit-tmux.jsonl");
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  try {
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
    });
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const jobId = "pv-explicit-tmux";
    const now = new Date().toISOString();
    const logFile = resolveJobLogFile(workspaceRoot, jobId);
    upsertJob(workspaceRoot, {
      jobId,
      workspaceRoot,
      provider: "claude",
      kind: "ask",
      model: null,
      defaultModel: null,
      status: "running",
      promptPreview: "explicit tmux",
      logFile,
      createdAt: now,
      updatedAt: now,
      sessionId: null,
      pid: null,
    });
    fs.writeFileSync(logFile, `[${now}] started claude ask\n`, "utf8");
    const configFile = writeJobConfigFile(workspaceRoot, jobId, {
      workspaceRoot,
      jobId,
      runContext: null,
      execution: {
        provider: "claude",
        kind: "ask",
        prompt: "explicit tmux prompt",
        userPrompt: "explicit tmux prompt",
        model: null,
        defaultModel: null,
        cwd,
        timeout: 2_000,
        measurementScope: "job",
        meta: { background: true, jobId },
        jobMeta: {},
        runtimeOptions: {
          executionMode: "tmux-tui",
          bin: "/usr/bin/false",
          tmuxBin: fakeTmux.bin,
          tmuxSessionName: "polycli-explicit-tmux",
          permissionMode: "plan",
          extraArgs: ["--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config"],
          env: { TMUX_ARGV_LOG: tmuxLog },
        },
      },
    });

    const worker = await runCompanion(["_job-worker", configFile], { cwd, env, timeout: 5_000 });
    assert.equal(worker.code, 0, worker.stderr);

    const stored = await runCompanion(["result", "--json", jobId], { cwd, env });
    assert.equal(stored.code, 0, stored.stderr);
    const payload = JSON.parse(stored.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.detached, true);
    assert.equal(payload.responseKind, "tmux_tui_session_started");
    assert.equal((payload.timing.meta || {}).tmuxDetached, true);
    assert.equal(payload.timing.metrics.ttft.status, "unsupported");
    assert.equal(payload.timing.metrics.gen.status, "unsupported");
    assert.equal(payload.timing.metrics.tail.status, "unsupported");

    const commands = readJsonLines(tmuxLog).map((entry) => entry.argv);
    assert.deepEqual(commands[0].slice(0, 4), ["new-session", "-d", "-s", "polycli-explicit-tmux"]);
    assert.equal(commands.some((argv) => argv[0] === "load-buffer"), true);
    assert.equal(commands.some((argv) => argv[0] === "paste-buffer"), true);
  } finally {
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fakeTmux.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("integration: review constrains gemini with isolated cwd and disabled extensions/mcp", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
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
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains copilot with exhaustive tool exclusion", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
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
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains opencode with plan agent and deny-all config", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
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
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review constrains pi with no-tools", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
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
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "PI_REVIEW_OK");

    const logged = readJsonLine(argLog);
    assert.match(logged.argv.join(" "), /--no-tools/);
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: review uses mmx text chat for minimax without legacy mini-agent config", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const reviewWorkspace = createReviewWorkspace();
  const envLog = path.join(pluginData, "minimax-review-env.jsonl");
  const fake = createFakeMiniMaxFixture();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      MMX_CLI_BIN: fake.bin,
      MMX_ENV_LOG: envLog,
      MMX_FIXED_REPLY: "MINIMAX_REVIEW_OK",
    });
    const review = await runCompanion(
      ["review", "--provider", "minimax", "--base", "HEAD~1", "--scope", "branch", "--json", "regressions only"],
      { cwd: reviewWorkspace.cwd, env }
    );
    assert.equal(review.code, 0, review.stderr);
    const payload = JSON.parse(review.stdout);
    assert.equal(payload.response, "MINIMAX_REVIEW_OK");

    const loggedEnv = readJsonLine(envLog);
    assert.deepEqual(loggedEnv.argv.slice(0, 6), ["text", "chat", "--message", loggedEnv.argv[3], "--output", "json"]);
    assert.equal(loggedEnv.argv.includes("--non-interactive"), true);
    assert.equal(loggedEnv.argv.includes("-t"), false);
  } finally {
    fake.cleanup();
    reviewWorkspace.cleanup();
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
      MMX_CLI_BIN: fake.bin,
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

test("integration: setup succeeds and claude ask returns a print-mode answer", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const argLog = path.join(pluginData, "claude-ask-argv.jsonl");
  const fake = createFakeClaudeBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CLI_BIN: fake.bin,
      CLAUDE_ARGV_LOG: argLog,
      CLAUDE_FIXED_REPLY: "PONG",
    });
    const setup = await runCompanion(["setup", "--json", "--provider", "claude"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(setup.code, 0, setup.stderr);
    const setupPayload = JSON.parse(setup.stdout);
    assert.equal(setupPayload[0].loggedIn, true);
    assert.equal(setupPayload[0].model, "claude-test");

    const ask = await runCompanion(
      ["ask", "--provider", "claude", "--json", "Reply with only: PONG"],
      { cwd: process.cwd(), env }
    );
    assert.equal(ask.code, 0, ask.stderr);
    const askPayload = JSON.parse(ask.stdout);
    assert.equal(askPayload.provider, "claude");
    assert.equal(askPayload.response, "PONG");
    assert.equal(askPayload.model, "claude-test");
    assert.equal(askPayload.sessionId, "44444444-4444-4444-8444-444444444444");
    assert.equal(askPayload.detached, undefined);
    assert.equal(askPayload.responseKind, undefined);
    assert.equal(askPayload.timing.runtimePersistence, "session");
    assert.equal(askPayload.timing.metrics.ttft.status, "measured");
    assert.equal(askPayload.timing.metrics.gen.status, "measured");
    assert.equal(askPayload.timing.metrics.tail.status, "measured");
    assert.equal(askPayload.timing.metrics.tool.status, "unsupported");
    assert.equal((askPayload.timing.meta || {}).tmuxDetached, undefined);

    const logged = readJsonLines(argLog);
    const args = logged[0].argv;
    assert.equal(args[0], "-p");
    assert.equal(args[1], "Reply with only: PONG");
    assert.deepEqual(args.slice(2, 5), ["--output-format", "stream-json", "--verbose"]);
    assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args[args.indexOf("--mcp-config") + 1], "{\"mcpServers\":{}}");
    assert.equal(args.includes("--strict-mcp-config"), true);
  } finally {
    fake.cleanup();
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

test("integration: status --all --wait waits for every active job and returns a snapshot", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const slow = await runCompanion(
      ["rescue", "--provider", "qwen", "--background", "--json", "__delay=700 __reply=SLOW_DONE"],
      { cwd: process.cwd(), env }
    );
    assert.equal(slow.code, 0, slow.stderr);
    const slowJob = JSON.parse(slow.stdout).job;

    const fast = await runCompanion(
      ["rescue", "--provider", "qwen", "--background", "--json", "__delay=10 __reply=FAST_DONE"],
      { cwd: process.cwd(), env }
    );
    assert.equal(fast.code, 0, fast.stderr);
    const fastJob = JSON.parse(fast.stdout).job;

    const waited = await runCompanion(["status", "--all", "--wait", "--timeout-ms", "10000", "--json"], {
      cwd: process.cwd(),
      env,
      timeout: 15_000,
    });
    assert.equal(waited.code, 0, waited.stderr);
    const payload = JSON.parse(waited.stdout);
    assert.equal(payload.waitTimedOut, false);
    assert.equal(payload.totalJobs, 2);
    assert.deepEqual(payload.running, []);
    assert.deepEqual(
      [...payload.recent].map((job) => [job.jobId, job.status]).sort(),
      [
        [slowJob.jobId, "completed"],
        [fastJob.jobId, "completed"],
      ].sort()
    );
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: status --all --wait reports timeout in json and text modes", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const fake = createFakeQwenBin();
  try {
    const env = cleanEnv({
      CLAUDE_PLUGIN_DATA: pluginData,
      QWEN_CLI_BIN: fake.bin,
    });
    const start = await runCompanion(
      ["rescue", "--provider", "qwen", "--background", "--json", "__delay=3000 __reply=SLOW_DONE"],
      { cwd: process.cwd(), env }
    );
    assert.equal(start.code, 0, start.stderr);
    const job = JSON.parse(start.stdout).job;

    const jsonWait = await runCompanion(["status", "--all", "--wait", "--timeout-ms", "1", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(jsonWait.code, 2, jsonWait.stdout);
    const payload = JSON.parse(jsonWait.stdout);
    assert.equal(payload.waitTimedOut, true);
    assert.equal(payload.running.some((running) => running.jobId === job.jobId), true);

    const textWait = await runCompanion(["status", "--all", "--wait", "--timeout-ms", "1"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(textWait.code, 2, textWait.stdout);
    assert.match(textWait.stdout, /Timed out waiting for all jobs\./);

    const singleWait = await runCompanion(["status", job.jobId, "--wait", "--timeout-ms", "1", "--json"], {
      cwd: process.cwd(),
      env,
    });
    assert.equal(singleWait.code, 2, singleWait.stdout);
    const singlePayload = JSON.parse(singleWait.stdout);
    assert.equal(singlePayload.waitTimedOut, true);
    assert.equal(singlePayload.job.jobId, job.jobId);

    const cancel = await runCompanion(["cancel", "--json", job.jobId], { cwd: process.cwd(), env });
    assert.equal(cancel.code, 0, cancel.stderr);
  } finally {
    fake.cleanup();
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
});

test("integration: status --wait rejects invalid timeout values", async () => {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  try {
    const invalidWithoutWait = await runCompanion(["status", "--all", "--timeout-ms", "abc", "--json"], {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    });
    assert.equal(invalidWithoutWait.code, 0, invalidWithoutWait.stderr);

    const invalidAll = await runCompanion(["status", "--all", "--wait", "--timeout-ms", "abc", "--json"], {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    });
    assert.equal(invalidAll.code, 1);
    assert.match(JSON.parse(invalidAll.stdout).error, /--timeout-ms must be a positive integer/);

    const invalidSingle = await runCompanion(["status", "pv-missing", "--wait", "--timeout-ms", "abc", "--json"], {
      cwd: process.cwd(),
      env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData }),
    });
    assert.equal(invalidSingle.code, 1);
    assert.match(JSON.parse(invalidSingle.stdout).error, /--timeout-ms must be a positive integer/);
  } finally {
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

function createFakeCmdBin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-cmd-"));
  const bin = path.join(root, "cmd");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("cmd 0.0.0-test\\n");
  process.exit(0);
}
if (args[0] === "status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
const promptIdx = args.indexOf("-p");
const prompt = promptIdx >= 0 ? String(args[promptIdx + 1] || "") : "";
if (prompt.includes("POLYCLI_HEALTH_OK")) {
  process.stdout.write("POLYCLI_HEALTH_OK\\n");
  process.exit(0);
}
process.exit(0);
`,
    { mode: 0o755 },
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return bin;
}

function createLedgerContext(t, extraEnv = {}) {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-ledger-cwd-")));
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  t.after(() => {
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    pluginData,
    env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData, CMD_CLI_BIN: createFakeCmdBin(t), ...extraEnv }),
  };
}

function gitInitSync(cwd) {
  for (const args of [
    ["init", "-b", "scratch"],
    ["config", "user.name", "Test User"],
    ["config", "user.email", "test@example.com"],
  ]) {
    gitSync(cwd, args);
  }
}

test("integration: health strips run-id before provider resolution and writes ledger events", async (t) => {
  const context = createLedgerContext(t);
  const result = await runCompanion(
    ["health", "--provider", "cmd", "--json", "--run-id=run-test"],
    context,
  );
  assert.equal(result.code, 0, result.stderr);
  const events = await readRunLedgerEvents(context.cwd);
  assert.ok(
    events.some((event) => event.runId === "run-test" && event.phase === "health_result"),
    `expected health_result event for run-test; got ${JSON.stringify(events)}`,
  );
  assert.ok(
    events.every((event) => event.provider !== "--run-id=run-test"),
    "run-id must be stripped before provider resolution",
  );
});

test("integration: ask writes failed provider decisions for unusable provider output", async (t) => {
  const context = createLedgerContext(t);
  await runCompanion(
    ["ask", "--provider", "cmd", "--json", "Return exactly POLYCLI_FIXTURE_OK", "--run-id", "run-cmd"],
    context,
  );
  await runCompanion(
    ["ask", "--provider", "cmd", "--json", "Return exactly POLYCLI_FIXTURE_OK", "--run-id", "run-cmd"],
    context,
  );
  const events = await readRunLedgerEvents(context.cwd);
  const failures = events.filter(
    (event) =>
      event.runId === "run-cmd" &&
      event.phase === "provider_decision" &&
      event.status === "failed",
  );
  assert.equal(failures.length, 2, `expected 2 failed provider decisions; got ${failures.length}`);
});

test("integration: review with no changes writes no_changes skipped decision", async (t) => {
  const context = createLedgerContext(t);
  gitInitSync(context.cwd);
  const result = await runCompanion(
    ["review", "--provider", "cmd", "--json", "--run-id", "run-clean"],
    context,
  );
  assert.equal(result.code, 0, result.stderr);
  const events = await readRunLedgerEvents(context.cwd);
  assert.ok(
    events.some(
      (event) =>
        event.runId === "run-clean" &&
        event.phase === "provider_decision" &&
        event.status === "skipped" &&
        event.reason === "no_changes",
    ),
    `expected no_changes skipped decision for run-clean; got ${JSON.stringify(events)}`,
  );
});

test("integration: gemini no-changes review cleans up isolated cwd", async (t) => {
  const context = createLedgerContext(t);
  const fake = createFakeGeminiBin();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-gemini-clean-review-"));
  gitInitSync(context.cwd);
  try {
    const result = await runCompanion(
      ["review", "--provider", "gemini", "--json", "--run-id", "run-clean-gemini"],
      {
        ...context,
        env: cleanEnv({
          ...context.env,
          GEMINI_CLI_BIN: fake.bin,
          TMPDIR: tmpRoot,
        }),
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const leftovers = fs.readdirSync(tmpRoot).filter((entry) => entry.startsWith("polycli-review-gemini-cwd-"));
    assert.deepEqual(leftovers, []);
  } finally {
    fake.cleanup();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("integration: debug runs returns summarized ledger runs", async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, {
    runId: "run-debug",
    command: "health",
    commands: ["health"],
    phase: "run_started",
    status: "started",
    hostSurface: "terminal",
  });
  await appendRunLedgerEvent(context.cwd, {
    runId: "run-debug",
    command: "health",
    commands: ["health"],
    phase: "provider_decision",
    provider: "pi",
    status: "skipped",
    reason: "health_failed",
    hostSurface: "terminal",
  });
  const result = await runCompanion(["debug", "runs", "--json"], context);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.runs[0].runId, "run-debug");
  assert.deepEqual(json.runs[0].commands, ["health"]);
});

test("integration: debug show returns raw events for a run", async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, {
    runId: "run-show",
    command: "ask",
    commands: ["ask"],
    phase: "provider_decision",
    provider: "cmd",
    status: "failed",
    reason: "ask_failed",
    hostSurface: "terminal",
  });
  const result = await runCompanion(["debug", "show", "run-show", "--json"], context);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.runId, "run-show");
  assert.equal(json.events[0].provider, "cmd");
});

test("integration: debug explain returns provider decisions", async (t) => {
  const context = createLedgerContext(t);
  await appendRunLedgerEvent(context.cwd, {
    runId: "run-explain",
    command: "ask",
    commands: ["ask"],
    phase: "provider_decision",
    provider: "qwen",
    status: "adopted",
    hostSurface: "terminal",
  });
  const result = await runCompanion(["debug", "explain", "run-explain", "--json"], context);
  assert.equal(result.code, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.found, true);
  assert.match(json.text, /qwen adopted/);
});

test("integration: sessions list and purge wire through companion argv and recorded ledger paths", async (t) => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-home-")));
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-sessions-state-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-sessions-cwd-")));
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const env = cleanEnv({ HOME: home, CLAUDE_PLUGIN_DATA: pluginData });
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const artifactDir = path.join(home, ".claude", "projects", cwd.replaceAll("/", "-"));
  const artifact = path.join(artifactDir, `${sessionId}.jsonl`);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(artifact, "{}\n", "utf8");

  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    await appendRunLedgerEvent(cwd, {
      runId: "run-sessions",
      command: "ask",
      phase: "attempt_result",
      provider: "claude",
      status: "completed",
      sessionId,
      sessionArtifactPath: artifact,
      hostSurface: "terminal",
    });
    await appendRunLedgerEvent(cwd, {
      runId: "run-sessions",
      command: "ask",
      phase: "attempt_result",
      provider: "gemini",
      status: "completed",
      sessionId: "gemini-session",
      sessionArtifactPath: null,
      hostSurface: "terminal",
    });
  } finally {
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
  }

  const list = await runCompanion(["sessions", "list", "--json"], { cwd, env });
  assert.equal(list.code, 0, list.stderr);
  const listed = JSON.parse(list.stdout);
  assert.equal(listed.recorded.length, 1);
  assert.equal(listed.recorded[0].sessionArtifactPath, artifact);
  assert.equal(listed.nonPurgeable.length, 1);
  assert.equal(listed.nonPurgeable[0].provider, "gemini");

  const dryRun = await runCompanion(["sessions", "purge", "--json"], { cwd, env });
  assert.equal(dryRun.code, 0, dryRun.stderr);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.confirmed, false);
  assert.equal(dryPayload.plan.deletable.length, 1);
  assert.equal(fs.existsSync(artifact), true);

  const confirm = await runCompanion(["sessions", "purge", "--confirm", "--json"], { cwd, env });
  assert.equal(confirm.code, 0, confirm.stderr);
  const confirmPayload = JSON.parse(confirm.stdout);
  assert.equal(confirmPayload.confirmed, true);
  assert.equal(confirmPayload.summary.deleted, 1);
  assert.equal(fs.existsSync(artifact), false);
});

function createBackgroundLedgerContext(t, extraEnv = {}) {
  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-plugin-data-"));
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-bg-ledger-cwd-")));
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  t.after(() => {
    if (previousPluginData == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    fs.rmSync(pluginData, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    pluginData,
    env: cleanEnv({ CLAUDE_PLUGIN_DATA: pluginData, ...extraEnv }),
  };
}

async function waitForLedgerPhase(workspaceRoot, runId, phase, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastEvents = [];
  while (Date.now() < deadline) {
    lastEvents = await readRunLedgerEvents(workspaceRoot);
    if (lastEvents.some((event) => event.runId === runId && event.phase === phase)) {
      return lastEvents;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `ledger did not record phase=${phase} for runId=${runId} within ${timeoutMs}ms; events=${JSON.stringify(lastEvents)}`,
  );
}

test("integration: background rescue with --run-id writes job_started + attempt_started + attempt_result + provider_decision adopted", async (t) => {
  const fake = createFakeQwenBin();
  t.after(() => fake.cleanup());
  const context = createBackgroundLedgerContext(t, {
    QWEN_CLI_BIN: fake.bin,
    QWEN_FIXED_REPLY: "BG_RUN_OK",
  });
  const start = await runCompanion(
    ["rescue", "--provider", "qwen", "--background", "--json", "--run-id", "run-bg-success", "__reply=BG_RUN_OK"],
    context,
  );
  assert.equal(start.code, 0, start.stderr);
  const started = JSON.parse(start.stdout);
  const finalStatus = await waitForTerminalJob(started.job.jobId, context);
  assert.equal(finalStatus.job.status, "completed");

  const events = (await waitForLedgerPhase(context.cwd, "run-bg-success", "provider_decision"))
    .filter((event) => event.runId === "run-bg-success");
  const phaseCounts = events.reduce((acc, event) => {
    acc[event.phase] = (acc[event.phase] || 0) + 1;
    return acc;
  }, {});
  assert.equal(phaseCounts.job_started, 1, `expected one job_started; got ${JSON.stringify(phaseCounts)}\nevents=${JSON.stringify(events, null, 2)}`);
  assert.equal(phaseCounts.attempt_started, 1, `expected one worker attempt_started; got ${JSON.stringify(phaseCounts)}`);
  assert.equal(phaseCounts.attempt_result, 1, `expected one worker attempt_result; got ${JSON.stringify(phaseCounts)}`);
  const decisions = events.filter((event) => event.phase === "provider_decision");
  assert.equal(decisions.length, 1, `expected one provider_decision; got ${decisions.length}`);
  assert.equal(decisions[0].status, "adopted");

  const runStarted = events.find((event) => event.phase === "run_started");
  const parentHostSurface = runStarted?.hostSurface;
  const workerEvents = events.filter((event) =>
    ["job_started", "attempt_started", "attempt_result", "provider_decision"].includes(event.phase),
  );
  for (const event of workerEvents) {
    assert.equal(event.jobId, started.job.jobId, `event ${event.phase} jobId mismatch`);
    assert.equal(event.hostSurface, parentHostSurface, `event ${event.phase} should match parent hostSurface`);
  }
});

test("integration: background ask failure writes attempt_result failed + provider_decision failed without full prompt", async (t) => {
  const context = createBackgroundLedgerContext(t, {
    CMD_CLI_BIN: createFakeCmdBin(t),
  });
  const userPrompt = "Return exactly POLYCLI_FIXTURE_OK_with_unique_marker_123";
  const start = await runCompanion(
    ["ask", "--provider", "cmd", "--background", "--json", "--run-id", "run-bg-failed", userPrompt],
    context,
  );
  assert.equal(start.code, 0, start.stderr);
  const started = JSON.parse(start.stdout);
  const finalStatus = await waitForTerminalJob(started.job.jobId, context);
  assert.equal(finalStatus.job.status, "failed");

  const events = (await waitForLedgerPhase(context.cwd, "run-bg-failed", "provider_decision"))
    .filter((event) => event.runId === "run-bg-failed");
  const attemptResult = events.find((event) => event.phase === "attempt_result");
  assert.ok(attemptResult, `expected attempt_result; got ${JSON.stringify(events, null, 2)}`);
  assert.equal(attemptResult.status, "failed");
  const decision = events.find((event) => event.phase === "provider_decision");
  assert.ok(decision, "expected provider_decision");
  assert.equal(decision.status, "failed");
  assert.equal(decision.reason, "ask_failed");

  const serialized = JSON.stringify(events);
  assert.equal(
    serialized.includes(userPrompt),
    false,
    "ledger events must not contain the full user prompt",
  );
});

test("integration: background worker preserves explicit POLYCLI_HOST_SURFACE", async (t) => {
  const fake = createFakeQwenBin();
  t.after(() => fake.cleanup());
  const context = createBackgroundLedgerContext(t, {
    QWEN_CLI_BIN: fake.bin,
    QWEN_FIXED_REPLY: "HOST_SURFACE_OK",
    POLYCLI_HOST_SURFACE: "codex-skill",
  });
  const start = await runCompanion(
    ["ask", "--provider", "qwen", "--background", "--json", "--run-id", "run-bg-host", "__reply=HOST_SURFACE_OK"],
    context,
  );
  assert.equal(start.code, 0, start.stderr);
  const started = JSON.parse(start.stdout);
  const finalStatus = await waitForTerminalJob(started.job.jobId, context);
  assert.equal(finalStatus.job.status, "completed");

  const workerPhases = ["job_started", "attempt_started", "attempt_result", "provider_decision"];
  const events = (await waitForLedgerPhase(context.cwd, "run-bg-host", "provider_decision"))
    .filter((event) => event.runId === "run-bg-host" && workerPhases.includes(event.phase));
  assert.ok(events.length >= 4, `expected at least 4 worker events; got ${events.length}`);
  for (const event of events) {
    assert.equal(event.hostSurface, "codex-skill", `event ${event.phase} hostSurface should be codex-skill`);
  }
});

test("integration: debug show recovers ledger terminal events for a dead background worker", async (t) => {
  const context = createBackgroundLedgerContext(t);
  const jobId = "job-debug-recover";
  ensureStateDir(context.cwd);
  const logFile = resolveJobLogFile(context.cwd, jobId);
  fs.writeFileSync(logFile, "worker made progress before exit\n");
  upsertJob(context.cwd, {
    jobId,
    provider: "qwen",
    kind: "ask",
    status: "running",
    pid: 999999,
    logFile,
  });
  writeJobConfigFile(context.cwd, jobId, {
    workspaceRoot: context.cwd,
    jobId,
    execution: {
      provider: "qwen",
      kind: "ask",
      model: "qwen-test",
      defaultModel: "qwen-default",
    },
    runContext: {
      runId: "run-debug-recover",
      command: "ask",
      hostSurface: "terminal",
      rawArgs: ["ask", "--provider", "qwen", "<prompt:redacted>"],
      jobId,
      provider: "qwen",
      kind: "ask",
      model: "qwen-test",
      defaultModel: "qwen-default",
      logFile,
    },
  });
  await appendRunLedgerEvent(context.cwd, {
    runId: "run-debug-recover",
    command: "ask",
    commands: ["ask"],
    kind: "ask",
    provider: "qwen",
    phase: "attempt_started",
    status: "started",
    jobId,
    hostSurface: "terminal",
    logFile,
  });

  const show = await runCompanion(["debug", "show", "run-debug-recover", "--json"], context);
  assert.equal(show.code, 0, show.stderr);
  const parsed = JSON.parse(show.stdout);
  const terminalEvents = parsed.events.filter((event) =>
    event.jobId === jobId && ["attempt_result", "provider_decision"].includes(event.phase),
  );
  assert.equal(terminalEvents.length, 2, JSON.stringify(parsed.events, null, 2));
  assert.equal(terminalEvents.find((event) => event.phase === "attempt_result").status, "failed");
  assert.equal(terminalEvents.find((event) => event.phase === "attempt_result").reason, "worker_exited");
  assert.equal(terminalEvents.find((event) => event.phase === "provider_decision").reason, "worker_exited");

  const showAgain = await runCompanion(["debug", "show", "run-debug-recover", "--json"], context);
  assert.equal(showAgain.code, 0, showAgain.stderr);
  const parsedAgain = JSON.parse(showAgain.stdout);
  assert.equal(
    parsedAgain.events.filter((event) => event.jobId === jobId && event.phase === "attempt_result").length,
    1,
  );
  assert.equal(
    parsedAgain.events.filter((event) => event.jobId === jobId && event.phase === "provider_decision").length,
    1,
  );
});
