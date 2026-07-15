import { spawnSync } from "node:child_process";
import process from "node:process";

const CONSERVATIVE_POINTER_BYTES = 8;
const WINDOWS_SAFE_ARGV_BUDGET_BYTES = 24 * 1024;
const POSIX_SAFE_ARGV_BUDGET_BYTES = 96 * 1024;

function stringStorageBytes(value) {
  return Buffer.byteLength(String(value), "utf8") + 1;
}

export function getSafeArgvBudgetBytes(platform = process.platform) {
  // These are application safety gates, not claims about the operating system's ARG_MAX.
  // The lower Windows budget reflects its smaller effective command-line envelope.
  return platform === "win32"
    ? WINDOWS_SAFE_ARGV_BUDGET_BYTES
    : POSIX_SAFE_ARGV_BUDGET_BYTES;
}

export function calculateArgvFootprint({
  command,
  args = [],
  env = process.env,
} = {}) {
  const argv = [String(command ?? ""), ...args.map((arg) => String(arg))];
  const envEntries = Object.entries(env ?? {})
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${String(value)}`);
  const argvBytes = argv.reduce((total, value) => total + stringStorageBytes(value), 0);
  const envBytes = envEntries.reduce((total, value) => total + stringStorageBytes(value), 0);
  // Account for argv/envp pointers plus each terminating null pointer. Eight bytes is
  // deliberately conservative for the supported 64-bit Node.js environments.
  const pointerBytes = (argv.length + envEntries.length + 2) * CONSERVATIVE_POINTER_BYTES;
  const stringBytes = argvBytes + envBytes;
  return {
    totalBytes: stringBytes + pointerBytes,
    stringBytes,
    pointerBytes,
    argvBytes,
    envBytes,
    argvCount: argv.length,
    envCount: envEntries.length,
  };
}

export function preflightArgv(command, args = [], {
  env = process.env,
  argvBudgetBytes = null,
  argvBudgetHint = null,
} = {}) {
  const footprint = calculateArgvFootprint({ command, args, env });
  if (argvBudgetBytes == null) {
    return { ok: true, budgetBytes: null, footprint, error: null };
  }
  if (!Number.isSafeInteger(argvBudgetBytes) || argvBudgetBytes < 0) {
    throw new TypeError("argvBudgetBytes must be a non-negative safe integer or null");
  }
  if (footprint.totalBytes <= argvBudgetBytes) {
    return { ok: true, budgetBytes: argvBudgetBytes, footprint, error: null };
  }

  const counts = [
    `footprintBytes=${footprint.totalBytes}`,
    `budgetBytes=${argvBudgetBytes}`,
    `argvCount=${footprint.argvCount}`,
    `envCount=${footprint.envCount}`,
  ].join(", ");
  const suffix = typeof argvBudgetHint === "string" && argvBudgetHint.trim()
    ? ` ${argvBudgetHint.trim()}`
    : "";
  const error = Object.assign(
    new Error(`argument list too long for the configured safe argv budget (${counts}).${suffix}`),
    {
      code: "E2BIG",
      footprintBytes: footprint.totalBytes,
      budgetBytes: argvBudgetBytes,
      argvCount: footprint.argvCount,
      envCount: footprint.envCount,
    }
  );
  return { ok: false, budgetBytes: argvBudgetBytes, footprint, error };
}

export function runCommand(command, args = [], options = {}) {
  const effectiveEnv = options.env ?? process.env;
  const preflight = preflightArgv(command, args, {
    env: effectiveEnv,
    argvBudgetBytes: options.argvBudgetBytes ?? null,
    argvBudgetHint: options.argvBudgetHint ?? null,
  });
  if (!preflight.ok) {
    return {
      command,
      args,
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: preflight.error,
      spawnErrorCode: "E2BIG",
    };
  }

  const spawnImpl = options.spawnImpl ?? spawnSync;
  const result = spawnImpl(command, args, {
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
    spawnErrorCode: typeof error?.code === "string" ? error.code : null,
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
  {
    signal = "SIGTERM",
    forceSignal = "SIGKILL",
    forceAfterMs = 5_000,
    ignoreMissing = true,
    deadlineAt = null,
    platform = process.platform,
    runCommandImpl = runCommand,
    now = Date.now,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}
) {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`Invalid pid: ${pid}`);
  }
  if (deadlineAt != null && !Number.isFinite(deadlineAt)) {
    throw new TypeError("deadlineAt must be a finite epoch millisecond value or null");
  }

  const remainingDeadlineMs = () => {
    if (deadlineAt == null) return null;
    const remainingMs = Math.floor(deadlineAt - now());
    if (remainingMs <= 0) {
      const error = new Error("process termination deadline exceeded");
      error.code = "EDEADLINE";
      throw error;
    }
    return remainingMs;
  };

  const killOnce = (targetSignal) => {
    const remainingMs = remainingDeadlineMs();
    if (platform === "win32") {
      const args = ["/PID", String(pid), "/T"];
      if (targetSignal === "SIGKILL") {
        args.push("/F");
      }
      const result = runCommandImpl("taskkill", args, remainingMs == null
        ? {}
        : { timeout: remainingMs });
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

    const killPid = () => {
      try {
        process.kill(pid, targetSignal);
        return true;
      } catch (error) {
        if (error.code === "ESRCH" && ignoreMissing) return false;
        throw error;
      }
    };

    try {
      process.kill(-pid, targetSignal);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") {
        return killPid();
      }
      if (error.code === "EINVAL") {
        throw error;
      }
      return killPid();
    }
  };

  const terminated = killOnce(signal);
  if (!terminated || forceAfterMs <= 0) {
    return terminated;
  }

  const remainingBeforeWait = deadlineAt == null ? null : remainingDeadlineMs();
  const waitMs = remainingBeforeWait == null
    ? forceAfterMs
    : Math.min(forceAfterMs, remainingBeforeWait);
  await sleep(waitMs);
  try {
    killOnce(forceSignal);
  } catch (error) {
    if (!(ignoreMissing && error.code === "ESRCH")) {
      throw error;
    }
  }
  return true;
}
