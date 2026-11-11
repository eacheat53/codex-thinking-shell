#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectThinkingSoftWrap } from "./cdp-css-inject.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function locateDesktopBinary() {
  const candidates = [
    "/usr/lib/chatgpt/ChatGPT",
    "/usr/bin/chatgpt",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  throw new Error("Could not locate Codex Desktop executable (/usr/lib/chatgpt/ChatGPT)");
}

export function locateStockCodex() {
  const candidate = "/usr/lib/chatgpt/resources/codex";
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error("Could not locate official Codex CLI (/usr/lib/chatgpt/resources/codex)");
}

export async function launchCodexThinkingDesktop(argv = process.argv.slice(2)) {
  const isDetach = argv.includes("--detach") || argv.includes("-d") || !process.stdout.isTTY;
  const filteredArgs = argv.filter((a) => a !== "--detach" && a !== "-d");

  const desktopBinary = locateDesktopBinary();
  const stockCodex = locateStockCodex();
  const shimPath = path.resolve(__dirname, "../bin/codex-thinking-shim");

  if (!fs.existsSync(shimPath)) {
    throw new Error(`Shim executable not found at: ${shimPath}`);
  }

  // Check if Desktop is already running; if so, terminate it cleanly to apply shim & debug port
  try {
    const runningPids = execSync("pgrep -f '/usr/lib/chatgpt/ChatGPT' || true", {
      encoding: "utf8",
    }).trim();
    if (runningPids) {
      if (process.stdout.isTTY) {
        console.log("[codex-thinking-shell] Closing existing Codex Desktop instance...");
      }
      execSync("pkill -TERM -f '/usr/lib/chatgpt/ChatGPT' || true");
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch {}

  const debugPort = Number(process.env.CODEX_DEBUG_PORT || 43888);

  const isWayland = Boolean(
    process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland",
  );
  const waylandArgs = isWayland
    ? [
        "--ozone-platform=wayland",
        "--enable-wayland-ime",
        "--wayland-text-input-version=3",
      ]
    : [];

  const desktopArgs = [
    `--remote-debugging-port=${debugPort}`,
    ...waylandArgs,
    ...filteredArgs,
  ];

  const env = {
    ...process.env,
    CODEX_CLI_PATH: shimPath,
    CODEX_STOCK_CLI_PATH: stockCodex,
  };

  if (process.stdout.isTTY) {
    console.log(`[codex-thinking-shell] Starting Codex Desktop with Thinking Shell shim...`);
    console.log(`[codex-thinking-shell] Desktop: ${desktopBinary}`);
    console.log(`[codex-thinking-shell] Stock CLI: ${stockCodex}`);
    console.log(`[codex-thinking-shell] Shim: ${shimPath}`);
  }

  const desktopProcess = spawn(desktopBinary, desktopArgs, {
    env,
    stdio: isDetach ? "ignore" : "inherit",
    detached: true,
  });

  // Background injection of soft-wrap CSS via CDP
  const injectionPromise = injectThinkingSoftWrap(debugPort, 40, 400).then((success) => {
    if (success && process.stdout.isTTY) {
      console.log(`[codex-thinking-shell] Successfully injected soft-wrap styles into Codex Desktop.`);
    } else if (!success && process.stdout.isTTY) {
      console.warn(`[codex-thinking-shell] CDP soft-wrap injection timed out. (Thinking shell will still work with default wrapping)`);
    }
    return success;
  });

  // Ignore SIGHUP so terminal closure will NOT kill Codex Desktop
  process.on("SIGHUP", () => {
    // Intentionally no-op to allow Desktop to survive terminal exit
  });

  process.on("SIGINT", () => {
    try {
      desktopProcess.kill("SIGINT");
    } catch {}
  });
  process.on("SIGTERM", () => {
    try {
      desktopProcess.kill("SIGTERM");
    } catch {}
  });

  desktopProcess.on("exit", (code, signal) => {
    if (!isDetach) {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 0);
      }
    }
  });

  if (isDetach) {
    // Wait for CSS injection, then unref and exit parent process cleanly
    await injectionPromise;
    desktopProcess.unref();
    if (process.stdout.isTTY) {
      console.log(`[codex-thinking-shell] Desktop is running in background (PID: ${desktopProcess.pid}).`);
    }
    process.exit(0);
  }

  return desktopProcess;
}

if (process.argv[1] === __filename) {
  launchCodexThinkingDesktop().catch((err) => {
    console.error(`[codex-thinking-shell] Error: ${err.message}`);
    process.exit(1);
  });
}
