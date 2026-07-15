import fs from "node:fs";

// Executable snapshot of the pre-Gate-B readers' additive behavior. These deliberately do not
// normalize the new identity fields: the rollback proof is that the old code can parse and retain
// a v2 state/job/event without a destructive migration.
export function readStateWithPreGateBReader(stateFile) {
  const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.jobs)) {
    return { version: 1, config: {}, jobs: [] };
  }
  return {
    version: parsed.version ?? 1,
    config: parsed.config && typeof parsed.config === "object" ? parsed.config : {},
    jobs: parsed.jobs,
  };
}

export function readLedgerWithPreGateBReader(ledgerFile) {
  return fs.readFileSync(ledgerFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}
