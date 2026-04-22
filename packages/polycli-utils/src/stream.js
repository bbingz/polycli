import { StringDecoder } from "node:string_decoder";

export function createLineDecoder({ encoding = "utf8", stripCarriageReturn = true } = {}) {
  const decoder = new StringDecoder(encoding);
  let buffer = "";

  const normalize = (line) => {
    if (stripCarriageReturn && line.endsWith("\r")) {
      return line.slice(0, -1);
    }
    return line;
  };

  const drain = () => {
    const lines = [];
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      lines.push(normalize(line));
    }
    return lines;
  };

  return {
    push(chunk) {
      if (chunk == null) return [];
      buffer += decoder.write(chunk);
      return drain();
    },
    end() {
      buffer += decoder.end();
      const lines = drain();
      if (buffer.length > 0) {
        lines.push(normalize(buffer));
        buffer = "";
      }
      return lines;
    },
  };
}
