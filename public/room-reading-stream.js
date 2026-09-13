// Transport previews are disposable. Only a complete event can return a result
// to the existing inventory/condition pipeline.
export async function readRoomResponse(response, onPreview) {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", bytes = 0, result, complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) throw new Error("reading-too-large");
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (complete) throw new Error("reading-after-complete");
        if (event.type === "error") throw new Error("reading-failed");
        if (event.type === "preview") {
          const item = event.item;
          if (Number.isInteger(item?.index) && item.index >= 0 && item.index < 40 && typeof item.label === "string" && item.label.length <= 80) {
            onPreview?.({ index: item.index, label: item.label });
          }
        } else if (event.type === "complete" && event.result?.ok === true) {
          result = event.result; complete = true;
        } else throw new Error("reading-invalid-event");
      }
    }
    if (!complete || pending.trim()) throw new Error("reading-incomplete");
    return result;
  } finally {
    try { await reader.cancel(); } catch { /* The request may already be aborted. */ }
    reader.releaseLock();
  }
}
