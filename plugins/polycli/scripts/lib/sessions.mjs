import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

// Provider session-artifact derivation + verified purge planning.
//
// SAFETY MODEL (spec §5, rev2): deletion is driven ONLY by an exact realpath
// recorded-and-verified at run time. We NEVER derive a path from a sessionId at
// purge time and NEVER glob. `deriveSessionArtifactCandidate` returns at most ONE
// candidate; if the live store layout cannot be reduced to a single exact path
// from the captured sessionId alone, it returns null+reason (no wildcard scan).

// Store root per provider, relative to homedir. Used both at record time
// (realpath-still-under-root) and purge time (re-validation). Providers without
// an entry have no purgeable per-session artifact.
function storeRoot(provider, homedir) {
  switch (provider) {
    case "claude":
      return path.join(homedir, ".claude", "projects");
    case "kimi":
      return path.join(homedir, ".kimi-code", "sessions");
    default:
      return null;
  }
}

function isUnder(root, target) {
  if (!root) return false;
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Returns at most ONE candidate artifact path for the provider, or
 * {path:null, reason}. The implementer verified each per-provider derivation
 * against the live store on this machine (see deviationsFromSpec for pi).
 */
export function deriveSessionArtifactCandidate({ provider, sessionId, workspaceRoot, homedir } = {}) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { path: null, reason: "no sessionId captured for this run" };
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    return { path: null, reason: "no workspace root" };
  }
  switch (provider) {
    case "claude": {
      // Verified against ~/.claude/projects on this machine: dir is the cwd with
      // '/'->'-' (NOT a hash), file is <sessionId>.jsonl.
      const encoded = workspaceRoot.replaceAll("/", "-");
      return {
        provider: "claude",
        path: path.join(homedir, ".claude", "projects", encoded, `${sessionId}.jsonl`),
        kind: "file",
      };
    }
    case "kimi": {
      // kimi-code v0.6.0 store (verified on disk): ~/.kimi-code/sessions/
      // wd_<basename>_<sha256(realCwd)[:12]>/<sessionId>/ — a per-session DIR. sessionId is the
      // structured `session_<uuid>` captured from the stream-json resume_hint event, which is
      // also the exact dir name. Use the realpath of the cwd (the store keys by realpath).
      let realCwd = workspaceRoot;
      try {
        realCwd = fs.realpathSync(workspaceRoot);
      } catch {
        // workspace dir gone — fall back to the given path; recordArtifactPath will reject it
        // if it does not resolve under the store root.
      }
      const slug = `wd_${path.basename(realCwd)}_${createHash("sha256").update(realCwd).digest("hex").slice(0, 12)}`;
      return {
        provider: "kimi",
        path: path.join(homedir, ".kimi-code", "sessions", slug, sessionId),
        kind: "dir",
      };
    }
    case "pi":
      // Live store ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl:
      // the on-disk filename is TIMESTAMP-prefixed, so the exact path cannot be
      // derived from the sessionId alone without scanning the dir. Per spec's
      // NO-glob rule + invariant #6, return null rather than wildcard-scan.
      return { path: null, reason: "pi session files are timestamp-prefixed; exact path is not derivable without a directory scan" };
    case "gemini":
      return { path: null, reason: "per-project dir, no per-session artifact" };
    case "codex":
      return { path: null, reason: "separate polycli-codex plugin" };
    case "minimax":
    case "cmd":
      return { path: null, reason: "ephemeral, no per-session store" };
    default:
      return { path: null, reason: `no artifact derivation for provider ${provider ?? "?"}` };
  }
}

/**
 * Returns the verified realpath ONLY if the candidate exists, is NOT a symlink,
 * and its realpath is still under the provider's store root. Otherwise null.
 * Existence at record time means the run just created it, so a hit is trustworthy.
 */
export function recordArtifactPath(candidate, { homedir, lstatFn = fs.lstatSync, realpathFn = fs.realpathSync, existsFn = fs.existsSync } = {}) {
  if (!candidate || typeof candidate.path !== "string") return null;
  const { path: candidatePath, provider } = candidate;
  if (!existsFn(candidatePath)) return null;
  let stat;
  try {
    stat = lstatFn(candidatePath);
  } catch {
    return null;
  }
  if (stat && typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) return null;
  let real;
  try {
    real = realpathFn(candidatePath);
  } catch {
    return null;
  }
  const root = storeRoot(provider, homedir);
  if (!isUnder(root, real)) return null;
  return real;
}

/**
 * Distinct {provider, sessionId, sessionArtifactPath, workspaceRoot} where
 * sessionArtifactPath != null. Events without a recorded path are not purgeable.
 */
export function collectRecordedArtifacts(events = []) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const sessionArtifactPath = event?.sessionArtifactPath;
    if (typeof sessionArtifactPath !== "string" || sessionArtifactPath.length === 0) continue;
    const provider = event.provider ?? null;
    const sessionId = event.sessionId ?? null;
    const workspaceRoot = event.workspaceRoot ?? null;
    const key = JSON.stringify([provider, sessionId, sessionArtifactPath, workspaceRoot]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider, sessionId, sessionArtifactPath, workspaceRoot });
  }
  return out;
}

