#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const COMPANION = resolve(
  REPO_ROOT,
  "plugins/polycli/scripts/polycli-companion.bundle.mjs",
);
const RESULTS_DIR = resolve(REPO_ROOT, "docs/benchmarks");
const PROBING_COST_FILE = resolve(RESULTS_DIR, "probing-cost.json");

const TASKS = {
  ask: "In one sentence: what is the difference between TCP and UDP?",
  review: `Review this JavaScript code. List findings ordered by severity (critical/high/medium/low). For each finding give: line number, issue, suggested fix. End with a one-line verdict.

\`\`\`js
async function getUserOrders(userIds) {
  const orders = []
  for (const id of userIds) {
    const userOrders = db.query(\`SELECT * FROM orders WHERE user_id = \${id}\`)
    orders.push(userOrders)
  }
    return orders
}

function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i].price
  }
  return total
}
\`\`\``,
  rescue: `Investigate this Node.js error and propose a minimal fix.

Error log:
\`\`\`
TypeError: Cannot read properties of undefined (reading 'name')
    at processItems (/app/src/handler.js:4:25)
    at /app/src/handler.js:11:1
\`\`\`

Source /app/src/handler.js:
\`\`\`js
function processItems(items) {
  for (let i = 0; i <= items.length; i++) {
    if (items[i].name.length > 3) {
      console.log(items[i].name);
    }
  }
}

const data = [{name: 'alice'}, {name: 'bob'}, null];
processItems(data);
\`\`\`

Identify the root cause(s) and propose a minimal patch.`,
};

const PROVIDERS = ["gemini", "qwen"];
const SCENARIOS = ["ask", "review", "rescue"];

const POLYCLI_COMMAND_FOR_SCENARIO = {
  ask: "ask",
  review: "ask",
  rescue: "rescue",
};
const RUNS_PER_CELL = Number(process.env.BENCH_RUNS ?? 3);

function execCmd(cmd, args, options = {}) {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(cmd, args, { ...options });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", rejectP);
    proc.on("close", (code) => resolveP({ code, stdout, stderr }));
  });
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function utf8Bytes(s) {
  return Buffer.byteLength(s ?? "", "utf-8");
}

async function runBareShell(provider, prompt) {
  const start = Date.now();
  const { stdout, stderr, code } = await execCmd(provider, ["-p", prompt]);
  const elapsedMs = Date.now() - start;
  return {
    path: "bare-shell",
    provider,
    boundaryBytes: utf8Bytes(stdout),
    boundaryChars: [...stdout].length,
    elapsedMs,
    exitCode: code,
    stderrSnippet: stderr.slice(0, 300),
    rawOutput: stdout,
  };
}

async function runPolycli(provider, scenario, prompt) {
  const start = Date.now();
  const command = POLYCLI_COMMAND_FOR_SCENARIO[scenario] ?? "ask";
  const args = [COMPANION, command, "--provider", provider, "--json", prompt];
  const { stdout, stderr, code } = await execCmd("node", args);
  const elapsedMs = Date.now() - start;
  let response = "";
  let parseError = null;
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(stdout);
    response =
      parsedJson.response ??
      parsedJson.result?.response ??
      parsedJson.error ??
      JSON.stringify(parsedJson);
  } catch (err) {
    parseError = String(err);
    response = stdout;
  }
  return {
    path: "polycli",
    provider,
    command,
    boundaryBytes: utf8Bytes(response),
    boundaryChars: [...response].length,
    elapsedMs,
    exitCode: code,
    stderrSnippet: stderr.slice(0, 300),
    parseError,
    rawStdout: stdout,
    rawParsedJson: parsedJson,
    extractedResponse: response,
  };
}

async function loadProbingCost() {
  if (!existsSync(PROBING_COST_FILE)) {
    return { collected: false, perProvider: {} };
  }
  try {
    const raw = await readFile(PROBING_COST_FILE, "utf-8");
    return { collected: true, ...JSON.parse(raw) };
  } catch (err) {
    return { collected: false, perProvider: {}, loadError: String(err) };
  }
}

