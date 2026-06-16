import fs from "node:fs";

const PREVIEW_MAX_LINES = 10;
const PREVIEW_TAIL_CACHE = new Map();
const PRIVATE_FILE_MODE = 0o600;

function collapseWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function previewText(text, maxLength = 120) {
  const collapsed = collapseWhitespace(text);
  const points = Array.from(collapsed);
  if (points.length <= maxLength) {
    return collapsed;
  }
  return `${points.slice(0, maxLength - 1).join("")}…`;
}

function summarizeEventText(provider, event) {
  if (!event || typeof event !== "object") return "";

  if (provider === "claude") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (typeof event.text === "string") return event.text;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
      return event.delta.text;
    }
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "copilot") {
    if ((event.type === "result" || event.type === "final") && typeof event.result === "string") return event.result;
    if (event.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string") return event.data.deltaContent;
    if (event.type === "assistant.message" && typeof event.data?.content === "string") return event.data.content;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "gemini") {
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.content === "string") return event.content;
    if (typeof event.text === "string") return event.text;
    if (typeof event.message?.content === "string") return event.message.content;
    return "";
  }

  if (provider === "kimi") {
    if (event.role !== "assistant") return "";
    if (typeof event.content === "string") return event.content;
    if (!Array.isArray(event.content)) return "";
    return event.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "qwen") {
    if (event.type === "result" && event.is_error !== true && event.subtype !== "error" && typeof event.result === "string") {
      return event.result;
    }
    if (event.type !== "assistant" || !Array.isArray(event.message?.content)) return "";
    return event.message.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "minimax") {
    if (event.type === "progress" && typeof event.text === "string") return event.text;
    if (event.type === "result" && typeof event.response === "string") return event.response;
  }

  if (provider === "opencode") {
    if (event.type === "result" && typeof event.text === "string") return event.text;
    if (event.type === "text" && typeof event.part?.text === "string") return event.part.text;
    if (typeof event.delta === "string") return event.delta;
    if (typeof event.text === "string") return event.text;
    if (typeof event.part?.text === "string") return event.part.text;
    const content = event.content ?? event.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  if (provider === "pi") {
    if (event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
      return event.assistantMessageEvent.delta;
    }
    if (event.type === "agent_end" && typeof event.result?.text === "string") return event.result.text;
    if (typeof event.text === "string") return event.text;
  }

  if (provider === "agy") {
    if (event.type === "text_delta" && typeof event.delta === "string") return event.delta;
    if (event.type === "result" && typeof event.text === "string") return event.text;
  }

  return "";
}

export function appendPreview(logFile, provider, event, { fsImpl = fs, tailCache = PREVIEW_TAIL_CACHE } = {}) {
  const text = summarizeEventText(provider, event);
  if (!text) return;
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .slice(0, PREVIEW_MAX_LINES);
  if (lines.length === 0) return;

  const currentTail = tailCache.get(logFile) || [];
  if (currentTail.slice(-lines.length).join("\n") === lines.join("\n")) {
    return;
  }

  fsImpl.appendFileSync(logFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  if (fsImpl === fs) {
    try {
      fs.chmodSync(logFile, PRIVATE_FILE_MODE);
    } catch {
      // best-effort hardening for existing log files
    }
  }
  tailCache.set(logFile, [...currentTail, ...lines].slice(-PREVIEW_MAX_LINES));
}

export function resetPreviewTailCache() {
  PREVIEW_TAIL_CACHE.clear();
}
