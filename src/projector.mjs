export const REASONING_TRANSCRIPT_COMMAND = "thinking";

export function officialReasoningTranscriptItemId(itemId) {
  return `${itemId}-thinking`;
}

export function extractOfficialReasoningText(item) {
  if (!item || typeof item !== "object") return "";
  const parts = [
    ...(Array.isArray(item.summary) ? item.summary : []),
    ...(Array.isArray(item.content) ? item.content : []),
    ...(typeof item.text === "string" ? [item.text] : []),
  ].filter((value) => typeof value === "string");
  return parts.join("\n").replace(/[\r\n]+$/u, "");
}

function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createThinkingCommandItem(reasoningItem, text, turnStatus) {
  const isFailed = reasoningItem.status === "failed" || turnStatus === "failed";
  const isInterrupted =
    reasoningItem.status === "interrupted" ||
    turnStatus === "interrupted" ||
    turnStatus === "cancelled";
  const status = isFailed ? "failed" : isInterrupted ? "interrupted" : "completed";
  const exitCode = isFailed ? 1 : status === "interrupted" ? null : 0;
  return {
    id: officialReasoningTranscriptItemId(String(reasoningItem.id ?? "")),
    type: "commandExecution",
    command: REASONING_TRANSCRIPT_COMMAND,
    cwd: "",
    processId: null,
    source: "agent",
    status,
    commandActions: [],
    aggregatedOutput: text,
    exitCode,
    durationMs: typeof reasoningItem.durationMs === "number" ? reasoningItem.durationMs : null,
  };
}

function expandTurnItems(items, turnStatus) {
  const existingIds = new Set();
  for (const item of items) {
    if (isJsonObject(item) && typeof item.id === "string") {
      existingIds.add(item.id);
    }
  }

  let changed = false;
  const result = [];
  for (const item of items) {
    result.push(item);
    if (!isJsonObject(item) || item.type !== "reasoning" || typeof item.id !== "string") {
      continue;
    }
    const companionId = officialReasoningTranscriptItemId(item.id);
    if (existingIds.has(companionId)) {
      continue;
    }
    const text = extractOfficialReasoningText(item);
    if (!text) {
      continue;
    }
    existingIds.add(companionId);
    result.push(createThinkingCommandItem(item, text, turnStatus));
    changed = true;
  }
  return changed ? result : items;
}

function expandTurn(turn) {
  if (!isJsonObject(turn) || !Array.isArray(turn.items)) return turn;
  const turnStatus = typeof turn.status === "string" ? turn.status : undefined;
  const expanded = expandTurnItems(turn.items, turnStatus);
  return expanded === turn.items ? turn : { ...turn, items: expanded };
}

function expandTurns(turns) {
  let changed = false;
  const nextTurns = turns.map((turn) => {
    const expanded = expandTurn(turn);
    if (expanded !== turn) changed = true;
    return expanded;
  });
  return changed ? nextTurns : turns;
}

function expandItemListEntries(entries) {
  const existingIds = new Set();
  for (const entry of entries) {
    if (isJsonObject(entry) && isJsonObject(entry.item) && typeof entry.item.id === "string") {
      existingIds.add(entry.item.id);
    }
  }

  let changed = false;
  const result = [];
  for (const entry of entries) {
    result.push(entry);
    if (
      !isJsonObject(entry) ||
      !isJsonObject(entry.item) ||
      entry.item.type !== "reasoning" ||
      typeof entry.item.id !== "string"
    ) {
      continue;
    }
    const companionId = officialReasoningTranscriptItemId(entry.item.id);
    if (existingIds.has(companionId)) {
      continue;
    }
    const text = extractOfficialReasoningText(entry.item);
    if (!text) {
      continue;
    }
    existingIds.add(companionId);
    result.push({
      ...entry,
      item: createThinkingCommandItem(entry.item, text),
    });
    changed = true;
  }
  return changed ? result : entries;
}

function expandHistoryInResult(result) {
  let nextResult = result;

  if (isJsonObject(nextResult.thread) && Array.isArray(nextResult.thread.turns)) {
    const expandedTurns = expandTurns(nextResult.thread.turns);
    if (expandedTurns !== nextResult.thread.turns) {
      nextResult = {
        ...nextResult,
        thread: {
          ...nextResult.thread,
          turns: expandedTurns,
        },
      };
    }
  }

  if (Array.isArray(nextResult.turns)) {
    const expandedTurns = expandTurns(nextResult.turns);
    if (expandedTurns !== nextResult.turns) {
      nextResult = {
        ...nextResult,
        turns: expandedTurns,
      };
    }
  }

  if (Array.isArray(nextResult.items)) {
    const expandedEntries = expandItemListEntries(nextResult.items);
    if (expandedEntries !== nextResult.items) {
      nextResult = {
        ...nextResult,
        items: expandedEntries,
      };
    }
  }

  return nextResult;
}

