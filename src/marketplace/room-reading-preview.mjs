// A provisional identity preview, never a cleaning assessment or saved result.
// Only complete objects inside the root detections array are considered. Parsing
// a closed copy of the prefix handles escaped strings without repairing JSON.
export function createReadingPreview(onItem) {
  let buffer = "", quoted = false, escaped = false, disabled = false, emitted = 0;
  const stack = [];
  return Object.freeze({
    push(chunk) {
      if (disabled || typeof chunk !== "string") return;
      if (buffer.length + chunk.length > 65536) { disabled = true; buffer = ""; return; }
      const start = buffer.length;
      buffer += chunk;
      for (let i = start; i < buffer.length; i++) {
        const c = buffer[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
          continue;
        }
        if (c === '"') { quoted = true; continue; }
        if (c === "{" || c === "[") { stack.push(c); continue; }
        if (c !== "}" && c !== "]") continue;
        if (c === "}" && stack.join("") === "{[{") {
          let prefix;
          try { prefix = JSON.parse(buffer.slice(0, i + 1) + "]}"); } catch { prefix = null; }
          if (Array.isArray(prefix?.detections)) {
            for (; emitted < Math.min(40, prefix.detections.length); emitted++) {
              const item = prefix.detections[emitted];
              if (!item || typeof item.label !== "string" || !item.label.trim() || item.label.length > 80) continue;
              if (!Number.isFinite(item.labelConfidence) || item.labelConfidence < 0.5 || item.labelConfidence > 1) continue;
              if (!["x", "y", "width", "height"].every(key => Number.isFinite(item[key]))) continue;
              if (item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0 || item.x + item.width > 100 || item.y + item.height > 100) continue;
              // Do not spread provider fields: condition, tasks, evidence and
              // arbitrary fields must never escape through a preview callback.
              const preview = Object.freeze({ index: emitted, label: item.label.trim(), labelConfidence: item.labelConfidence,
                x: item.x, y: item.y, width: item.width, height: item.height });
              try { onItem(preview); } catch { /* Preview cannot break final validation. */ }
            }
          }
        }
        if (stack.pop() !== (c === "}" ? "{" : "[")) { disabled = true; buffer = ""; return; }
      }
    }
  });
}
