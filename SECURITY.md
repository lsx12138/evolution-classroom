# Local data and issue reports

Evolution Classroom is intended for loopback and private Tailscale access. Access URLs contain a local bearer-equivalent token. Do not expose the gateway to the public Internet or upload private state.

Never attach `state/`, learning records, desktop chat transcripts, Android signing keys, model credentials or unredacted logs to public issues. Share a minimal synthetic reproduction and redact local access URLs.

The gateway checks host/origin and bearer credentials. Desktop registration is loopback-only and validates workspace membership. Adapters must preserve host authentication, version checks and approval requirements. Remote MCP exposes drawing/study tools, not arbitrary OS commands or blanket access to desktop chats.

Report suspected vulnerabilities through GitHub private vulnerability reporting if enabled, or contact the maintainer privately before posting sensitive details publicly.