export class OfficialReasoningProjector {
  #activeItems = new Map();

  clear() {
    this.#activeItems.clear();
  }

  clearThread(threadId) {
    for (const [itemId, state] of this.#activeItems.entries()) {
      if (state.threadId === threadId) {
        this.#activeItems.delete(itemId);
      }
    }
  }

  project(message, observedAtMs = Date.now()) {
    if (!isJsonObject(message)) {
      return { message };
    }

    // 1. Historical RPC responses (thread/read, thread/turns/list, thread/items/list)
    if (isJsonObject(message.result)) {
      const expandedResult = expandHistoryInResult(message.result);
      if (expandedResult !== message.result) {
        return {
          message: {
            ...message,
            result: expandedResult,
          },
        };
      }
      return { message };
    }

    // 2. Notifications
    const method = typeof message.method === "string" ? message.method : undefined;
    if (!method) {
      return { message };
    }

    if (method === "item/started") {
      if (!isJsonObject(message.params) || !isJsonObject(message.params.item)) {
        return { message };
      }
      const item = message.params.item;
      if (item.type !== "reasoning" || typeof item.id !== "string") {
        return { message };
      }
      const threadId = typeof message.params.threadId === "string" ? message.params.threadId : "";
      const turnId = typeof message.params.turnId === "string" ? message.params.turnId : "";
      const startedAtMs =
        typeof message.params.startedAtMs === "number"
          ? message.params.startedAtMs
          : typeof message.emittedAtMs === "number"
            ? message.emittedAtMs
            : observedAtMs;

      this.#activeItems.set(item.id, {
        threadId,
        turnId,
        itemId: item.id,
        startedAtMs,
        wireStarted: false,
        accumulatedText: "",
      });
      return { message };
    }

    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      if (!isJsonObject(message.params) || typeof message.params.itemId !== "string") {
        return { message };
      }
      const itemId = message.params.itemId;
      const state = this.#activeItems.get(itemId);
      const delta = typeof message.params.delta === "string" ? message.params.delta : "";
      if (!state || delta.length === 0) {
        return { message };
      }

      if (method === "item/reasoning/summaryTextDelta") {
        const summaryIndex =
          typeof message.params.summaryIndex === "number" ? message.params.summaryIndex : 0;
        if (
          state.lastSummaryIndex !== undefined &&
          summaryIndex > state.lastSummaryIndex &&
          state.accumulatedText.length > 0 &&
          !state.accumulatedText.endsWith("\n")
        ) {
          state.accumulatedText += "\n";
        }
        state.lastSummaryIndex = summaryIndex;
      } else {
        const contentIndex =
          typeof message.params.contentIndex === "number" ? message.params.contentIndex : 0;
        if (
          state.lastContentIndex !== undefined &&
          contentIndex > state.lastContentIndex &&
          state.accumulatedText.length > 0 &&
          !state.accumulatedText.endsWith("\n")
        ) {
          state.accumulatedText += "\n";
        }
        state.lastContentIndex = contentIndex;
      }

      state.accumulatedText += delta;

      const notificationsAfter = [];
      if (!state.wireStarted) {
        notificationsAfter.push({
          method: "item/started",
          ...(typeof message.emittedAtMs === "number" ? { emittedAtMs: message.emittedAtMs } : {}),
          params: {
            threadId: state.threadId,
            turnId: state.turnId,
            startedAtMs: state.startedAtMs,
            item: {
              id: officialReasoningTranscriptItemId(itemId),
              type: "commandExecution",
              command: REASONING_TRANSCRIPT_COMMAND,
              cwd: "",
              processId: null,
              source: "agent",
              status: "inProgress",
              commandActions: [],
              aggregatedOutput: null,
              exitCode: null,
              durationMs: null,
            },
          },
        });
        state.wireStarted = true;
      }

      notificationsAfter.push({
        method: "item/commandExecution/outputDelta",
        ...(typeof message.emittedAtMs === "number" ? { emittedAtMs: message.emittedAtMs } : {}),
        params: {
          threadId: state.threadId,
          turnId: state.turnId,
          itemId: officialReasoningTranscriptItemId(itemId),
          delta,
        },
      });

      return {
        message,
        notificationsAfter,
      };
    }

    if (method === "item/completed") {
      if (!isJsonObject(message.params) || !isJsonObject(message.params.item)) {
        return { message };
      }
      const item = message.params.item;
      if (item.type !== "reasoning" || typeof item.id !== "string") {
        return { message };
      }
      const itemId = item.id;
      const state = this.#activeItems.get(itemId);
      this.#activeItems.delete(itemId);

      const textFromItem = extractOfficialReasoningText(item);
      const fullText = (textFromItem || state?.accumulatedText || "").replace(/[\r\n]+$/u, "");
      if (!fullText && !state?.wireStarted) {
        return { message };
      }

      const threadId =
        typeof message.params.threadId === "string"
          ? message.params.threadId
          : (state?.threadId ?? "");
      const turnId =
        typeof message.params.turnId === "string" ? message.params.turnId : (state?.turnId ?? "");
      const startedAtMs =
        typeof message.params.startedAtMs === "number"
          ? message.params.startedAtMs
          : (state?.startedAtMs ??
            (typeof message.emittedAtMs === "number" ? message.emittedAtMs : observedAtMs));
      const completedAtMs =
        typeof message.params.completedAtMs === "number"
          ? message.params.completedAtMs
          : typeof message.emittedAtMs === "number"
            ? message.emittedAtMs
            : observedAtMs;
      const durationMs = Math.max(0, completedAtMs - startedAtMs);

      const notificationsAfter = [];
      if (!state?.wireStarted) {
        notificationsAfter.push({
          method: "item/started",
          ...(typeof message.emittedAtMs === "number" ? { emittedAtMs: message.emittedAtMs } : {}),
          params: {
            threadId,
            turnId,
            startedAtMs,
            item: {
              id: officialReasoningTranscriptItemId(itemId),
              type: "commandExecution",
              command: REASONING_TRANSCRIPT_COMMAND,
              cwd: "",
              processId: null,
              source: "agent",
              status: "inProgress",
              commandActions: [],
              aggregatedOutput: null,
              exitCode: null,
              durationMs: null,
            },
          },
        });
      }
      notificationsAfter.push({
        method: "item/completed",
        ...(typeof message.emittedAtMs === "number" ? { emittedAtMs: message.emittedAtMs } : {}),
        params: {
          threadId,
          turnId,
          startedAtMs,
          completedAtMs,
          item: {
            id: officialReasoningTranscriptItemId(itemId),
            type: "commandExecution",
            command: REASONING_TRANSCRIPT_COMMAND,
            cwd: "",
            processId: null,
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: fullText,
            exitCode: 0,
            durationMs,
          },
        },
      });
      return {
        message,
        notificationsAfter,
      };
    }

    if (method === "turn/completed") {
      if (!isJsonObject(message.params) || !isJsonObject(message.params.turn)) {
        return { message };
      }
      const turn = message.params.turn;
      const turnId = typeof turn.id === "string" ? turn.id : "";
      const threadId = typeof message.params.threadId === "string" ? message.params.threadId : "";
      const turnStatus = typeof turn.status === "string" ? turn.status : "completed";
      const isFailed = turnStatus === "failed";
      const completedStatus = isFailed ? "failed" : "interrupted";
      const exitCode = isFailed ? 1 : null;
      const now = typeof message.emittedAtMs === "number" ? message.emittedAtMs : observedAtMs;

      const notificationsBefore = [];
      for (const [activeId, state] of this.#activeItems.entries()) {
        const matchesTurn = state.turnId === turnId || (!turnId && state.threadId === threadId);
        if (!matchesTurn) continue;
        this.#activeItems.delete(activeId);
        if (!state.wireStarted) continue;

        const durationMs = Math.max(0, now - state.startedAtMs);
        notificationsBefore.push({
          method: "item/completed",
          ...(typeof message.emittedAtMs === "number" ? { emittedAtMs: message.emittedAtMs } : {}),
          params: {
            threadId: state.threadId,
            turnId: state.turnId,
            startedAtMs: state.startedAtMs,
            completedAtMs: now,
            item: {
              id: officialReasoningTranscriptItemId(state.itemId),
              type: "commandExecution",
              command: REASONING_TRANSCRIPT_COMMAND,
              cwd: "",
              processId: null,
              source: "agent",
              status: completedStatus,
              commandActions: [],
              aggregatedOutput: state.accumulatedText.replace(/[\r\n]+$/u, "") || null,
              exitCode,
              durationMs,
            },
          },
        });
      }

      let updatedMessage = message;
      if (Array.isArray(turn.items)) {
        const expandedItems = expandTurnItems(turn.items, turnStatus);
        if (expandedItems !== turn.items) {
          updatedMessage = {
            ...message,
            params: {
              ...message.params,
              turn: {
                ...turn,
                items: expandedItems,
              },
            },
          };
        }
      }

      return {
        message: updatedMessage,
        ...(notificationsBefore.length > 0 ? { notificationsBefore } : {}),
      };
    }

    if (method === "thread/closed") {
      if (isJsonObject(message.params) && typeof message.params.threadId === "string") {
        this.clearThread(message.params.threadId);
      }
      return { message };
    }

    return { message };
  }
}
