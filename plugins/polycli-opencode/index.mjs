import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "./scripts/polycli-companion.bundle.mjs");

function tool(input) {
  return input;
}

tool.schema = z;

// Exit code 2 is the companion's documented soft signal, not a hard failure: `health` with no
// healthy provider and `status --wait` timeouts both exit 2 while still emitting a valid JSON
// envelope on stdout. The adapter must surface that envelope so the opencode agent can reason about
// it (anyHealthy:false / waitTimedOut:true) instead of seeing a thrown tool error. Every other
// non-zero exit (1/4/5/crash) is a real failure and is propagated.
export function isHardCompanionFailure(status) {
  return status !== 0 && status !== 2;
}

function runCompanion(argv) {
  const result = spawnSync(process.execPath, [COMPANION, ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (isHardCompanionFailure(result.status)) {
    const detail = String(result.stdout || result.stderr || "").trim() || `polycli companion exited with status ${result.status}`;
    const error = new Error(detail);
    error.status = result.status;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout;
}

export const PolycliPlugin = async () => ({
  tool: {
    polycli_run: tool({
      description: "Run a polycli companion subcommand such as setup, health, ask, rescue, review, adversarial-review, status, result, cancel, timing, debug, or sessions.",
      args: {
        argv: tool.schema.array(tool.schema.string()),
      },
      async execute(args) {
        return runCompanion(args.argv);
      },
    }),
    polycli_timing: tool({
      description: "Read stored polycli timing history and aggregate summaries.",
      args: {
        provider: tool.schema.string().optional(),
        history: tool.schema.number().optional(),
        json: tool.schema.boolean().optional(),
      },
      async execute(args) {
        const argv = ["timing"];
        if (args.provider) argv.push("--provider", args.provider);
        if (args.history != null) argv.push("--history", String(args.history));
        if (args.json) argv.push("--json");
        return runCompanion(argv);
      },
    }),
  },
});
