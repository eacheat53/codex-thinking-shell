# Codex Thinking Shell

针对官方原生 **Codex Desktop** 接入第三方开源 API Key（如各类开源服务提供的 DeepSeek-R1、GLM 等支持思维链的模型）打造的超轻量独立增强工具。

在保证**原生官方订阅与功能 100% 兼容**的前提下，让原生 Codex 桌面客户端具备实时的 `$ thinking` 思维链折叠卡片展示能力与样式软换行支持。

零第三方运行时依赖（Zero npm dependencies），全平台（Linux、macOS、Windows）基于 Node.js 原生能力运行。

---

## 解决的问题

1. **思维链展示丢失**：原生 Codex Desktop 界面默认只识别渲染终端命令卡片等有限类型，会静默丢弃后端输出的 `type: "reasoning"` 思考流，导致开源模型输出的思考推理过程完全不可见。
2. **样式单行横向溢出**：Codex Desktop 默认对 Shell 卡片采用 `white-space: pre`，导致未主动换行的长文本单行横向拉长、难以阅读。

---

## 核心设计与官方订阅兼容性

### 对官方原生订阅 100% 兼容无影响

- **认证与计费原生透传**：所有非 `app-server` 指令（如 `codex login`、`codex doctor`、`codex exec` 等）以及官方账号凭据验证、Token 刷新、额度计算完全直接透传给底层官方 CLI（`/usr/lib/chatgpt/resources/codex` 或各平台官方安装路径），不改写任何认证或计费逻辑。
- **官方思考模型同步受益**：当你切换使用官方订阅中的深度思考模型（如 `o1`、`o3-mini`）时，由于官方模型同样产生 `reasoning` 数据，本工具也会自动将其渲染为 `$ thinking` 卡片；非思考模型（如 `gpt-4o`）则保持 100% 纯净透传。
- **本地历史数据库零污染**：对话数据在底层依然以官方标准的 `reasoning` 格式存入 SQLite 数据库；仅在流式输出与界面读取历史时原位派生展示卡片，不破坏任何数据格式。

---

## 跨平台直接使用指南 (Linux / macOS / Windows)

本工具为三端通用设计，支持直接在 Linux、macOS 和 Windows 上开箱即用：

| 平台 | 官方 Desktop 路径 | 官方 CLI 路径 | 垫片入口 |
| :--- | :--- | :--- | :--- |
| **Linux** | `/usr/lib/chatgpt/ChatGPT` | `/usr/lib/chatgpt/resources/codex` | `bin/codex-thinking-shell` |
| **macOS** | `/Applications/ChatGPT.app` | `.../Contents/Resources/codex` | `bin/codex-thinking-shell` |
| **Windows** | `%LOCALAPPDATA%\Programs\ChatGPT\ChatGPT.exe` | `.../resources/codex.exe` | `bin/codex-thinking-shell.cmd` |

*(若安装在非标准路径，可通过设置 `CODEX_DESKTOP_PATH` 和 `CODEX_STOCK_CLI_PATH` 自定义)*

---

### 使用方式 1：一键启动（全平台推荐）

启动器会自动处理实例单例、配置 Wayland/IME（Linux）、拉起桌面并通过 CDP 原生 WebSocket 自动注入软换行样式。

- **Linux / macOS**：
  ```bash
  ./bin/codex-thinking-shell
  # 或使用 pnpm / node
  pnpm start
  ```
  *(已支持终端脱离守护，启动后可随时关闭当前终端，客户端在后台持续正常运行)*

- **Windows (PowerShell / CMD)**：
  ```cmd
  .\bin\codex-thinking-shell.cmd
  :: 或
  pnpm start
  ```

---

### 使用方式 2：作为系统环境变量常驻（直接点桌面图标）

如果你希望直接点击系统的桌面图标或应用程序菜单启动 Codex Desktop，只需在系统环境或配置文件中设置环境变量 `CODEX_CLI_PATH`：

- **Linux** (可在 `~/.config/environment.d/10-codex-thinking.conf` 或 `~/.bashrc` 中配置)：
  ```bash
  export CODEX_CLI_PATH="/path/to/codex-thinking-shell/bin/codex-thinking-shim"
  ```
  *(注：Linux 下也可直接使用本项目自带的 `~/.local/share/applications/chatgpt.desktop` 无感覆盖桌面启动图标)*

- **macOS** (可在 `~/.zshrc` 或启动脚本中配置)：
  ```bash
  export CODEX_CLI_PATH="/path/to/codex-thinking-shell/bin/codex-thinking-shim"
  ```

- **Windows** (可在系统环境变量或用户环境变量中添加)：
  - 变量名：`CODEX_CLI_PATH`
  - 变量值：`C:\path\to\codex-thinking-shell\bin\codex-thinking-shim.cmd`

---

## 自动化测试

运行内置跨平台流式投影与子进程透传测试：

```bash
pnpm test
```
