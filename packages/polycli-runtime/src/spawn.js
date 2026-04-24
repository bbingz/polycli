import { spawn } from "node:child_process";

import { createLineDecoder } from "@bbingz/polycli-utils/stream";

function formatExitError(status, signal, { timedOut = false, aborted = false } = {}) {
  if (aborted) {
    return "process aborted";
  }
  if (timedOut || status === 124) {
    return "process timed out";
  }
  if (signal === "SIGINT" || status === 130) {
    return "process interrupted";
  }
  if (signal === "SIGTERM" || status === 143) {
    return "process terminated";
  }
  return `process exited with code ${status}`;
}

export function spawnStreamingCommand({
  bin,
  args = [],
  cwd,
  env,
  input,
  timeout,
  killGraceMs = 2_000,
  signal = null,
  maxBufferBytes = 1_048_576,
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

    const decoder = createLineDecoder({ maxBufferBytes });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;

    const signalChild = (signal) => {
      try {
        if (detached && Number.isInteger(child.pid) && child.pid > 0 && process.platform !== "win32") {
          process.kill(-child.pid, signal);
          return;
        }
        child.kill(signal);
      } catch {
        // ignore
      }
    };

    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", abortHandler);
      }
      child.stdout?.off?.("data", handleStdoutData);
      child.stderr?.off?.("data", handleStderrData);
      child.stdin?.off?.("error", handleStdinError);
      child.off?.("error", handleChildError);
      child.off?.("close", handleChildClose);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      cleanup();
      resolve(result);
    };

    const finishDecoderError = (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message,
      });
    };

    const abortHandler = () => {
      if (settled || aborted) return;
      aborted = true;
      signalChild("SIGTERM");
      if (killGraceMs > 0 && !forceTimer) {
        forceTimer = setTimeout(() => {
          signalChild("SIGKILL");
        }, killGraceMs);
      }
    };

    if (timeout != null) {
      timer = setTimeout(() => {
        timedOut = true;
        signalChild("SIGTERM");
        if (killGraceMs > 0) {
          forceTimer = setTimeout(() => {
            signalChild("SIGKILL");
          }, killGraceMs);
        }
      }, timeout);
    }

    const handleChildError = (error) => {
      finish({
        ok: false,
        status: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        error: error.message,
      });
    };

    const handleStdinError = (error) => {
      if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
        return;
      }
      stderr += `${error.message}\n`;
    };

    const handleStdoutData = (chunk) => {
      if (settled) return;
      let lines;
      try {
        lines = decoder.push(chunk);
      } catch (error) {
        finishDecoderError(error);
        return;
      }
      for (const line of lines) {
        stdout += `${line}\n`;
        try { onStdoutLine(line); } catch {}
      }
    };

    const handleStderrData = (chunk) => {
      if (settled) return;
      const text = chunk.toString("utf8");
      stderr += text;
      try { onStderrChunk(text); } catch {}
    };

    const handleChildClose = (status, signalName) => {
      let lines;
      try {
        lines = decoder.end();
      } catch (error) {
        finishDecoderError(error);
        return;
      }

      for (const line of lines) {
        stdout += `${line}\n`;
        try { onStdoutLine(line); } catch {}
      }

      finish({
        ok: status === 0 && !timedOut && !aborted,
        status,
        signal: signalName,
        timedOut,
        stdout,
        stderr,
        error:
          status === 0 && !timedOut && !aborted
            ? null
            : stderr.trim() || formatExitError(status, signalName, { timedOut, aborted }),
      });
    };

    child.on("error", handleChildError);
    child.stdin?.on?.("error", handleStdinError);
    child.stdout?.on?.("data", handleStdoutData);
    child.stderr?.on?.("data", handleStderrData);
    child.on("close", handleChildClose);

    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    if (child.stdin) {
      if (input != null) {
        const wroteAll = child.stdin.write(input);
        if (wroteAll === false && child.stdin.once) {
          child.stdin.once("drain", () => {
            if (!settled) {
              child.stdin.end();
            }
          });
        } else {
          child.stdin.end();
        }
      } else {
        child.stdin.end();
      }
    }
  });
}
