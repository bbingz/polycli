import { spawnSync } from "node:child_process";
import process from "node:process";

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    stdio: options.stdio ?? "pipe",
    detached: options.detached ?? false,
  });
  const preserveNullStatus = options.preserveNullStatus ?? false;
  const status = result.status ?? (preserveNullStatus ? null : 0);

  // A child terminated by a signal (e.g. SIGKILL/OOM, SIGTERM, Ctrl-C) reports status:null
  // with no spawn error. When we coerce that null to 0 (the default), callers that gate on
  // `status === 0` would misread a signal kill as a SUCCESSFUL run. Surface a synthetic error
  // so the existing `if (result.error)` failure branch in every sync provider catches it.
  // (A timeout already sets result.error=ETIMEDOUT, so this only fires on a pure signal kill.)
  let error = result.error ?? null;
  if (!error && result.status == null && result.signal && !preserveNullStatus) {
    error = Object.assign(
      new Error(`process terminated by signal ${result.signal}`),
      { code: result.signal }
    );
  }

  return {
    command,
    args,
    status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error,
  };
}

export function runCommandChecked(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

function firstNonEmptyLine(text) {
  for (const line of (text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function binaryAvailable(command, versionArgs = ["--version"], options = {}) {
  const result = runCommand(command, versionArgs, options);
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: "not found" };
  }
  if (result.error) {
    return { available: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout) || `exit ${result.status}`;
    return { available: false, detail };
  }
  return {
    available: true,
    detail: firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr) || "ok",
  };
}

export function formatCommandFailure(result) {
  const parts = [`${result.command} ${result.args.join(" ")}`.trim()];
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  } else {
    parts.push(`exit=${result.status}`);
  }
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (stderr) {
    parts.push(stderr);
  } else if (stdout) {
    parts.push(stdout);
  }
  return parts.join(": ");
}

export async function terminateProcessTree(
  pid,
  { signal = "SIGTERM", forceSignal = "SIGKILL", forceAfterMs = 5_000, ignoreMissing = true } = {}
) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid: ${pid}`);
  }

  const killOnce = (targetSignal) => {
    if (process.platform === "win32") {
      const args = ["/PID", String(pid), "/T"];
      if (targetSignal === "SIGKILL") {
        args.push("/F");
      }
      const result = runCommand("taskkill", args);
      if (result.error) {
        if (ignoreMissing && result.error.code === "ESRCH") return false;
        throw result.error;
      }
      if (result.status !== 0 && ignoreMissing && /not found|no running instance/i.test(result.stderr)) {
        return false;
      }
      if (result.status !== 0) {
        throw new Error(formatCommandFailure(result));
      }
      return true;
    }

    try {
      process.kill(-pid, targetSignal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") {
        if (ignoreMissing) return false;
        throw error;
      }
      if (error.code === "EINVAL") {
        throw error;
      }
      process.kill(pid, targetSignal);
      return true;
    }
  };

  const terminated = killOnce(signal);
  if (!terminated || forceAfterMs <= 0) {
    return terminated;
  }

  await new Promise((resolve) => setTimeout(resolve, forceAfterMs));
  try {
    killOnce(forceSignal);
  } catch (error) {
    if (!(ignoreMissing && error.code === "ESRCH")) {
      throw error;
    }
  }
  return true;
}
