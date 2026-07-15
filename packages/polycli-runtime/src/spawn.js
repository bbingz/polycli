import { spawn } from "node:child_process";

import { preflightArgv } from "@bbingz/polycli-utils/process";
import { createLineDecoder } from "@bbingz/polycli-utils/stream";

import { classifyProviderFailure } from "./errors.js";

const DEFAULT_CAPTURE_LIMIT_BYTES = 1_048_576;

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

function normalizeCaptureLimit(value) {
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_CAPTURE_LIMIT_BYTES;
}

function spawnFailureResult(error, captureLimitBytes) {
  const spawnErrorCode = typeof error?.code === "string" ? error.code : null;
  return {
    ok: false,
    status: null,
    signal: null,
    timedOut: false,
    aborted: false,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    captureLimitBytes,
    outputOverflowStream: null,
    closeTimedOut: false,
    terminationErrors: [],
    terminationFailure: null,
    terminationReason: null,
    spawnErrorCode,
    error: String(error?.message ?? error),
    errorCode: classifyProviderFailure(error),
  };
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
  maxCaptureBytes = DEFAULT_CAPTURE_LIMIT_BYTES,
  argvBudgetBytes = null,
  argvBudgetHint = null,
  stdio = ["pipe", "pipe", "pipe"],
  detached = process.platform !== "win32",
  unref = false,
  spawnImpl = spawn,
  onStdoutLine = () => {},
  onStderrChunk = () => {},
} = {}) {
  const captureLimitBytes = normalizeCaptureLimit(maxCaptureBytes);
  const preflight = preflightArgv(bin, args, {
    env: env ?? process.env,
    argvBudgetBytes,
    argvBudgetHint,
  });
  if (!preflight.ok) {
    return Promise.resolve(spawnFailureResult(preflight.error, captureLimitBytes));
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(bin, args, { cwd, env, stdio, detached });
    } catch (error) {
      resolve(spawnFailureResult(error, captureLimitBytes));
      return;
    }

    if (unref && typeof child.unref === "function") {
      child.unref();
    }

    const decoder = createLineDecoder({ maxBufferBytes });
    const stdoutParts = [];
    const stderrParts = [];
    let stdoutCapturedBytes = 0;
    let stderrCapturedBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let outputOverflowStream = null;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;
    let settleTimer = null;
    let decoderError = null;
    let lifecycleFailure = null;
    let terminationRequested = false;
    const terminationErrors = [];

    const setLifecycleFailure = (code, message) => {
      if (!lifecycleFailure) {
        lifecycleFailure = { code, message };
      }
    };

    const recordTerminationError = (error, killSignal, target) => {
      terminationErrors.push({
        signal: killSignal,
        target,
        code: typeof error?.code === "string" ? error.code : null,
        message: String(error?.message ?? error).slice(0, 4_096),
      });
    };

    const trySignal = (killSignal, target, sender) => {
      try {
        const delivered = sender();
        if (delivered === false) {
          const error = new Error(`${target} kill returned false`);
          error.code = "KILL_RETURNED_FALSE";
          recordTerminationError(error, killSignal, target);
          return false;
        }
        return true;
      } catch (error) {
        recordTerminationError(error, killSignal, target);
        return false;
      }
    };

    const signalChild = (killSignal) => {
      const canSignalGroup = detached
        && Number.isInteger(child.pid)
        && child.pid > 0
        && process.platform !== "win32";

      if (canSignalGroup) {
        const groupSignalled = trySignal(
          killSignal,
          "process_group",
          () => process.kill(-child.pid, killSignal)
        );
        if (groupSignalled) return;
      }

      trySignal(killSignal, "child", () => child.kill(killSignal));
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

    const capturedStdout = () => stdoutParts.join("");
    const capturedStderr = () => Buffer.concat(stderrParts, stderrCapturedBytes).toString("utf8");

    const buildResult = (status, signalName, { closeTimedOut = false } = {}) => {
      if (!lifecycleFailure) {
        if (timedOut || status === 124) {
          setLifecycleFailure("timeout", "process timed out");
        } else if (aborted || signalName === "SIGINT" || status === 130) {
          setLifecycleFailure("cancelled", aborted ? "process aborted" : "process interrupted");
        } else if (signalName || status === 143) {
          setLifecycleFailure("terminated", formatExitError(status, signalName));
        }
      }

      const stdout = capturedStdout();
      const stderr = capturedStderr();
      const ok = status === 0 && !lifecycleFailure && !closeTimedOut;
      const error = ok
        ? null
        : lifecycleFailure?.message
          ?? (stderr.trim() || formatExitError(status, signalName, { timedOut, aborted }));

      return {
        ok,
        status,
        signal: signalName,
        timedOut,
        aborted,
        stdout,
        stderr,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
        captureLimitBytes,
        outputOverflowStream,
        closeTimedOut,
        terminationErrors: terminationErrors.map((entry) => ({ ...entry })),
        terminationFailure: closeTimedOut
          ? "close_timeout"
          : (terminationErrors.length > 0 ? "signal_error" : null),
        terminationReason: lifecycleFailure?.code ?? null,
        spawnErrorCode: null,
        error,
        errorCode: lifecycleFailure?.code ?? classifyProviderFailure(error),
      };
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (settleTimer) clearTimeout(settleTimer);
      cleanup();
      resolve(result);
    };

    const settleWithoutClose = () => {
      if (settled) return;
      finish(buildResult(null, null, { closeTimedOut: true }));
    };

    const forceKill = () => {
      if (settled) return;
      signalChild("SIGKILL");
      if (settled) return;
      const closeWaitMs = Math.max(10, Math.max(0, killGraceMs));
      settleTimer = setTimeout(settleWithoutClose, closeWaitMs);
    };

    const terminateChild = (code, message) => {
      setLifecycleFailure(code, message);
      if (terminationRequested) return;
      terminationRequested = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signalChild("SIGTERM");
      if (settled) return;
      forceTimer = setTimeout(forceKill, Math.max(0, killGraceMs));
    };

    const handleOutputOverflow = (streamName) => {
      if (!outputOverflowStream) {
        outputOverflowStream = streamName;
      }
      terminateChild(
        "output_overflow",
        `${streamName} capture exceeded maxCaptureBytes (${captureLimitBytes})`
      );
    };

    const appendStdoutLine = (line, { trailingNewline = true } = {}) => {
      const text = trailingNewline ? `${line}\n` : line;
      const bytes = Buffer.byteLength(text);
      if (stdoutCapturedBytes + bytes > captureLimitBytes) {
        stdoutTruncated = true;
        return false;
      }
      stdoutParts.push(text);
      stdoutCapturedBytes += bytes;
      try { onStdoutLine(line); } catch {}
      return true;
    };

    const handleDecoderError = (error) => {
      if (decoderError || settled) return;
      decoderError = String(error?.message ?? error).slice(0, 4_096);
      stdoutTruncated = true;
      outputOverflowStream = outputOverflowStream || "stdout";
      child.stdout?.off?.("data", handleStdoutData);
      terminateChild("output_overflow", decoderError);
    };

    const abortHandler = () => {
      if (settled || aborted) return;
      aborted = true;
      terminateChild("cancelled", "process aborted");
    };

    if (timeout != null) {
      timer = setTimeout(() => {
        if (settled || timedOut || terminationRequested) return;
        timedOut = true;
        terminateChild("timeout", "process timed out");
      }, timeout);
    }

    const handleChildError = (error) => {
      if (terminationRequested) {
        return;
      }
      finish({
        ...spawnFailureResult(error, captureLimitBytes),
        timedOut,
        aborted,
        stdout: capturedStdout(),
        stderr: capturedStderr(),
        stdoutBytes,
        stderrBytes,
        stdoutTruncated,
        stderrTruncated,
      });
    };

    const captureStderr = (chunk, { emit = true } = {}) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stderrBytes += buffer.length;
      const remaining = Math.max(captureLimitBytes - stderrCapturedBytes, 0);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        stderrParts.push(Buffer.from(accepted));
        stderrCapturedBytes += accepted.length;
        if (emit) {
          try { onStderrChunk(accepted.toString("utf8")); } catch {}
        }
      }
      if (accepted.length < buffer.length) {
        stderrTruncated = true;
        child.stderr?.off?.("data", handleStderrData);
        handleOutputOverflow("stderr");
      }
    };

    const handleStdinError = (error) => {
      if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
        return;
      }
      captureStderr(Buffer.from(`${error.message}\n`), { emit: false });
    };

    const handleStdoutData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const previousBytes = stdoutBytes;
      stdoutBytes += buffer.length;
      const remaining = Math.max(captureLimitBytes - previousBytes, 0);
      const accepted = buffer.subarray(0, remaining);

      let lines;
      try {
        lines = accepted.length > 0 ? decoder.push(accepted) : [];
      } catch (error) {
        handleDecoderError(error);
        return;
      }

      for (const line of lines) {
        if (!appendStdoutLine(line)) {
          child.stdout?.off?.("data", handleStdoutData);
          handleOutputOverflow("stdout");
          return;
        }
      }

      if (accepted.length < buffer.length) {
        stdoutTruncated = true;
        child.stdout?.off?.("data", handleStdoutData);
        handleOutputOverflow("stdout");
      }
    };

    const handleStderrData = (chunk) => {
      if (settled) return;
      captureStderr(chunk);
    };

    const handleChildClose = (status, signalName) => {
      if (!decoderError && !stdoutTruncated) {
        let lines;
        try {
          lines = decoder.end();
        } catch (error) {
          handleDecoderError(error);
          finish(buildResult(status, signalName));
          return;
        }

        for (const line of lines) {
          if (!appendStdoutLine(line, { trailingNewline: false })) {
            handleOutputOverflow("stdout");
            break;
          }
        }
      }

      finish(buildResult(status, signalName));
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
