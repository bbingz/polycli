export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const strict = config.unknownOptionMode === "error" || config.rejectDuplicateOptions === true;
  const seenOptions = new Set();
  const options = {};
  const positionals = [];
  let passthrough = false;

  function argumentError(argument, message) {
    const error = new Error(message);
    error.code = "invalid_argument";
    error.data = { argument };
    return error;
  }

  function isRegisteredOption(token) {
    if (token === "--" || !token.startsWith("-") || token === "-") {
      return false;
    }

    const rawKey = token.startsWith("--")
      ? token.slice(2).split("=", 1)[0]
      : token[1];
    const key = token.startsWith("--") && strict ? rawKey : (aliasMap[rawKey] ?? rawKey);
    return booleanOptions.has(key) || valueOptions.has(key);
  }

  function rejectDuplicateOption(key, argument) {
    if (config.rejectDuplicateOptions === true && seenOptions.has(key)) {
      throw argumentError(argument, `Duplicate option ${argument}`);
    }
    seenOptions.add(key);
  }

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
      const key = strict ? rawKey : (aliasMap[rawKey] ?? rawKey);

      if (booleanOptions.has(key)) {
        rejectDuplicateOption(key, token);
        if (inlineValue === "") {
          if (strict) {
            throw argumentError(token, `Invalid boolean value for --${rawKey}`);
          }
          throw new Error(`Invalid boolean value for --${rawKey}`);
        }
        if (strict && inlineValue !== undefined && inlineValue !== "true" && inlineValue !== "false") {
          throw argumentError(token, `Invalid boolean value for --${rawKey}`);
        }
        options[key] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      if (valueOptions.has(key)) {
        rejectDuplicateOption(key, token);
        const nextValue = inlineValue ?? argv[index + 1];
        if (
          nextValue === undefined
          || (strict && inlineValue === undefined && (nextValue === "--" || isRegisteredOption(nextValue)))
        ) {
          if (strict) {
            throw argumentError(token, `Missing value for --${rawKey}`);
          }
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key] = nextValue;
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      if (config.unknownOptionMode === "error") {
        throw argumentError(token, `Unknown option ${token}`);
      }
      positionals.push(token);
      continue;
    }

    const shortToken = token.slice(1);
    const shortKey = shortToken[0];
    const inlineShortValue = shortToken.length > 1 ? shortToken.slice(1) : undefined;
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      rejectDuplicateOption(key, token);
      if (inlineShortValue !== undefined) {
        if (strict && (inlineShortValue === "=true" || inlineShortValue === "=false")) {
          options[key] = inlineShortValue === "=true";
          continue;
        }
        if (strict) {
          throw argumentError(token, `Invalid boolean value for -${shortKey}`);
        }
        positionals.push(token);
        continue;
      }
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      rejectDuplicateOption(key, token);
      const nextValue = inlineShortValue ?? argv[index + 1];
      if (
        nextValue === undefined
        || (strict && inlineShortValue === undefined && (nextValue === "--" || isRegisteredOption(nextValue)))
      ) {
        if (strict) {
          throw argumentError(token, `Missing value for -${shortKey}`);
        }
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      if (inlineShortValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (config.unknownOptionMode === "error") {
      throw argumentError(token, `Unknown option ${token}`);
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
  let tokenStarted = false;

  for (const character of raw) {
    if (escaping) {
      current += character;
      tokenStarted = true;
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
        tokenStarted = true;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += character;
    tokenStarted = true;
  }

  if (escaping) {
    throw new Error("Trailing escape in raw argument string");
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in raw argument string`);
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}
