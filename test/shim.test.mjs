import test from "node:test";
import assert from "node:assert/strict";
import { resolveStockCodex } from "../src/shim.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shimPath = path.resolve(__dirname, "../src/shim.mjs");

test("resolveStockCodex finds official Codex binary", () => {
  const stock = resolveStockCodex();
  assert.ok(stock);
  assert.ok(stock.endsWith("/codex"));
});

test("shim intercepts and transforms streaming JSON-RPC reasoning output", async () => {
  const fixturePath = path.resolve(__dirname, "./fake-codex.mjs");
  fs.writeFileSync(
    fixturePath,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  method: "item/started",
  params: { threadId: "t1", turnId: "u1", item: { id: "r1", type: "reasoning" } }
}));
console.log(JSON.stringify({
  method: "item/reasoning/summaryTextDelta",
  params: { itemId: "r1", delta: "Thinking about life..." }
}));
console.log(JSON.stringify({
  method: "item/completed",
  params: { threadId: "t1", turnId: "u1", item: { id: "r1", type: "reasoning", summary: ["Thinking about life..."] } }
}));
`,
    { mode: 0o755 },
  );

  try {
    const child = spawn(process.execPath, [shimPath, "app-server", "--stdio"], {
      env: {
        ...process.env,
        CODEX_STOCK_CLI_PATH: fixturePath,
      },
      stdio: ["pipe", "pipe", "inherit"],
    });

    const lines = [];
    child.stdout.on("data", (chunk) => {
      const chunkLines = chunk.toString("utf8").split("\n").filter(Boolean);
      lines.push(...chunkLines);
    });

    await new Promise((resolve) => child.on("exit", resolve));

    const parsed = lines.map((l) => JSON.parse(l));

    // Verify companion thinking commandExecution items were generated
    const thinkingStarted = parsed.find(
      (m) => m.method === "item/started" && m.params?.item?.id === "r1-thinking",
    );
    assert.ok(thinkingStarted, "Should emit synthetic thinking item/started");
    assert.equal(thinkingStarted.params.item.command, "thinking");

    const thinkingDelta = parsed.find(
      (m) => m.method === "item/commandExecution/outputDelta" && m.params?.itemId === "r1-thinking",
    );
    assert.ok(thinkingDelta, "Should emit synthetic thinking outputDelta");
    assert.equal(thinkingDelta.params.delta, "Thinking about life...");

    const thinkingCompleted = parsed.find(
      (m) => m.method === "item/completed" && m.params?.item?.id === "r1-thinking",
    );
    assert.ok(thinkingCompleted, "Should emit synthetic thinking item/completed");
    assert.equal(thinkingCompleted.params.item.status, "completed");
    assert.equal(thinkingCompleted.params.item.aggregatedOutput, "Thinking about life...");
  } finally {
    try {
      fs.unlinkSync(fixturePath);
    } catch {}
  }
});
