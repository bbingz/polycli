import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function assertLocalPluginEntry(marketplace, expected) {
  const plugin = marketplace.plugins.find((candidate) => candidate.name === expected.name);
  assert.ok(plugin, `missing marketplace entry for ${expected.name}`);
  if (typeof expected.source === "string") {
    assert.equal(plugin.source, expected.source);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, expected.source)), true);
    return;
  }

  assert.equal(plugin.source?.source, "local");
  assert.equal(plugin.source?.path, expected.path);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, expected.path)), true);
}

function assertNoPluginEntry(marketplace, name) {
  const plugin = marketplace.plugins.find((candidate) => candidate.name === name);
  assert.equal(plugin, undefined, `unexpected marketplace entry for ${name}`);
}

test("host marketplace files exist and are valid JSON", () => {
  const codexMarketplace = readJson(".agents/plugins/marketplace.json");
  const copilotMarketplace = readJson(".github/plugin/marketplace.json");
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");

  assert.equal(Array.isArray(codexMarketplace.plugins), true);
  assert.equal(Array.isArray(copilotMarketplace.plugins), true);
  assert.equal(Array.isArray(claudeMarketplace.plugins), true);

  assertLocalPluginEntry(codexMarketplace, { name: "polycli-codex", path: "./plugins/polycli-codex" });
  assertLocalPluginEntry(copilotMarketplace, { name: "polycli-copilot", source: "./plugins/polycli-copilot" });
  assertLocalPluginEntry(claudeMarketplace, { name: "polycli", source: "./plugins/polycli" });
  assertNoPluginEntry(claudeMarketplace, "polycli-copilot");
});

test("host plugin manifests exist", () => {
  const codexManifest = readJson("plugins/polycli-codex/.codex-plugin/plugin.json");
  const copilotManifest = readJson("plugins/polycli-copilot/plugin.json");
  const opencodePackage = readJson("plugins/polycli-opencode/package.json");

  assert.equal(codexManifest.name, "polycli-codex");
  assert.equal(copilotManifest.name, "polycli-copilot");
  assert.equal(opencodePackage.name, "@bbingz/polycli-opencode");
});

test("release-facing marketplace versions stay aligned with host manifests", () => {
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
  const copilotMarketplace = readJson(".github/plugin/marketplace.json");
  const claudeManifest = readJson("plugins/polycli/.claude-plugin/plugin.json");
  const copilotManifest = readJson("plugins/polycli-copilot/plugin.json");

  assert.equal(claudeMarketplace.metadata.version, claudeManifest.version);
  assert.equal(copilotMarketplace.metadata.version, copilotManifest.version);

  const claudePlugin = claudeMarketplace.plugins.find((candidate) => candidate.name === "polycli");
  const copilotPlugin = copilotMarketplace.plugins.find((candidate) => candidate.name === "polycli-copilot");

  assert.equal(claudePlugin?.version, claudeManifest.version);
  assertNoPluginEntry(claudeMarketplace, "polycli-copilot");
  assert.equal(copilotPlugin?.version, copilotManifest.version);
});

test("host adapter entry files exist", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-codex/skills/polycli/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-copilot/skills/polycli/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, ".opencode/plugins/polycli.mjs")), true);
});

test("Claude command frontmatter advertises installed selector, wait, cursor, and JSON v2 syntax", () => {
  const expectedHints = new Map([
    ["setup.md", ["--json-v2"]],
    ["debug.md", ["tail", "--after", "--limit", "--wait", "--json-v2"]],
    ["status.md", ["--job", "--for", "--json-v2"]],
    ["result.md", ["--job", "--json-v2"]],
    ["cancel.md", ["--job", "--json-v2"]],
  ]);
  for (const [file, tokens] of expectedHints) {
    const frontmatter = fs.readFileSync(path.join(REPO_ROOT, "plugins/polycli/commands", file), "utf8")
      .split("---", 3)[1];
    for (const token of tokens) {
      assert.match(frontmatter, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file}: ${token}`);
    }
  }

  const setupCommand = fs.readFileSync(path.join(REPO_ROOT, "plugins/polycli/commands/setup.md"), "utf8");
  assert.doesNotMatch(setupCommand, /if \[\[/);
  assert.match(setupCommand, /setup "\$ARGUMENTS"/);
  assert.doesNotMatch(setupCommand, /setup --json "\$ARGUMENTS"/);
});

test("Codex and Copilot skill command signatures advertise JSON v2 on every operational command", () => {
  const skillFiles = [
    "plugins/polycli-codex/skills/polycli/SKILL.md",
    "plugins/polycli-copilot/skills/polycli/SKILL.md",
  ];
  const operationalCommands = [
    "setup", "health", "ask", "rescue", "review", "adversarial-review",
    "status", "result", "cancel", "timing", "debug", "sessions",
  ];
  for (const relativePath of skillFiles) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8").split("\n");
    for (const command of operationalCommands) {
      const line = lines.find((entry) => entry.startsWith(`- \`${command} `));
      assert.ok(line, `${relativePath}: missing ${command}`);
      assert.match(line, /--json-v2/, `${relativePath}: ${command}`);
    }
  }
});

