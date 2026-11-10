import test from "node:test";
import assert from "node:assert/strict";
import {
  OfficialReasoningProjector,
  officialReasoningTranscriptItemId,
  extractOfficialReasoningText,
} from "../src/projector.mjs";

test("extractOfficialReasoningText extracts and cleans text", () => {
  assert.equal(
    extractOfficialReasoningText({ summary: ["Thinking step 1", "Thinking step 2\n\n"] }),
    "Thinking step 1\nThinking step 2",
  );
  assert.equal(
    extractOfficialReasoningText({ content: ["Direct content"] }),
    "Direct content",
  );
  assert.equal(
    extractOfficialReasoningText({ text: "Plain string" }),
    "Plain string",
  );
  assert.equal(extractOfficialReasoningText({}), "");
});

test("passes through non-reasoning notifications unchanged", () => {
  const projector = new OfficialReasoningProjector();
  const raw = {
    method: "item/started",
    params: {
      threadId: "th_1",
      turnId: "tu_1",
      item: { id: "msg_1", type: "message", role: "assistant" },
    },
  };
  const result = projector.project(raw);
  assert.deepEqual(result, { message: raw });
});

test("streams reasoning deltas as synthetic thinking commandExecution deltas", () => {
  const projector = new OfficialReasoningProjector();

  const started = {
    method: "item/started",
    params: {
      threadId: "th_1",
      turnId: "tu_1",
      startedAtMs: 1000,
      item: { id: "rs_1", type: "reasoning" },
    },
  };
  assert.deepEqual(projector.project(started), { message: started });

  const delta1 = {
    method: "item/reasoning/summaryTextDelta",
    params: {
      itemId: "rs_1",
      delta: "Step 1",
    },
  };
  const resDelta1 = projector.project(delta1);
  assert.equal(resDelta1.notificationsAfter?.length, 2);
  assert.equal(resDelta1.notificationsAfter[0].method, "item/started");
  assert.equal(
    resDelta1.notificationsAfter[0].params.item.id,
    officialReasoningTranscriptItemId("rs_1"),
  );
  assert.equal(resDelta1.notificationsAfter[0].params.item.type, "commandExecution");
  assert.equal(resDelta1.notificationsAfter[0].params.item.command, "thinking");

  assert.equal(resDelta1.notificationsAfter[1].method, "item/commandExecution/outputDelta");
  assert.equal(
    resDelta1.notificationsAfter[1].params.itemId,
    officialReasoningTranscriptItemId("rs_1"),
  );
  assert.equal(resDelta1.notificationsAfter[1].params.delta, "Step 1");

  // Second delta should not re-emit item/started
  const delta2 = {
    method: "item/reasoning/summaryTextDelta",
    params: {
      itemId: "rs_1",
      delta: " and step 2",
    },
  };
  const resDelta2 = projector.project(delta2);
  assert.equal(resDelta2.notificationsAfter?.length, 1);
  assert.equal(resDelta2.notificationsAfter[0].method, "item/commandExecution/outputDelta");
  assert.equal(resDelta2.notificationsAfter[0].params.delta, " and step 2");

  // Completion
  const completed = {
    method: "item/completed",
    params: {
      threadId: "th_1",
      turnId: "tu_1",
      startedAtMs: 1000,
      completedAtMs: 1500,
      item: {
        id: "rs_1",
        type: "reasoning",
        summary: ["Step 1 and step 2"],
      },
    },
  };
  const resCompleted = projector.project(completed);
  assert.equal(resCompleted.notificationsAfter?.length, 1);
  assert.equal(resCompleted.notificationsAfter[0].method, "item/completed");
  const compItem = resCompleted.notificationsAfter[0].params.item;
  assert.equal(compItem.id, officialReasoningTranscriptItemId("rs_1"));
  assert.equal(compItem.type, "commandExecution");
  assert.equal(compItem.command, "thinking");
  assert.equal(compItem.status, "completed");
  assert.equal(compItem.aggregatedOutput, "Step 1 and step 2");
  assert.equal(compItem.durationMs, 500);
});

test("expands reasoning items into companion thinking items in thread/read response", () => {
  const projector = new OfficialReasoningProjector();
  const rpcResponse = {
    id: 42,
    result: {
      thread: {
        id: "th_1",
        turns: [
          {
            id: "tu_1",
            status: "completed",
            items: [
              {
                id: "rs_1",
                type: "reasoning",
                summary: ["I am analyzing the problem..."],
              },
              {
                id: "msg_1",
                type: "message",
                content: [{ type: "text", text: "Here is the answer" }],
              },
            ],
          },
        ],
      },
    },
  };

  const projected = projector.project(rpcResponse);
  const turnItems = projected.message.result.thread.turns[0].items;
  assert.equal(turnItems.length, 3);
  assert.equal(turnItems[0].id, "rs_1");
  assert.equal(turnItems[1].id, "rs_1-thinking");
  assert.equal(turnItems[1].type, "commandExecution");
  assert.equal(turnItems[1].command, "thinking");
  assert.equal(turnItems[1].aggregatedOutput, "I am analyzing the problem...");
  assert.equal(turnItems[2].id, "msg_1");

  // Idempotency: projecting again should not double inject
  const secondPass = projector.project(projected.message);
  assert.equal(secondPass.message.result.thread.turns[0].items.length, 3);
});