/**
 * Distinct {provider, sessionId, reason} for runs that HAVE a captured sessionId
 * but NO recorded purgeable artifact path (gemini per-project dir, pi
 * timestamp-prefixed filenames, ephemeral providers, or a path that failed
 * record-time verification). Surfaced by `sessions list/purge` so a tracked
 * session is never silently dropped (honest-default, invariant #7). A session
 * that has a recorded path in ANY event is excluded (it is purgeable, not here).
 */
export function collectNonPurgeableSessions(events = [], { homedir = os.homedir() } = {}) {
  const withPath = new Set();
  for (const event of events) {
    if (
      typeof event?.sessionArtifactPath === "string"
      && event.sessionArtifactPath.length > 0
      && typeof event?.sessionId === "string"
    ) {
      withPath.add(JSON.stringify([event.provider ?? null, event.sessionId, event.workspaceRoot ?? null]));
    }
  }
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const sessionId = event?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) continue;
    const provider = event.provider ?? null;
    const workspaceRoot = event.workspaceRoot ?? null;
    const key = JSON.stringify([provider, sessionId, workspaceRoot]);
    if (withPath.has(key) || seen.has(key)) continue;
    seen.add(key);
    const derived = deriveSessionArtifactCandidate({ provider, sessionId, workspaceRoot, homedir });
    out.push({ provider, sessionId, reason: derived?.reason ?? "no recorded artifact path" });
  }
  return out;
}

/**
 * PURE plan. Re-validates every recorded path at purge time (rail 3):
 *  (a) lstat → reject symlinks
 *  (b) realpath → still under that provider's store root
 *  (c) still exists
 *  (d) basename still exactly matches the recorded sessionId (file & kimi dir)
 * Any failure → skipped + reason. No globbing.
 */
export function planPurge({ recorded = [], homedir, lstatFn = fs.lstatSync, realpathFn = fs.realpathSync, existsFn = fs.existsSync, sizeFn } = {}) {
  const deletable = [];
  const skipped = [];
  const defaultSizeFn = (p) => {
    try {
      return lstatFn(p).size ?? 0;
    } catch {
      return 0;
    }
  };
  const resolveSize = typeof sizeFn === "function" ? sizeFn : defaultSizeFn;

  for (const rec of recorded) {
    const { provider, sessionId } = rec;
    const candidatePath = rec.sessionArtifactPath;
    if (typeof candidatePath !== "string" || candidatePath.length === 0) {
      skipped.push({ provider, reason: "no recorded artifact path" });
      continue;
    }
    if (!existsFn(candidatePath)) {
      skipped.push({ path: candidatePath, reason: "artifact no longer exists" });
      continue;
    }
    let stat;
    try {
      stat = lstatFn(candidatePath);
    } catch {
      skipped.push({ path: candidatePath, reason: "lstat failed" });
      continue;
    }
    if (stat && typeof stat.isSymbolicLink === "function" && stat.isSymbolicLink()) {
      skipped.push({ path: candidatePath, reason: "refused: path is a symlink" });
      continue;
    }
    let real;
    try {
      real = realpathFn(candidatePath);
    } catch {
      skipped.push({ path: candidatePath, reason: "realpath failed" });
      continue;
    }
    const root = storeRoot(provider, homedir);
    if (!isUnder(root, real)) {
      skipped.push({ path: candidatePath, reason: "refused: realpath escaped the provider store root" });
      continue;
    }
    // basename must still exactly match the recorded sessionId. For file-type
    // artifacts the basename is <sessionId>.jsonl; for the kimi dir-type the dir
    // basename equals <sessionId>.
    const base = path.basename(candidatePath);
    const fileMatch = base === `${sessionId}.jsonl`;
    const dirMatch = base === sessionId;
    if (!fileMatch && !dirMatch) {
      skipped.push({ path: candidatePath, reason: "refused: basename no longer matches the recorded sessionId" });
      continue;
    }
    deletable.push({ provider, sessionId, path: candidatePath, bytes: resolveSize(candidatePath) });
  }
  return { deletable, skipped };
}

/**
 * Deletes plan.deletable ONLY if confirm; otherwise returns a dry-run summary.
 */
export function executePurge(plan, { confirm = false, rmFn = (p) => fs.rmSync(p, { recursive: true, force: true }) } = {}) {
  const deletable = plan?.deletable ?? [];
  const skipped = plan?.skipped ?? [];
  if (!confirm) {
    return { confirmed: false, deleted: 0, wouldDelete: deletable.length, skipped: skipped.length };
  }
  let deleted = 0;
  for (const entry of deletable) {
    rmFn(entry.path);
    deleted += 1;
  }
  return { confirmed: true, deleted, wouldDelete: deletable.length, skipped: skipped.length };
}

export function defaultHomedir() {
  return os.homedir();
}
