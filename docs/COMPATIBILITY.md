# Compatibility and acceptance boundaries

The source release is based on a Windows installation tested on 2026-11-07. That installation's real Android messaging was confirmed by its user. Other machines and client versions must be verified by their own agents.

- **Codex desktop:** Windows Store package `OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0`. The adapter verifies the actual named-pipe owner, vendor signature and an inspected protocol-member hash. It uses owner/follower IPC to start or steer the same original chat. PowerShell 7 (`pwsh.exe`) is required; `STUDY_PWSH` can point to it. Other versions intentionally require review.
- **PI-Desktop 0.21.0:** uses its own local authenticated control MCP (`~/.pi-desktop/mcp-control.json`). The current adapter reads the original session and submits via `pi_agent_prompt`. The control endpoint must be enabled in the user's desktop. Private control credentials stay on that computer. Busy turns pause sending.
- **MiniMax Code desktop 3.1.11:** uses the **desktop-owned diagnostic sidecar**, not an independent mcode/mavis CLI. Fully exit the app, then start it with `MAVIS_ELECTRON_ENABLE_DIAGNOSTIC_SIDECAR=1` and `MAVIS_ELECTRON_DIAGNOSTIC_MANIFEST=<this-project>/state/minimax-desktop-endpoint.json` scoped only to that launch. The adapter verifies the desktop owner and queues a question into the existing `mvs_...` session using a native retry ID. Busy turns pause sending. Prefer the supplied PowerShell launcher over global environment changes.
- **Antigravity desktop 2.29.0:** discovers a desktop-owned local language-server endpoint and checks its version. The full current `userConfig` is carried into the next message, preserving the original model/tool configuration. Busy turns pause sending. A missing desktop is offline, not a reason to launch a substitute CLI session.
- **Claude Desktop:** original-chat delivery is not implemented in this release. MCP drawing/study support depends on the host's actual MCP implementation and permissions. Claude Code is a different host and is not evidence for Desktop support.
- **Other clients / operating systems:** MCP and core gateway use Node.js, but original-chat support is not claimed until a compatible adapter is implemented and verified. Mobile agents can use the authenticated remote drawing/study MCP when reachable; this does not wake an arbitrary original desktop chat.

These are unofficial community integrations. A desktop update may change its interface. Keep checks enabled, report the incompatibility and update a versioned adapter with evidence. The setup prompt asks agents to reuse supported adapters and explicitly report unsupported capabilities.

## Acceptance levels to report separately

1. Dependency installation and config parsing.
2. Actual host MCP discovery and read-only use.
3. Shared drawing/annotation read and write.
4. Classroom message reaches the intended **existing** desktop conversation.
5. Its public reply returns to the classroom.
6. Actual phone interaction, reconnect, keyboard/full-screen and save/export behavior.

Automated tests cover fixtures and isolated service operations. They are not claims of current live compatibility with every installed desktop or Android device.