function summarizeRuns(runs) {
  const bytes = runs.map((r) => r.boundaryBytes);
  const elapsed = runs.map((r) => r.elapsedMs);
  return {
    medianBytes: median(bytes),
    medianElapsedMs: median(elapsed),
    minBytes: Math.min(...bytes),
    maxBytes: Math.max(...bytes),
    minElapsedMs: Math.min(...elapsed),
    maxElapsedMs: Math.max(...elapsed),
    runs: runs.length,
    failures: runs.filter((r) => r.exitCode !== 0).length,
  };
}

function pct(a, b) {
  if (b === 0) return "n/a";
  return `${(((a - b) / b) * 100).toFixed(1)}%`;
}

function buildMarkdown({ generatedAt, runsPerCell, probingCost, results }) {
  const lines = [];
  lines.push("# Benchmark: polycli vs bare-shell CLI invocation");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Runs per cell: ${runsPerCell} (median reported)`);
  lines.push(`Spec: \`tasks/bench-vs-bare-cli-spec.md\``);
  lines.push("");
  lines.push("## Disclaimer");
  lines.push("");
  lines.push(
    "Byte ranking does not equal token ranking. Code, CJK text, and tool metadata tokenize at different rates. The relative byte ratio is robust; absolute token estimates are not.",
  );
  lines.push("");
  lines.push(
    "Path (b) disciplined-bare-shell is **not measured here** — it requires programmatic Claude invocation (Anthropic SDK), which the repo does not yet wire up. Path (a) is the lower bound; path (c) is polycli.",
  );
  lines.push("");

  lines.push("## Probing cost (manual collection)");
  lines.push("");
  if (!probingCost.collected) {
    lines.push(
      "**Not yet collected.** Run a fresh Claude conversation, ask it to invoke each provider via shell, and record total bytes pulled into context before the actual invocation lands. Save to `docs/benchmarks/probing-cost.json`.",
    );
  } else {
    lines.push("| Provider | Probing-cost bytes | Notes |");
    lines.push("|---|---|---|");
    for (const [provider, info] of Object.entries(
      probingCost.perProvider ?? {},
    )) {
      lines.push(
        `| ${provider} | ${info.bytes ?? "?"} | ${info.notes ?? ""} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    "Probing cost applies to path (a) bare-shell only; polycli encapsulates invocation knowledge.",
  );
  lines.push("");

  lines.push("## Results");
  lines.push("");
  for (const scenario of SCENARIOS) {
    lines.push(`### Scenario: ${scenario}`);
    lines.push("");
    lines.push(
      "| Provider | Path | Median bytes | Median ms | Min/Max bytes | Failures |",
    );
    lines.push("|---|---|---|---|---|---|");
    for (const provider of PROVIDERS) {
      const cell = results[provider]?.[scenario];
      if (!cell) continue;
      const bare = cell.bareShell;
      const poly = cell.polycli;
      const probing = probingCost.perProvider?.[provider]?.bytes ?? 0;
      const bareWithProbe = bare.medianBytes + probing;
      lines.push(
        `| ${provider} | (a) bare-shell${probing ? " + probe" : ""} | ${bareWithProbe} | ${bare.medianElapsedMs} | ${bare.minBytes}-${bare.maxBytes} | ${bare.failures}/${bare.runs} |`,
      );
      lines.push(
        `| ${provider} | (c) polycli | ${poly.medianBytes} | ${poly.medianElapsedMs} | ${poly.minBytes}-${poly.maxBytes} | ${poly.failures}/${poly.runs} |`,
      );
      const delta = pct(poly.medianBytes, bareWithProbe);
      lines.push(`| ${provider} | **Δ (c vs a)** | ${delta} | | | |`);
    }
    lines.push("");
  }

  lines.push("## How to read this");
  lines.push("");
  lines.push(
    "- **Path (a) bare-shell**: full `<provider> -p` stdout enters parent context. Probing cost (per `probing-cost.json`) is added to represent the realistic cold-start: Claude must first probe `--help` and discover invocation flags before this call works.",
  );
  lines.push(
    "- **Path (c) polycli**: `polycli-companion.bundle.mjs <command>` extracts the `.response` field from the provider's structured output. Probing cost is zero — companion encapsulates invocation knowledge.",
  );
  lines.push(
    "- A negative Δ means polycli reduces parent-context bytes vs the realistic bare-shell baseline.",
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- The `review` scenario uses polycli's `ask` command (not `review`), because `polycli-companion review` operates on git diff state and is not parametrizable for a fixed task. The bench's `review` task is a self-contained code blob, and `ask` is the equivalent invocation path. This makes the comparison fair (same one-shot prompt mechanism on both sides) at the cost of bypassing polycli's review-specific finding extraction.",
  );
  lines.push(
    "- **Pre-probing-cost boundary bytes vary per cell.** Without adding probing cost, polycli does not uniformly reduce output bytes — magnitude and direction vary, sometimes in polycli's favor, sometimes against. Polycli's advantage is invocation-knowledge encapsulation, not output compression. Probing cost is what makes path (a) systematically worse on a cold start.",
  );
  lines.push(
    "- Rare 0-byte polycli runs may indicate an empty `.response` field from a transient provider issue (auth, rate-limit, parse). Raw stdout for each run is preserved in the JSON for post-hoc diagnosis.",
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  if (!existsSync(COMPANION)) {
    console.error(`companion bundle not found: ${COMPANION}`);
    console.error("run `npm run build:plugins` first.");
    process.exit(1);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const probingCost = await loadProbingCost();

  const results = {};
  for (const provider of PROVIDERS) {
    results[provider] = {};
    for (const scenario of SCENARIOS) {
      console.error(`\n[${provider}/${scenario}] starting ${RUNS_PER_CELL} runs...`);
      const bareRuns = [];
      const polycliRuns = [];
      for (let i = 0; i < RUNS_PER_CELL; i++) {
        process.stderr.write(`  run ${i + 1}/${RUNS_PER_CELL}: bare... `);
        const bare = await runBareShell(provider, TASKS[scenario]);
        process.stderr.write(`${bare.boundaryBytes}B/${bare.elapsedMs}ms`);
        if (bare.exitCode !== 0) process.stderr.write(` [exit=${bare.exitCode}]`);
        process.stderr.write(", polycli... ");
        const poly = await runPolycli(provider, scenario, TASKS[scenario]);
        process.stderr.write(`${poly.boundaryBytes}B/${poly.elapsedMs}ms`);
        if (poly.exitCode !== 0) process.stderr.write(` [exit=${poly.exitCode}]`);
        process.stderr.write("\n");
        bareRuns.push(bare);
        polycliRuns.push(poly);
      }
      results[provider][scenario] = {
        bareShell: summarizeRuns(bareRuns),
        polycli: summarizeRuns(polycliRuns),
        rawBare: bareRuns,
        rawPolycli: polycliRuns,
      };
    }
  }

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10);
  const jsonPath = resolve(RESULTS_DIR, `results-${date}.json`);
  const mdPath = resolve(RESULTS_DIR, `results-${date}.md`);

  const json = {
    generatedAt,
    spec: "tasks/bench-vs-bare-cli-spec.md",
    runsPerCell: RUNS_PER_CELL,
    probingCost,
    results,
  };
  await writeFile(jsonPath, JSON.stringify(json, null, 2));
  await writeFile(
    mdPath,
    buildMarkdown({ generatedAt, runsPerCell: RUNS_PER_CELL, probingCost, results }),
  );

  console.error(`\nWrote ${jsonPath}`);
  console.error(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
