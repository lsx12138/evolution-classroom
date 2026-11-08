# Deploy Evolution Classroom for me

Copy the prompt below into the desktop agent you want to use as your teacher.
Replace `<repository location>` with this repository's URL or your local clone.

---

Please deploy **Evolution Classroom** from `<repository location>` on my computer and connect it to **this original desktop conversation**.

Start by reading `README.md`, `AGENTS.md`, `docs/AGENT_INTEGRATION.md`, and `docs/COMPATIBILITY.md` from the repository. Inspect my operating system, the current desktop client and version, Node.js, and the client's real MCP configuration mechanism. Use the repository's scripts and existing adapters rather than rebuilding the application.

## Desired result

I should be able to see a shared teaching whiteboard, draw and annotate specific objects, and ask questions beside it. When the current desktop client is supported, classroom questions must enter this same conversation, and its public replies must return to the classroom. Keep my existing model, account, tools, permissions and conversation context. Use one shared learning workspace across devices.

## Deployment workflow

1. Make a local clone and install the pinned dependencies with `npm ci`. Check for an existing deployment first. Preserve existing settings and workspaces; back up any client configuration before editing only the named classroom MCP entry. Do not change unrelated clients, model credentials, permission modes, login profiles, VPN settings, or system startup entries.
2. Choose a learning workspace with me only if it cannot be inferred safely. Use `npm run init -- --workspace <absolute-path>` to create **new local credentials** and starter files without overwriting existing files. Check port availability. Read `state/client-mcp.json` for the machine-specific MCP command; do not paste credentials into source code or a public issue.
3. For optional mathematics/plots, read `docs/TEACHING_TOOLS.md`, install its pinned Python dependencies using a dedicated environment when appropriate, and verify `teaching_tools_status`. GeoGebra and Anki installers are not part of this source distribution. Start the service with `npm start` or `npm run start:background`. Use `npm run doctor` and verify actual responses. Configure `study_classroom` in this desktop client's supported MCP settings, then reload it. Verify 25 local tools and a read-only call through the real host. A configuration file or an independent SDK handshake alone does not prove host integration.
4. Select the existing adapter for this desktop client. Derive **my current conversation ID from this conversation's host context or metadata**. Never guess the most recent chat, inherit another agent's ID, or ask me to find an internal ID. Do not create a new chatbot or launch/resume a separate CLI agent as a substitute for this original conversation.
5. When the original-chat adapter is available and compatible, call `classroom_join` with the same lesson, the correct adapter, my current original conversation ID, a readable teacher name, and `activate:true`. Confirm `sessionId`, `boardId`, `lesson`, and `active:true` in the actual receipt. Verify one clearly labelled connection-test question and reply; do not count it as learning progress. Avoid interrupting active work or approval prompts.
6. For phone use, reuse my own Tailscale network if present. Inspect and preserve existing Serve routes. Configure my machine's HTTPS origin; never use the author's addresses or credentials. Account sign-in remains my action. Do not publish the service on the public Internet or enable Funnel. Use the project's official release APK if I request Android installation, or build it from `android/` when appropriate; source builds generate my own signing material locally, which stays out of Git. Verify release checksums. Do not replace an existing differently signed installation without explaining the consequence. The browser classroom can be tested before installing Android.
7. Explain how I open the classroom, reconnect, select a teacher, use full-screen chat, save a board snapshot, and export an editable `.excalidraw` file. Leave a short local deployment note with the actual paths, commands and verified capabilities; exclude credentials and do not claim untested devices work.

## Compatibility and missing adapters

Treat these as separate acceptance levels:

- MCP tools discovered and usable in this host.
- Shared board and object annotations can be read and edited.
- A classroom question reaches this exact original desktop conversation.
- The original conversation's public reply returns to the classroom.
- Actual phone access works, if phone access was requested.

MCP support does **not** automatically imply original-chat delivery. Compare the installed client/version with `docs/COMPATIBILITY.md`. If no compatible adapter exists, keep the usable whiteboard/MCP functions and clearly report the missing original-chat capability. Inspect the client's documented or locally available interfaces before proposing a new adapter. Do not bypass authentication, signature checks, version guards or approval requirements. If a new adapter is feasible, implement it behind the existing `snapshot` / `send` contract, test identity, workspace boundaries, public-message filtering, idempotency, busy states and configuration preservation in isolation, and perform an authorized real-host test before marking it supported. Do not remove guards just to make a different version appear compatible.

## How to teach and hand over after setup

When I ask to start/continue learning or take over classroom questions, proactively read the current study context and board, then join **your own current original conversation** with `activate:true`. Merely registering as a backup uses `activate:false`. Do not continuously re-activate in the background or compete with other teachers.

Keep the same lesson and board when handing over. A different conversation, even in the same desktop app, has its own ID and must join as itself. Switching the classroom recipient changes future message delivery; it does not copy another chat's private history. Read the shared learning files and board to recover the teaching point. Protect student drafts and hidden answers. Object annotations identify target object IDs; read them rather than guessing which object the student means. Only append learning progress supported by real student evidence. Connection tests and agent demonstrations are not learning evidence.

Finish with a concise report of **what actually works, what remains unsupported, and the next action I need to take**, if any.

---

The agent is responsible for checking its own host's capabilities. This prompt is an integration workflow, not a guarantee that every desktop client exposes an original-chat API.
