# Evolution Classroom · 进化课堂

**A shared classroom your own desktop agent can teach in.**

Let an agent draw diagrams, explain a question on a whiteboard, read your handwritten work and object annotations, and continue teaching from your phone. Supported adapters send classroom questions into the agent's **existing desktop conversation** and bring public replies back beside the board.

## Use it: let your agent deploy it

**Give your agent this repository and [AGENT_SETUP_PROMPT.md](AGENT_SETUP_PROMPT.md). Ask it to follow the prompt and deploy the project for you.** The full setup prompt is in English and is included in the project root.

You can start with:

> Please deploy this project for me. Read and follow `AGENT_SETUP_PROMPT.md` in the repository. Connect the classroom to this original desktop conversation, verify each capability, and tell me how to open it.

Your agent checks your machine and client, installs the project, generates your own local credentials, configures MCP, and tests the connection. Phone setup and Android installation can then be handled by the same agent. You do not need to manually fill in the author's paths or configure another model API key for the classroom.

[Download the release package or Android APK](https://github.com/lsx12138/evolution-classroom/releases/latest). The APK has no preconfigured server or credentials; your agent still deploys your own computer's service. Source builds are available for users who want their own signing key.

**中文使用方式：**下载项目或把仓库地址交给自己的桌面 Agent，让它阅读根目录的英文 `AGENT_SETUP_PROMPT.md` 并按提示部署。Agent 会检查环境、安装依赖、配置 MCP 和验证收发；需要手机使用时，再由它配置你自己的 Tailscale 和安装 Android App。

## What it does

- **Shared, editable whiteboard:** agent-controlled text, shapes, arrows, diagrams and student drawing, built on Whiteboard MCP / Excalidraw.
- **Object annotations:** attach a question to one or more selected objects. Agents receive annotation text and target IDs through `canvas_read`.
- **Original-conversation chat bridge:** supported desktop hosts keep their own model, context and tools; the classroom routes questions to an explicitly joined conversation.
- **Teacher handoff:** multiple agents can register on one board. `activate:true` switches future questions to the teacher taking over; the phone follows the new recipient and keeps drafts.
- **Phone classroom:** board and chat together, with full-screen chat and Android WebView support. Tailscale HTTPS allows private access to your computer.
- **Shared study files:** one local source of truth, evidence-based append-only learning records and revision-checked current-task updates. Subject folders are configurable.
- **Saving and export:** live boards persist locally; named snapshots preserve a lesson, and `.excalidraw` exports stay editable. PNG export requires an active board viewer.

Six teaching tools and faster whiteboard controls are available in [version 0.2.0](CHANGELOG.md): complete-question activities, teacher mathematics checks, interactive function plots, formula input and Anki text export. Read [TEACHING_TOOLS.md](docs/TEACHING_TOOLS.md) for optional Python setup, mouse shortcuts and upgrade steps. Android 0.2.2 includes the updated whiteboard frontend.

## Compatibility: tools and chat are different

The initial installation was tested on Windows with **Codex desktop, PI-Desktop, MiniMax Code desktop and Antigravity**, including real Android question/reply tests. This public package needs to be verified on each new installation; the setup prompt directs the agent to do that.

The local MCP server exposes **25 tools**. The authenticated remote HTTP MCP exposes **21 whiteboard/study/teaching tools**; it does not register a remote agent as a local original-chat owner. An MCP-capable client may use drawing/study tools without having an original-conversation adapter.

Desktop adapters use version-sensitive local interfaces. Codex's current adapter is pinned to one inspected Windows Store package; Antigravity is pinned to 2.29.0. Unknown versions may be rejected intentionally. **Claude Desktop original-chat delivery is not implemented.** These are community integrations, not vendor-supported APIs. See [COMPATIBILITY.md](docs/COMPATIBILITY.md).

The phone uses the computer's service and workspace. It is not an offline classroom or a standalone phone model runtime. Drawing or adding a note alone does not wake an agent; send a classroom message to the joined teacher.

## Manual commands, if you want them

Requirements: Node.js 22+, npm. Desktop chat adapters in this release target Windows; the core gateway and MCP use Node.js. Android source builds use Python 3, JDK 21 and Android SDK / Build Tools 36.

```sh
npm ci
npm run init
npm start
```

Optional setup parameters:

```sh
npm run init -- --workspace /absolute/path/to/learning --port 47429 --whiteboard-port 47428
npm run doctor
```

Initialization prints the local MCP configuration path (`state/client-mcp.json`). Start with that file's actual absolute paths when configuring a desktop client. The setup workflow checks port conflicts. Open the private URL from `node whiteboard.mjs url` for the board; `node classroom.mjs join --lesson my-lesson --adapter <adapter> --thread <your-own-id> --name Teacher --activate` returns the classroom URL. This command manages classroom routing; it does not start a CLI model agent.

For phones, initialize with your own HTTPS origin, for example `--public-origin https://your-pc.your-tailnet.ts.net:8450`, restart the gateway, and have your agent configure Tailscale Serve to the local gateway. See [mobile setup](docs/MOBILE.md). All access credentials and generated settings stay local.

## Project layout

```text
AGENT_SETUP_PROMPT.md    Copyable English deployment prompt
AGENTS.md               Agent rules for this project
classroom-mcp.mjs       Local MCP entrypoint (25 tools)
mobile-gateway.mjs      Authenticated gateway and remote MCP
whiteboard.mjs          Shared board CLI
chat/                   Original-chat adapters and classroom UI
android/                Android application source and local build script
teaching-kit/           Mathematics, activities, graphs, formula input and review cards
scripts/                Initialization, startup and diagnostics
docs/                   Integration, compatibility and mobile notes
state/                  Generated private runtime data (never committed)
workspace/              Your generated learning files (never committed)
```

## Development and contributions

```sh
npm test
npm run test:smoke
```

Tests use isolated fixtures; they do not send questions into real desktop chats. The smoke test initializes a fresh temporary workspace and checks actual MCP/whiteboard/gateway operations. Android connection parsing is tested by the build script. Real desktop and real phone tests must be reported separately from these automated checks.

New host adapters should implement the contract in [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md), fail safely on unknown versions, preserve original conversation identity/settings, and include tests. An adapter's existence is not proof of real-host acceptance.

## Data, licensing and credits

Local runtime state contains board access credentials, board contents and conversation bindings. Never commit or publicly upload `state/`, learning files, logs, client credentials or Android signing keys. The distributed source does not include the original user's private data or APK signing material.

Project code: **MIT**. Whiteboard MCP is by Ansuman Shukla, and the drawing engine is based on Excalidraw. Markdown rendering uses markdown-it. Third-party components and fonts retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Evolution Classroom does not claim authorship of the upstream drawing engine.
