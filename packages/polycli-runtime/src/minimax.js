import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { binaryAvailable } from "@bbingz/polycli-utils/process";

import { spawnStreamingCommand } from "./spawn.js";

const MINI_AGENT_BIN = process.env.MINI_AGENT_BIN || "mini-agent";
const MINI_AGENT_LOG_DIR =
  process.env.MINI_AGENT_LOG_DIR || path.join(os.homedir(), ".mini-agent", "log");
const MINI_AGENT_CONFIG_PATH =
  process.env.MINI_AGENT_CONFIG_PATH || path.join(os.homedir(), ".mini-agent", "config", "config.yaml");
const DEFAULT_TIMEOUT_MS = 120_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;

function readMiniMaxConfig() {
  try {
    const text = fs.readFileSync(MINI_AGENT_CONFIG_PATH, "utf8");
    const read = (key) => {
      const match = text.match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))`, "m"));
      return match ? (match[1] ?? match[2] ?? match[3]?.trim() ?? null) : null;
    };
    return {
      api_key: read("api_key"),
      api_base: read("api_base"),
      model: read("model"),
    };
  } catch {
    return { api_key: null, api_base: null, model: null };
  }
}

export function stripAnsiSgr(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function buildMiniMaxInvocation({
  prompt,
  cwd,
  extraArgs = [],
  bin = MINI_AGENT_BIN,
} = {}) {
  return {
    bin,
    args: ["-t", String(prompt ?? ""), "-w", cwd || process.cwd(), ...extraArgs],
  };
}

export function extractMiniMaxLogPath(text) {
  const match = stripAnsiSgr(text).match(/Log file:\s+(\S+\.log)/);
  return match ? match[1] : null;
}

export function parseMiniMaxResponseBlocks(logText) {
  const blocks = [];
  const lines = String(logText ?? "").split(/\r?\n/);
  let current = null;
  let bodyLines = [];
  let braceDepth = 0;
  let inString = false;

  const scanLine = (line) => {
    let opens = 0;
    let closes = 0;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (char === "\\") {
          index += 1;
        } else if (char === '"') {
          inString = false;
        }
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        opens += 1;
      } else if (char === "}") {
        closes += 1;
      }
    }
    braceDepth += opens - closes;
  };

  const finish = () => {
    if (!current) return;
    const raw = bodyLines.join("\n");
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    blocks.push({ ...current, raw, json });
    current = null;
    bodyLines = [];
    braceDepth = 0;
    inString = false;
  };

  for (const line of lines) {
    const header = line.match(/^\[(\d+)\]\s+RESPONSE$/);
    if (header) {
      finish();
      current = { index: Number.parseInt(header[1], 10) };
      continue;
    }
    if (!current) continue;
    if (bodyLines.length === 0 && !line.trimStart().startsWith("{")) continue;
    bodyLines.push(line);
    scanLine(line);
    if (braceDepth <= 0 && bodyLines.length > 0 && !inString) {
      finish();
    }
  }

  finish();
  return blocks;
}

export function extractMiniMaxResponseFromLogText(logText) {
  const blocks = parseMiniMaxResponseBlocks(logText);
  const picked = [...blocks]
    .reverse()
    .find((block) => block.json && (block.json.finish_reason || block.json.content));

  if (!picked?.json) {
    return { response: "", finishReason: null, toolCalls: [] };
  }

  const model = picked.json.model ?? picked.json.meta?.model ?? null;
  return {
    response: typeof picked.json.content === "string" ? picked.json.content : "",
    finishReason: picked.json.finish_reason ?? null,
    toolCalls: Array.isArray(picked.json.tool_calls) ? picked.json.tool_calls : [],
    ...(model ? { model } : {}),
  };
}

export function extractMiniMaxEventText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "progress" && typeof event.text === "string") {
    return event.text;
  }
  if (event.type === "result" && typeof event.response === "string") {
    return event.response;
  }
  return "";
}

function snapshotLogDir(logDir) {
  try {
    return new Set(fs.readdirSync(logDir).filter((name) => name.endsWith(".log")));
  } catch {
    return new Set();
  }
}

function diffLogSnapshot(beforeSet, logDir) {
  try {
    const current = fs.readdirSync(logDir).filter((name) => name.endsWith(".log"));
    const novel = current.filter((name) => !beforeSet.has(name));
    if (novel.length === 0) return null;
    novel.sort();
    return path.join(logDir, novel[novel.length - 1]);
  } catch {
    return null;
  }
}

export function getMiniMaxAvailability(cwd) {
  return binaryAvailable(MINI_AGENT_BIN, ["--version"], { cwd });
}

export async function getMiniMaxAuthStatus(cwd) {
  const config = readMiniMaxConfig();
  if (!config.api_key || config.api_key === "YOUR_API_KEY_HERE") {
    return { loggedIn: false, detail: "api_key is placeholder or missing" };
  }

  const result = await runMiniMaxPrompt({
    prompt: "ping",
    cwd,
    timeout: AUTH_CHECK_TIMEOUT_MS,
  });

  return {
    loggedIn: result.ok,
    detail: result.ok ? "authenticated" : result.error,
    model: config.model,
    apiBase: config.api_base,
  };
}

export function runMiniMaxPrompt({
  prompt,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  onProgressLine,
  bin = MINI_AGENT_BIN,
  spawnImpl,
} = {}) {
  return new Promise((resolve) => {
    const beforeLogs = snapshotLogDir(MINI_AGENT_LOG_DIR);
    const invocation = buildMiniMaxInvocation({ prompt, cwd, extraArgs, bin });
    let logPath = null;

    const handleStdoutLine = (line) => {
      const clean = stripAnsiSgr(line);
      if (!logPath) logPath = extractMiniMaxLogPath(clean);
      if (typeof onProgressLine === "function") {
        try { onProgressLine(clean); } catch {}
      }
    };

    spawnStreamingCommand({
      bin: invocation.bin,
      args: invocation.args,
      cwd: cwd || process.cwd(),
      env,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      spawnImpl,
      onStdoutLine: handleStdoutLine,
    }).then((result) => {
      try {
        const effectiveLogPath = logPath || diffLogSnapshot(beforeLogs, MINI_AGENT_LOG_DIR);
        const parsed = effectiveLogPath && fs.existsSync(effectiveLogPath)
          ? extractMiniMaxResponseFromLogText(fs.readFileSync(effectiveLogPath, "utf8"))
          : { response: "", finishReason: null, toolCalls: [] };

        resolve({
          ...result,
          logPath: effectiveLogPath,
          ...parsed,
          model: parsed.model ?? defaultModel,
          ok: result.ok && Boolean(parsed.response.trim()),
          error: result.ok && parsed.response.trim() ? null : result.error,
        });
      } catch (error) {
        resolve({
          ok: false,
          status: null,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          response: "",
          finishReason: null,
          toolCalls: [],
          logPath: logPath || diffLogSnapshot(beforeLogs, MINI_AGENT_LOG_DIR),
          error: error.message,
        });
      }
    }, (error) => {
      resolve({
        ok: false,
        status: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        response: "",
        finishReason: null,
        toolCalls: [],
        logPath: logPath || diffLogSnapshot(beforeLogs, MINI_AGENT_LOG_DIR),
        error: error.message,
      });
    });
  });
}

export async function runMiniMaxPromptStreaming({
  prompt,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  defaultModel = null,
  env = process.env,
  onEvent = () => {},
  bin = MINI_AGENT_BIN,
  spawnImpl,
} = {}) {
  return runMiniMaxPrompt({
    prompt,
    cwd,
    timeout,
    extraArgs,
    defaultModel,
    env,
    bin,
    spawnImpl,
    onProgressLine(line) {
      try { onEvent({ type: "progress", text: line }); } catch {}
    },
  }).then((result) => {
    try {
      onEvent({
        type: "result",
        response: result.response,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls,
        model: result.model ?? null,
      });
    } catch {}
    return result;
  });
}