test("bundled companion entry files exist for all hosts", () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "packages/polycli-terminal/bin/polycli-companion.bundle.mjs")), true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "packages/polycli-terminal/bin/polycli.mjs")), true);
});

test("bundled companions execute with usage output", () => {
  const bundles = [
    "plugins/polycli/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-codex/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs",
    "plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs",
    "packages/polycli-terminal/bin/polycli-companion.bundle.mjs",
  ];

  for (const relativePath of bundles) {
    const stdout = execFileSync(process.execPath, [path.join(REPO_ROOT, relativePath)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(stdout, /Usage:/);
  }
});

test("all bundled companions expose deterministic offline agent context with release identity", () => {
  const version = readJson("packages/polycli-terminal/package.json").version;
  const cases = [
    ["plugins/polycli/scripts/polycli-companion.bundle.mjs", "claude-plugin", { CLAUDE_PLUGIN_ROOT: path.join(REPO_ROOT, "plugins/polycli") }],
    ["plugins/polycli-codex/scripts/polycli-companion.bundle.mjs", "codex-skill", {}],
    ["plugins/polycli-copilot/scripts/polycli-companion.bundle.mjs", "copilot-skill", {}],
    ["plugins/polycli-opencode/scripts/polycli-companion.bundle.mjs", "opencode-plugin", {}],
    ["packages/polycli-terminal/bin/polycli-companion.bundle.mjs", "terminal", { POLYCLI_HOST_SURFACE: "terminal" }],
  ];
  const stateRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "polycli-agent-context-bundles-")), "absent-state");
  try {
    for (const [relativePath, hostSurface, extraEnv] of cases) {
      const run = () => execFileSync(
        process.execPath,
        [path.join(REPO_ROOT, relativePath), "agent-context", "--json"],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: {
            ...process.env,
            CLAUDE_PLUGIN_DATA: stateRoot,
            ...extraEnv,
          },
        },
      );
      const first = run();
      assert.equal(run(), first, `${hostSurface} context must be byte-stable`);
      const context = JSON.parse(first);
      assert.equal(context.build.version, version);
      assert.equal(context.build.versionSource, "bundled-release");
      assert.equal(context.hostSurface, hostSurface);
      assert.equal(context.offline, true);
      assert.equal(context.commands.some((entry) => entry.id === "tui"), hostSurface === "terminal");
    }
    assert.equal(fs.existsSync(stateRoot), false);
  } finally {
    fs.rmSync(path.dirname(stateRoot), { recursive: true, force: true });
  }
});

test("opencode adapter exports a plugin function", async () => {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "plugins/polycli-opencode/index.mjs")).href;
  const module = await import(moduleUrl);

  assert.equal(typeof module.PolycliPlugin, "function");
  const plugin = await module.PolycliPlugin();
  assert.equal(typeof plugin, "object");
  assert.equal(typeof plugin.tool.polycli_run.execute, "function");
  assert.equal(typeof plugin.tool.polycli_timing.execute, "function");
});

test("opencode adapter rejects non-zero companion status even when stdout has structured JSON", async () => {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "plugins/polycli-opencode/index.mjs")).href;
  const module = await import(moduleUrl);
  const plugin = await module.PolycliPlugin();

  await assert.rejects(
    () => plugin.tool.polycli_run.execute({
      argv: ["timing", "--provider", "definitely-not-a-provider", "--json"],
    }),
    (error) => {
      assert.notEqual(error.status, 0);
      const payload = JSON.parse(error.stdout);
      assert.equal(payload.code, "unknown_provider");
      assert.match(payload.error, /definitely-not-a-provider/);
      return true;
    },
  );
});

test("opencode package resolves through node package resolution", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-opencode-pkg-"));
  const scopeDir = path.join(tempRoot, "node_modules", "@bbingz");
  const packageDir = path.join(scopeDir, "polycli-opencode");
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugins/polycli-opencode"), packageDir, "dir");

  try {
    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          "import { PolycliPlugin } from '@bbingz/polycli-opencode';",
          "const plugin = await PolycliPlugin();",
          "const output = await plugin.tool.polycli_timing.execute({ json: true });",
          "console.log(output);",
        ].join("\n"),
      ],
      {
        cwd: tempRoot,
        encoding: "utf8",
      }
    );

    const payload = JSON.parse(stdout);
    assert.ok(Array.isArray(payload.records));
    assert.equal(typeof payload.aggregate, "object");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
