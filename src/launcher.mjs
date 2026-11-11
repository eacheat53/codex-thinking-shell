#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { injectThinkingSoftWrap } from "./cdp-css-inject.mjs";
import { resolveStockCodex } from "./shim.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function locateDesktopBinary() {
  if (process.env.CODEX_DESKTOP_PATH && fs.existsSync(process.env.CODEX_DESKTOP_PATH)) {
    return process.env.CODEX_DESKTOP_PATH;
  }

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  const candidates = [];

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    candidates.push(
      path.join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
      path.join(programFiles, "ChatGPT", "ChatGPT.exe"),
      path.join(programFiles, "OpenAI", "ChatGPT", "ChatGPT.exe"),
    );
  } else if (isMac) {
    candidates.push(
      "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      "/Applications/Codex.app/Contents/MacOS/Codex",
      path.join(os.homedir(), "Applications/ChatGPT.app/Contents/MacOS/ChatGPT"),
    );
  } else {
    candidates.push(
      "/usr/lib/chatgpt/ChatGPT",
      "/usr/bin/chatgpt",
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }

  throw new Error("Could not locate Codex Desktop executable. Set CODEX_DESKTOP_PATH if installed in custom path.");
}

export function locateStockCodexCli() {
  return resolveStockCodex();
}

function terminateRunningDesktop() {
  const isWindows = process.platform === "win32";
  try {
    if (isWindows) {
      execSync("taskkill /F /IM ChatGPT.exe 2>nul || exit 0", { stdio: "ignore" });
    } else {
      const running = execSync("pgrep -f 'ChatGPT' || true", { encoding: "utf8" }).trim();
      if (running) {
        execSync("pkill -TERM -f 'ChatGPT' || true", { stdio: "ignore" });
      }
    }
  } catch {}
}

export async function launchCodexThinkingDesktop(argv = process.argv.slice(2)) {
  const isDetach = argv.includes("--detach") || argv.includes("-d") || !process.stdout.isTTY;
  const filteredArgs = argv.filter((a) => a !== "--detach" && a !== "-d");

  const desktopBinary = locateDesktopBinary();
  const stockCodex = locateStockCodexCli();
  const isWindows = process.platform === "win32";
  const shimExecutable = isWindows ? "codex-thinking-shim.cmd" : "codex-thinking-shim";
  const shimPath = path.resolve(__dirname, `../bin/${shimExecutable}`);

  if (!fs.existsSync(shimPath)) {
    throw new Error(`Shim executable not found at: ${shimPath}`);
  }

  if (process.stdout.isTTY) {
    console.log("[codex-thinking-shell] Checking running instances...");
  }
  terminateRunningDesktop();
  await new Promise((r) => setTimeout(r, 800));

  const debugPort = Number(process.env.CODEX_DEBUG_PORT || 43888);

  const isWayland =
    process.platform === "linux" &&
    Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");

  const platformArgs = isWayland
    ? [
        "--ozone-platform=wayland",
        "--enable-wayland-ime",
        "--wayland-text-input-version=3",
      ]
    : [];

  const desktopArgs = [
    `--remote-debugging-port=${debugPort}`,
    ...platformArgs,
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

  if (process.platform !== "win32") {
    process.on("SIGHUP", () => {});
  }

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
