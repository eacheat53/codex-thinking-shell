const SOFT_WRAP_SCRIPT = `
(() => {
  const STYLE_ID = "codex-thinking-soft-wrap";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      [data-testid="exec-shell-body"]:has([aria-label="$ thinking"]) .whitespace-pre {
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
      }
      [data-testid="exec-shell-body"]:has([aria-label="$ thinking"]) .whitespace-pre > .w-max {
        width: 100% !important;
        min-width: 0 !important;
      }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureStyle);
  } else {
    ensureStyle();
  }
  const observer = new MutationObserver(ensureStyle);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

async function evaluateOnTarget(wsUrl) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      return reject(err);
    }

    let reqId = 1;
    const pending = new Map();

    const send = (method, params = {}) => {
      const id = reqId++;
      const msg = JSON.stringify({ id, method, params });
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(msg);
      });
    };

    ws.onopen = async () => {
      try {
        await send("Page.enable");
        await send("Page.addScriptToEvaluateOnNewDocument", {
          source: SOFT_WRAP_SCRIPT,
        });
        await send("Runtime.evaluate", {
          expression: SOFT_WRAP_SCRIPT,
        });
        ws.close();
        resolve(true);
      } catch (err) {
        ws.close();
        reject(err);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && pending.has(data.id)) {
          const { res, rej } = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) {
            rej(new Error(data.error.message));
          } else {
            res(data.result);
          }
        }
      } catch {}
    };

    ws.onerror = (err) => {
      reject(err);
    };
  });
}

export async function injectThinkingSoftWrap(port, maxAttempts = 30, intervalMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const targets = await response.json();
        const pages = targets.filter(
          (t) =>
            t.type === "page" &&
            (t.url.startsWith("app://") || t.title.includes("Codex") || t.title.includes("ChatGPT")),
        );
        if (pages.length > 0) {
          let injectedAny = false;
          for (const page of pages) {
            if (page.webSocketDebuggerUrl) {
              await evaluateOnTarget(page.webSocketDebuggerUrl);
              injectedAny = true;
            }
          }
          if (injectedAny) {
            return true;
          }
        }
      }
    } catch {
      // Waiting for CDP port to open
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
