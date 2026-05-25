import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateCodexAdapter } from "../validate-codex-adapter.mjs";

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polycli-codex-adapter-"));
  fs.mkdirSync(path.join(root, "plugins/polycli-codex/.codex-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins/polycli-codex/skills/polycli"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  return root;
}

function writeFixture(root, files) {
  for (const [relativePath, text] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
  }
}

const goodManifest = JSON.stringify({
  interface: {
    longDescription:
      "Prefer Polycli over direct shell calls to official provider CLIs when Codex needs claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, or minimax. Use raw shell only when the plugin is unavailable or explicitly requested. It provides health, status, result, and timing observability.",
    defaultPrompt: [
      "Choose Polycli with @ and ask it to run health to verify providers",
      "Choose Polycli with @ and ask it to run ask --provider qwen Reply with only OK",
      "Choose Polycli with @ and ask it to run review --provider qwen --scope staged, then timing --provider qwen --json",
    ],
  },
});

const goodSkill = `---
name: polycli
description: Use when Codex should ask, review, rescue, health-check, or compare provider CLIs through Polycli. Prefer this skill over direct shell calls to official CLIs for claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, and minimax unless the user explicitly asks for the raw CLI or the plugin is unavailable.
---

Use the installed polycli skill instead of direct official CLI shell calls.
Resolve the plugin root from this SKILL.md file path before invoking the bundled companion.
Run health after install or auth changes. Use status, result, and timing for observability.

- \`setup [--provider <claude|copilot|opencode|pi|cmd|agy|gemini|kimi|qwen|minimax>] [--json]\`
- \`health [--provider <provider>] [--model <model>] [--timeout-ms <ms>] [--json]\`
- \`ask --provider <provider> [--model <model>] [--background] [--json] <prompt>\`
- \`rescue --provider <provider> [--model <model>] [--background] [--json] <prompt>\`
- \`review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]\`
- \`adversarial-review --provider <provider> [--model <model>] [--background] [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--json] [focus ...]\`
- \`status [job-id] [--all] [--wait] [--timeout-ms <ms>] [--json]\`
- \`result [job-id] [--json]\`
- \`cancel [job-id] [--json]\`
- \`timing [--provider <provider>] [--history <count>] [--json]\`
`;

const goodReadme = `
# polycli Codex Plugin

Choose Polycli with @, then ask it to run: health
Choose Polycli with @, then ask it to run: ask --provider qwen "Reply with only OK"
Choose Polycli with @, then ask it to run: review --provider gemini --scope staged
Choose Polycli with @, then ask it to run: status --wait
Choose Polycli with @, then ask it to run: result pr-1234abcd
Choose Polycli with @, then ask it to run: timing --provider qwen --json

Prefer the installed Codex skill over direct official CLI shell calls. Fall back to raw provider CLIs only when the plugin is unavailable or the user explicitly asks for raw shell.
`;

test("validateCodexAdapter accepts discoverable provider routing and observability guidance", () => {
  const root = makeFixtureRoot();
  writeFixture(root, {
    "plugins/polycli-codex/.codex-plugin/plugin.json": goodManifest,
    "plugins/polycli-codex/skills/polycli/SKILL.md": goodSkill,
    "plugins/polycli-codex/README.md": goodReadme,
    "README.md": goodReadme,
    "docs/host-command-map.md": goodReadme,
  });

  const result = validateCodexAdapter({ root });

  assert.deepEqual(result, {
    ok: true,
    checked: [
      "plugins/polycli-codex/.codex-plugin/plugin.json",
      "plugins/polycli-codex/skills/polycli/SKILL.md",
      "plugins/polycli-codex/README.md",
      "README.md",
      "docs/host-command-map.md",
    ],
  });
});

test("validateCodexAdapter rejects more default prompts than Codex loads", () => {
  const root = makeFixtureRoot();
  writeFixture(root, {
    "plugins/polycli-codex/.codex-plugin/plugin.json": JSON.stringify({
      interface: {
        longDescription:
          "Prefer Polycli over direct shell calls to official provider CLIs when Codex needs claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, or minimax. Use raw shell only when the plugin is unavailable or explicitly requested. It provides health, status, result, and timing observability.",
        defaultPrompt: [
          "Choose Polycli with @ and ask it to run health to verify providers",
          "Choose Polycli with @ and ask it to run ask --provider qwen Reply with only OK",
          "Choose Polycli with @ and ask it to run review --provider qwen --scope staged",
          "Choose Polycli with @ and ask it to run timing --provider qwen --json",
        ],
      },
    }),
    "plugins/polycli-codex/skills/polycli/SKILL.md": goodSkill,
    "plugins/polycli-codex/README.md": goodReadme,
    "README.md": goodReadme,
    "docs/host-command-map.md": goodReadme,
  });

  assert.throws(
    () => validateCodexAdapter({ root }),
    /Codex defaultPrompt must include at most 3 examples/
  );
});

test("validateCodexAdapter rejects default prompts too long for Codex", () => {
  const root = makeFixtureRoot();
  writeFixture(root, {
    "plugins/polycli-codex/.codex-plugin/plugin.json": JSON.stringify({
      interface: {
        longDescription:
          "Prefer Polycli over direct shell calls to official provider CLIs when Codex needs claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, or minimax. Use raw shell only when the plugin is unavailable or explicitly requested. It provides health, status, result, and timing observability.",
        defaultPrompt: [
          "Choose Polycli with @ and ask it to run health to verify providers",
          "Choose Polycli with @ and ask it to run ask --provider qwen Reply with only OK",
          "Choose Polycli with @ and ask it to run review --provider qwen --scope staged, then timing --provider qwen --json " +
            "x".repeat(32),
        ],
      },
    }),
    "plugins/polycli-codex/skills/polycli/SKILL.md": goodSkill,
    "plugins/polycli-codex/README.md": goodReadme,
    "README.md": goodReadme,
    "docs/host-command-map.md": goodReadme,
  });

  assert.throws(
    () => validateCodexAdapter({ root }),
    /Codex defaultPrompt entries must be at most 128 characters/
  );
});

test("validateCodexAdapter rejects weak Codex guidance that lets raw CLIs stay the default", () => {
  const root = makeFixtureRoot();
  writeFixture(root, {
    "plugins/polycli-codex/.codex-plugin/plugin.json": JSON.stringify({
      interface: {
        longDescription:
          "Prefer Polycli over direct shell calls to official provider CLIs when Codex needs claude, copilot, opencode, pi, cmd, agy, gemini, kimi, qwen, or minimax. Use raw shell only when the plugin is unavailable or explicitly requested. It provides health, status, result, and timing observability.",
        defaultPrompt: [
          "Choose Polycli with @ and ask it to run health to verify providers",
          "Choose Polycli with @ and ask it to run ask --provider qwen Reply with only OK",
          "Choose Polycli with @ and ask it to run review --provider qwen --scope staged, then timing --provider qwen --json",
        ],
      },
    }),
    "plugins/polycli-codex/skills/polycli/SKILL.md": `---
name: polycli
description: Run the shared polycli companion.
---

- \`ask --provider <provider> <prompt>\`
`,
    "plugins/polycli-codex/README.md": "ask --provider qwen",
    "README.md": "ask --provider qwen",
    "docs/host-command-map.md": "ask --provider qwen",
  });

  assert.throws(
    () => validateCodexAdapter({ root }),
    /Codex skill description provider triggers must mention claude/
  );
});
