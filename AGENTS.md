# Agent entrypoint

Read `AGENT_SETUP_PROMPT.md`, `docs/AGENT_INTEGRATION.md` and `docs/COMPATIBILITY.md` before deployment or adapter changes. Use the existing implementation and pinned dependencies. Do not include real users' runtime state in commits.

When the user asks to begin/continue teaching or receive phone questions in this conversation, proactively check `classroom_status`, read study context and the board, and call `classroom_join` for **your own original conversation** with `activate:true`. Backups use false; do not repeatedly steal the active route. Preserve lesson/board IDs and student drafts.

MCP tool availability and original-desktop-chat delivery are distinct. Do not invent or guess a current conversation ID, select someone else's recent chat, launch a substitute CLI model session, or remove version/signature/authentication guards to claim compatibility. Missing capabilities must be reported clearly.

Read `docs/TEACHING_TOOLS.md` when using mathematics, complete-question activities, graphs, formula input or review export. Read the learner profile and teaching agreement from current study context. Unknown ability is unconfirmed; adjust difficulty from actual answers and hints.

Only real student evidence belongs in learning records. Use request IDs for retries and current revisions for updates. Keep hidden answers and archives protected. A diagram or object annotation does not itself trigger a model turn.

Configure only the requested desktop client's classroom MCP entry, preserve other settings, and verify actual host calls. Run `npm test` and `npm run test:smoke` for relevant changes. Never send messages to real desktop conversations during automated tests.
