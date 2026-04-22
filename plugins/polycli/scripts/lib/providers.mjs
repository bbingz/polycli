import { PROVIDER_IDS } from "@bbingz/polycli-runtime";

export { PROVIDER_IDS };

export function resolveProvider({ provider, positionals = [] } = {}) {
  const explicit = provider?.trim();
  if (explicit) {
    if (!PROVIDER_IDS.includes(explicit)) {
      throw new Error(`Unknown provider '${explicit}'. Expected one of: ${PROVIDER_IDS.join(", ")}`);
    }
    return { provider: explicit, remainingPositionals: positionals };
  }

  const [first, ...rest] = positionals;
  if (PROVIDER_IDS.includes(first)) {
    return { provider: first, remainingPositionals: rest };
  }

  throw new Error(`Missing provider. Pass --provider <${PROVIDER_IDS.join("|")}> or use one as the first argument.`);
}
