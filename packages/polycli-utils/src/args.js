export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      passthrough = true;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=", 2);
      const rawKey = eqIdx >= 0 ? token.slice(2, eqIdx) : token.slice(2);
      const inlineValue = eqIdx >= 0 ? token.slice(eqIdx + 1) : undefined;
      const key = aliasMap[rawKey] ?? rawKey;

      if (booleanOptions.has(key)) {
        if (inlineValue === "") {
          throw new Error(`Invalid boolean value for --${rawKey}`);
        }
        options[key] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      if (valueOptions.has(key)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === undefined) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key] = nextValue;
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      positionals.push(token);
      continue;
    }

    const shortToken = token.slice(1);
    const shortKey = shortToken[0];
    const inlineShortValue = shortToken.length > 1 ? shortToken.slice(1) : undefined;
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      if (inlineShortValue !== undefined) {
        positionals.push(token);
        continue;
      }
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      const nextValue = inlineShortValue ?? argv[index + 1];
      if (nextValue === undefined) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      if (inlineShortValue === undefined) {
        index += 1;
      }
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals };
}

export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const character of raw) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      if (quote === "'") {
        current += character;
        continue;
      }
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    throw new Error("Trailing escape in raw argument string");
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in raw argument string`);
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
