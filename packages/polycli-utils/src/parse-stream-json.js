function findJsonStart(text) {
  for (let index = 0; index < text.length; index += 1) {
    const slice = text.slice(index);
    const character = text[index];
    if (character === "{" || character === "[" || character === '"' || character === "-" || /\d/.test(character)) {
      return index;
    }
    if (slice.startsWith("true") || slice.startsWith("false") || slice.startsWith("null")) {
      return index;
    }
  }
  return -1;
}

export function parseStreamJsonLine(raw, { allowPrefix = true } = {}) {
  const text = String(raw ?? "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, kind: "blank", raw: text };
  }

  let jsonCandidate = trimmed;
  let prefix = "";

  if (allowPrefix) {
    const jsonStart = findJsonStart(text);
    if (jsonStart < 0) {
      return { ok: false, kind: "non_json", raw: text };
    }
    prefix = text.slice(0, jsonStart);
    jsonCandidate = text.slice(jsonStart).trim();
  } else if (
    !trimmed.startsWith("{")
    && !trimmed.startsWith("[")
    && !trimmed.startsWith('"')
    && !trimmed.startsWith("-")
    && !/^\d/.test(trimmed)
    && !trimmed.startsWith("true")
    && !trimmed.startsWith("false")
    && !trimmed.startsWith("null")
  ) {
    return { ok: false, kind: "non_json", raw: text };
  }

  try {
    return {
      ok: true,
      raw: text,
      prefix,
      json: jsonCandidate,
      event: JSON.parse(jsonCandidate),
    };
  } catch (error) {
    return {
      ok: false,
      kind: "parse_error",
      raw: text,
      prefix,
      json: jsonCandidate,
      error: error.message,
    };
  }
}

export function parseStreamJsonText(text, options = {}) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => parseStreamJsonLine(line, options));
}
