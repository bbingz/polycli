import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const companionPath = path.resolve(__dirname, "..", "polycli-companion.bundle.mjs");

function createFakeQwenBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-fake-qwen-"));
  const bin = path.join(root, "qwen");
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("qwen 0.0.0-test\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write("authenticated\\n");
  process.exit(0);
}
const prompt = args.at(-1) || "";
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : 0;
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const toolDelayMatch = prompt.match(/__toolDelay=(\\d+)/);
const toolDelay = toolDelayMatch ? Number.parseInt(toolDelayMatch[1], 10) : 0;
const useTool = prompt.includes("__tool=1");
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = replyMatch ? replyMatch[1] : prompt;
(async () => {
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "11111111-1111-1111-1111-111111111111", model: "qwen-test" }) + "\\n");
  if (delay > 0) await sleep(delay);
  if (useTool) {
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "shell", input: { cmd: "pwd" } }] } }) + "\\n");
    if (toolDelay > 0) await sleep(toolDelay);
    process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: false }] } }) + "\\n");
  }
  process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: reply }] } }) + "\\n");
  if (tailDelay > 0) await sleep(tailDelay);
  process.stdout.write(JSON.stringify({ type: "result", result: reply, is_error: false, permission_denials: [] }) + "\\n");
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
if (args.includes("-v")) {
  process.stdout.write("gemini 0.0.0-test\\n");
  process.exit(0);
}
const outputFormat = args[args.indexOf("-o") + 1] || "json";
const prompt = args[args.indexOf("-p") + 1] || "";
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : 0;
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = replyMatch ? replyMatch[1] : prompt || "ping";
if (outputFormat === "json") {
  process.stdout.write(JSON.stringify({
    response: reply,
    session_id: "22222222-2222-2222-2222-222222222222",
    stats: { models: { "gemini-test": 1 } }
  }) + "\\n");
  process.exit(0);
}
(async () => {
  process.stdout.write(JSON.stringify({ type: "init", session_id: "22222222-2222-2222-2222-222222222222", model: "gemini-test" }) + "\\n");
  if (delay > 0) await sleep(delay);
  process.stdout.write(JSON.stringify({ type: "message", content: reply }) + "\\n");
  if (tailDelay > 0) await sleep(tailDelay);
  process.stdout.write(JSON.stringify({ type: "result", stats: { models: { "gemini-test": 1 } } }) + "\\n");
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
if (args.includes("-V")) {
  process.stdout.write("kimi 0.0.0-test\\n");
  process.exit(0);
}
const promptIndex = args.indexOf("-p");
const prompt = promptIndex >= 0 ? (args[promptIndex + 1] || "") : "ping";
const delayMatch = prompt.match(/__delay=(\\d+)/);
const delay = delayMatch ? Number.parseInt(delayMatch[1], 10) : 0;
const tailDelayMatch = prompt.match(/__tail=(\\d+)/);
const tailDelay = tailDelayMatch ? Number.parseInt(tailDelayMatch[1], 10) : 0;
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = replyMatch ? replyMatch[1] : prompt;
(async () => {
  process.stderr.write("To resume: kimi -r 33333333-3333-4333-8333-333333333333\\n");
  if (delay > 0) await sleep(delay);
  process.stdout.write(JSON.stringify({ role: "assistant", content: [{ type: "text", text: reply }] }) + "\\n");
  if (tailDelay > 0) await sleep(tailDelay);
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
const prompt = args[args.indexOf("-t") + 1] || "ping";
const replyMatch = prompt.match(/__reply=([^\\n]+)/);
const reply = replyMatch ? replyMatch[1] : prompt;
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
  assert.ok(askPayload.timing, "ask result should include timing");
  return askPayload;
}

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
    assert.equal(parsed.result.response, "PONG");
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
