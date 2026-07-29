import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A real browser, driven with no dependencies.
//
// Everything else in this repository's scanner coverage is a unit test or a
// source-text assertion. Neither can tell you whether `getUserMedia` resolves,
// whether the canvas pipeline actually produces a frame, whether a selector the
// review panel needs exists in the page, or — the one that matters most —
// whether the redaction genuinely destroys pixels rather than appearing to.
//
// Playwright is not a dependency here and adding one would break the locked
// dependency graph the whole project is gated on. Node 22 ships a WebSocket
// client, so Chromium can be driven over the DevTools Protocol directly. That
// keeps the dependency lock intact and the proof real.
//
// This is NOT a device trial. It is desktop Chromium with a synthetic camera.
// A physical iPhone and Android handset over HTTPS is still required before
// activation, and nothing here substitutes for it.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Returns the reviewed Chromium locations for the current platform.
 *
 * `CHROMIUM_PATH` always wins, so CI and unusual installations stay explicit.
 * The platform fallbacks exist because silently skipping the real camera/canvas
 * proof on a developer machine that already has Chrome is weaker than running
 * it. Discovery never launches a user profile: `launchBrowser` still creates an
 * isolated temporary profile with a synthetic camera.
 */
export function chromiumExecutableCandidates({ env = process.env, platform = process.platform } = {}) {
  const configured = String(env.CHROMIUM_PATH || "").trim();
  const candidates = configured ? [configured] : [];
  if (platform === "win32") {
    // Candidate generation is unit-tested for every platform on every host.
    // Use win32 explicitly so a Linux CI runner still produces valid Windows
    // paths rather than mixing the supplied platform with its own separator.
    const windowsPath = path.win32;
    const programFiles = env.ProgramFiles || env.PROGRAMFILES;
    const programFilesX86 = env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"];
    if (programFiles) candidates.push(windowsPath.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    if (programFilesX86) candidates.push(windowsPath.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
    if (env.LOCALAPPDATA) {
      candidates.push(windowsPath.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(windowsPath.join(env.LOCALAPPDATA, "Chromium", "Application", "chrome.exe"));
    }
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else {
    candidates.push(
      "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }
  return [...new Set(candidates)];
}

export function resolveChromiumPath(options = {}) {
  return chromiumExecutableCandidates(options).find((candidate) => existsSync(candidate)) || "";
}

const mimeTypes = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".svg": "image/svg+xml"
});

/**
 * Serves `public/` plus any extra in-memory pages, on localhost.
 *
 * localhost is a secure context, so `getUserMedia` is available without a
 * certificate. That is the whole reason this can exercise the camera path at all.
 */
export async function serveStatic({ extraFiles = {}, port = 0 } = {}) {
  const publicDir = path.join(projectRoot, "public");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const requested = decodeURIComponent(url.pathname);
    if (Object.hasOwn(extraFiles, requested)) {
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(requested)] || "text/html; charset=utf-8" });
      return response.end(extraFiles[requested]);
    }
    const filePath = path.resolve(publicDir, requested.replace(/^\/+/, "") || "index.html");
    // The harness serves real project files, so it must not become a way to read
    // outside them.
    if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
      response.writeHead(403);
      return response.end("forbidden");
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); }
  };
}

function nextId(state) {
  state.id += 1;
  return state.id;
}

/**
 * Launches Chromium and returns a minimal CDP client.
 *
 * `--use-fake-device-for-media-stream` gives a synthetic camera, and
 * `--use-fake-ui-for-media-stream` auto-grants permission, so the real
 * `getUserMedia` path runs without a human or a webcam.
 */
export async function launchBrowser({ headless = true } = {}) {
  const chromiumPath = resolveChromiumPath();
  if (!chromiumPath) {
    throw new Error("No supported Chromium executable was found. Set CHROMIUM_PATH to run the browser proof.");
  }
  const profile = await mkdtemp(path.join(tmpdir(), "homle-cdp-"));
  const args = [
    headless ? "--headless=new" : "--start-maximized",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    // Required in this container; the harness serves only local project files.
    "--no-sandbox", "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank"
  ];
  const chromium = spawn(chromiumPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not report a DevTools endpoint in time.")), 30_000);
    chromium.stderr.on("data", (chunk) => {
      output += String(chunk);
      const match = /ws:\/\/[^\s]+/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    chromium.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chromium exited early (${code}): ${output.slice(-400)}`)); });
  });

  const socket = new WebSocket(endpoint);
  const state = { id: 0 };
  const pending = new Map();
  const consoleMessages = [];
  const pageErrors = [];

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium.")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      consoleMessages.push({ type: message.params.type, text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ") });
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "unknown error");
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId(state);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out.`)); }
      }, 30_000).unref?.();
    });
  }

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);

  return {
    consoleMessages,
    pageErrors,
    async goto(url) {
      await send("Page.navigate", { url }, sessionId);
      // Polls for readiness rather than racing a lifecycle event, because a
      // module graph can still be loading when the load event fires.
      const deadline = Date.now() + 20_000;
      for (;;) {
        const ready = await this.evaluate("document.readyState");
        if (ready === "complete") return;
        if (Date.now() > deadline) throw new Error(`${url} did not finish loading.`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression: `(async () => { ${expression.includes("return") ? expression : `return (${expression})`} })()`,
        awaitPromise: true, returnByValue: true
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
      }
      return result.result?.value;
    },
    async close() {
      try { socket.close(); } catch {}
      chromium.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
  };
}
