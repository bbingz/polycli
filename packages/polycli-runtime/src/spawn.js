import { spawn } from "node:child_process";

import { createLineDecoder } from "@bbingz/polycli-utils/stream";

export function spawnStreamingCommand({
  bin,
  args = [],
  cwd,
  env,
  input,
  timeout,
  stdio = ["pipe", "pipe", "pipe"],
  detached = false,
  unref = false,
  spawnImpl = spawn,
  onStdoutLine = () => {},
  onStderrChunk = () => {},
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(bin, args, { cwd, env, stdio, detached });
    } catch (error) {
      resolve({
        ok: false,
        status: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        error: error.message,
      });
      return;
    }

    if (unref && typeof child.unref === "function") {
      child.unref();
    }

    const decoder = createLineDecoder();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (timeout != null) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch {}
      }, timeout);
    }

    child.on("error", (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message,
      });
    });

    if (child.stdin?.on) {
      child.stdin.on("error", (error) => {
        if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
          return;
        }
        stderr += `${error.message}\n`;
      });
    }

    if (child.stdout?.on) {
      child.stdout.on("data", (chunk) => {
        for (const line of decoder.push(chunk)) {
          stdout += `${line}\n`;
          try { onStdoutLine(line); } catch {}
        }
      });
    }

    if (child.stderr?.on) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        try { onStderrChunk(text); } catch {}
      });
    }

    child.on("close", (status, signal) => {
      for (const line of decoder.end()) {
        stdout += `${line}\n`;
        try { onStdoutLine(line); } catch {}
      }

      finish({
        ok: status === 0 && !timedOut,
        status,
        signal,
        timedOut,
        stdout,
        stderr,
        error: status === 0 && !timedOut ? null : stderr.trim() || `process exited with code ${status}`,
      });
    });

    if (child.stdin) {
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    }
  });
}
