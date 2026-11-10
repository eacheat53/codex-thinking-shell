#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OfficialReasoningProjector } from "./projector.mjs";

const __filename = fileURLToPath(import.meta.url);

export function resolveStockCodex() {
  if (process.env.CODEX_STOCK_CLI_PATH && fs.existsSync(process.env.CODEX_STOCK_CLI_PATH)) {
    return process.env.CODEX_STOCK_CLI_PATH;
  }
  const defaultPath = "/usr/lib/chatgpt/resources/codex";
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const pathDirs = (process.env.PATH || "").split(":");
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "codex");
    if (fs.existsSync(candidate) && candidate !== __filename && candidate !== process.argv[1]) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  throw new Error("Could not locate official Codex CLI (/usr/lib/chatgpt/resources/codex)");
}

export function runShim(argv = process.argv.slice(2)) {
  const stockCodex = resolveStockCodex();
  const isAppServer = argv.includes("app-server");

  if (!isAppServer) {
    const child = spawn(stockCodex, argv, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code ?? 0);
      }
    });
    return child;
  }

  const child = spawn(stockCodex, argv, {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });

  const projector = new OfficialReasoningProjector();

  process.stdin.pipe(child.stdin);
  process.stdin.on("end", () => {
    try {
      child.stdin.end();
    } catch {}
  });

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      process.stdout.write(line + "\n");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(line + "\n");
      return;
    }

    const { message, notificationsBefore, notificationsAfter } = projector.project(parsed);

    if (notificationsBefore && notificationsBefore.length > 0) {
      for (const notif of notificationsBefore) {
        process.stdout.write(JSON.stringify(notif) + "\n");
      }
    }

    process.stdout.write(JSON.stringify(message) + "\n");

    if (notificationsAfter && notificationsAfter.length > 0) {
      for (const notif of notificationsAfter) {
        process.stdout.write(JSON.stringify(notif) + "\n");
      }
    }
  });

  const forwardSignal = (sig) => {
    try {
      child.kill(sig);
    } catch {}
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("SIGHUP", () => forwardSignal("SIGHUP"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  return child;
}

if (process.argv[1] === __filename) {
  runShim();
}
