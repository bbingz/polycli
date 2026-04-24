import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tool } from "@opencode-ai/plugin";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "./scripts/polycli-companion.bundle.mjs");

function runCompanion(argv) {
  return execFileSync(process.execPath, [COMPANION, ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

export const PolycliPlugin = async () => ({
  tool: {
    polycli_run: tool({
      description: "Run a polycli companion subcommand such as setup, health, ask, rescue, review, adversarial-review, status, result, cancel, or timing.",
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
