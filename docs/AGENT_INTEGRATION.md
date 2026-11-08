# Agent integration and classroom handoff

For deployment, use the full English prompt at [`../AGENT_SETUP_PROMPT.md`](../AGENT_SETUP_PROMPT.md). An agent should perform the setup and report actual acceptance levels, rather than telling the user to manually reproduce every configuration step.

## Architecture

The gateway and whiteboard daemon bind to loopback. The phone reaches the gateway through the user's Tailscale HTTPS endpoint. The gateway owns authenticated board/chat routes and remote MCP. The local STDIO MCP process exposes classroom registration, the whiteboard tools, and shared study tools.

An original-chat adapter offers:

```js
snapshot(sessionId) // {id, cwd, title, busy, pendingApproval, messages:[{id,role,text,createdAtMs?}]}
send(sessionId, text, requestId) // accepted receipt; never a replacement conversation
capabilities // {sameConversation:true, receivesWhileBusy:boolean}
```

The classroom registry binds a board's teacher to `adapter + sessionId`. Joining verifies that the desktop conversation exists and its workspace is inside the configured learning root. Only public user/assistant text is projected into the classroom. Reasoning, tool I/O and credentials stay in the desktop host. A timeout is not treated as proof that a message was rejected; uncertain deliveries are not automatically replayed.

The board's state, frozen snapshots, routing registry and private credentials live in the local `state/` directory. Study files live in the configured workspace. Chat history remains in each desktop client's original conversation. Switching teacher changes future routing, not chat history ownership.

## MCP setup

Run `npm run init`; generated `state/client-mcp.json` contains the actual Node executable and repository path. Import its `study_classroom` entry into the target client's real MCP settings, backing up the original configuration. Reload the host and verify tool discovery plus a read-only call.

Local MCP has 25 tools: classroom start/join/status/leave, 11 canvas tools, 4 study tools and 6 teaching tools. Remote `/mcp` uses Bearer authentication and exposes the 21 drawing/study/teaching tools. Original-chat registration is loopback-only; remote callers do not gain ownership of a desktop conversation.

## Start teaching and take over

1. Read `study_context` and `canvas_read` for the lesson.
2. Check `classroom_status`; use `classroom_start` if needed.
3. Derive your own current desktop conversation ID. Host metadata takes priority over an explicit conflicting ID. Do not guess recent conversations or ask the student to find an internal ID.
4. Call:

```json
{
  "lesson": "math-functions-lesson-1",
  "adapter": "pi-desktop",
  "session_id": "your-own-original-conversation-id",
  "name": "Math teacher · PI",
  "activate": true
}
```

5. Check the receipt's identity, board, lesson and `active:true`. Public replies already return through the bridge; do not send them a second time with another tool.

`activate:false` registers a backup. `activate:true` explicitly takes over future questions and advances the board's routing revision. Phones following an old revision switch to the new active recipient, retaining drafts. Unsubmitted stale-target messages are rejected for review; already delivered messages retain their original receipt. Students may still manually select a teacher until the next explicit handoff.

Activate when the user asks to begin/continue learning with you or to receive classroom questions in your current conversation. Do not re-activate continuously in the background. To move from conversation A to B in the same app, B joins using **B's** identity. To move between apps, the target app's agent does the same. Shared board/study files provide continuity; private chat histories are not copied.

## Whiteboard and annotation workflow

Keep a stable lesson ID and actual board ID. Read the board, update only intended element IDs, inspect a screenshot where available, and save a named snapshot at the end of a lesson. Separate lessons can use separate boards. Protect student work.

`canvas_read` includes annotation text and target object IDs. Read those targets before explaining. Use `canvas_screenshot` for ambiguous handwriting. Adding a drawing or annotation does not itself wake the model: the student sends a classroom question to notify the teacher.

Live boards persist locally. `canvas_save` stores a frozen copy; saving the same name overwrites that snapshot. Include a lesson/date/version in names when history matters. `canvas_export` produces an editable `.excalidraw` or PNG; PNG needs an active viewer. Exported files contain the board, not private chat history.

## Study files

Initialization creates empty generic study folders. `state/mobile-gateway.json` has a `study` section with `subjects`, `overviewFile`, and `recordFile`. The default subject keys are examples; change folder mappings and add subject keys for the user's curriculum. Restart the gateway after changing the profile.

Read current revisions before `study_update_current`. Reuse the same `request_id` on append retries. Never interpret a connection test, generated solution or unreported progress as student learning. Hidden `_...` directories and paths outside the learning workspace are blocked.

The optional learner profile and teaching agreement are configured with `study.profileFile` and `study.teachingModeFile`; new installations use `PROFILE.md` and `TEACHING.md`. Read their current revisions through `study_context`. See [TEACHING_TOOLS.md](TEACHING_TOOLS.md) for the six teaching tools, dependency setup and evidence boundaries.

## Adding a host adapter

Reuse the interface above and register the adapter in `chat/bridge.mjs` and `chat/session-identity.mjs`. Validate the host/version, conversation identity, workspace, approval/busy state and original configuration. Do not expose arbitrary OS commands through a classroom endpoint. Do not remove existing validation for another host.

Add isolated fixtures for message projection, retry IDs and rejected/uncertain delivery. Test the complete original-host round trip with an explicitly authorized, labelled question. Record version and acceptance scope in `COMPATIBILITY.md`. A mock, process listing, parsed config or standalone MCP handshake is not a real-desktop acceptance test.
