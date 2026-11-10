# Codex Thinking Shell

针对原生 **Codex Desktop** 接入开源 API Key（如通过 `workbuddy2api-panel` / `dsh-our-free-model` 反代接入 DeepSeek-R1、GLM 等开源思考模型）打造的超轻量独立工具。

彻底剥离多 Harness 路由、控制台面板、更新管理等无关子系统，**零第三方运行时依赖（Zero Dependencies）**，纯基于 Node.js 24 原生能力运行。

---

## 解决的问题

1. **思维链展示丢失**：原生 Codex Desktop 前端默认会丢弃后端 `codex app-server` 输出的 `type: "reasoning"` 思考流，导致开源模型的详细思维过程不可见。
2. **样式单行横向溢出**：Codex Desktop 默认对 Shell 卡片采用 `white-space: pre`，导致输出单行横向拉长、难以阅读。

---

## 核心机制

- **STDIO JSON-RPC 垫片（`src/shim.mjs` & `src/projector.mjs`）**：
  - 拦截 Codex Desktop 与 `codex app-server` 之间的 JSON-RPC 通信流。
  - 实时将 `item/reasoning/summaryTextDelta` / `textDelta` 投影为 sentinel command 为 `"thinking"` 的虚拟 `commandExecution` 节点（ID 为 `${itemId}-thinking`）。
  - 在历史会话读取（`thread/read`、`thread/turns/list`）和轮次结束（`turn/completed`）时，原位自动插入展开对应 Thinking Shell 卡片。
- **CDP 软换行注入器（`src/cdp-css-inject.mjs`）**：
  - 启动时通过 Electron `--remote-debugging-port`，利用 Node 24 原生 `WebSocket` 连接 Chrome DevTools 协议。
  - 注入自适应换行样式：
    ```css
    [data-testid="exec-shell-body"]:has([aria-label="$ thinking"]) .whitespace-pre {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    [data-testid="exec-shell-body"]:has([aria-label="$ thinking"]) .whitespace-pre > .w-max {
      width: 100% !important;
      min-width: 0 !important;
    }
    ```

---

## 使用方式

### 方式 1：一键启动（推荐）

在本项目目录下直接运行：

```bash
pnpm start
# 或直接执行二进制：
./bin/codex-thinking-shell
```

启动器会自动：
1. 优雅关闭正在运行的旧版 Codex Desktop 实例；
2. 注入 Wayland / IME 候选窗优化参数（Fedora KDE 友好）；
3. 挂载 Thinking Shell 垫片并开启 CDP 端口；
4. 自动注入软换行样式并持续守护运行。

### 方式 2：作为系统全局 CLI 垫片使用

如果你希望直接点击系统应用程序菜单里的 Codex 图标启动，只需在环境配置（如 `~/.bashrc`、`~/.zshrc` 或桌面快捷方式 `.desktop` 中）加入环境变量：

```bash
export CODEX_CLI_PATH="/home/deadalux/Projects/codex-thinking-shell/bin/codex-thinking-shim"
```

Codex Desktop 启动时会自动检测并直接调用该垫片。

---

## 运行测试

使用 Node.js 原生测试运行器验证流式投影与垫片透传：

```bash
pnpm test
```
