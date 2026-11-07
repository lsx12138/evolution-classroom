# Phone setup

Ask your desktop agent to follow `AGENT_SETUP_PROMPT.md`. Use your own computer, tailnet and credentials. The computer must stay running for shared boards and original-desktop-chat messaging.

1. Connect computer and Android phone to your Tailscale network. The user performs any required account sign-in.
2. Initialize the service with the computer's real Tailscale HTTPS hostname, for example:

```sh
npm run init -- --public-origin https://your-pc.your-tailnet.ts.net:8450
```

3. Restart the gateway. After inspecting existing routes, expose **only** its loopback port on your chosen Tailscale Serve HTTPS port, e.g. `tailscale serve --https=8450 http://127.0.0.1:47429`. Keep it private to your tailnet; do not enable Funnel or overwrite unrelated Serve routes. The supplied Windows mobile launcher can keep the foreground Serve process hidden while running the classroom.
4. Have the agent join the desired lesson and return the private `/classroom/<board-id>/<token>/` URL. Open it in a phone browser for the first test. Check both board synchronization and a labelled message/reply in the intended desktop conversation.
5. For the Android application, build `android/build.py` with Python 3, `JAVA_HOME` (JDK 21), `ANDROID_HOME` (SDK platform 36 / Build Tools 36.0.0), and Node.js on PATH. The build generates **your own** signing material in ignored `android/signing/`. Keep it for future upgrades. This source release does not include the author's APK/signing key.
6. Install your resulting APK through your normal Android installation flow and enter the private classroom URL. Android uses bundled whiteboard assets and the same computer's gateway. Server-side chat/handoff updates do not require rebuilding the APK; frontend asset changes do.

The app accepts valid HTTPS `*.ts.net` classroom, board or setup URLs. Its strict host/certificate checks are preserved. Browser-based local development can use loopback HTTP; Android remote use needs the actual Tailscale HTTPS origin.

Use **Ask teacher / 问老师**, then **Full screen / 全屏** to expand chat and **Return to board / 返回白板** to restore the split view. Drafts are retained and the UI adjusts to the visible viewport when the keyboard opens. Sending follows the explicitly active teacher; users may manually choose a registered teacher.

Live board state is stored on the computer under `state/canvases/`; frozen snapshots are under `state/saved/`. Use `.excalidraw` exports for portable editable backups. The app's own unsent text or unsynchronized drawing is not proof that it has reached the computer.

Troubleshoot in order: gateway health, whiteboard upstream health, Tailscale reachability/DNS, host MCP state, registered conversation identity, adapter version, then a labelled end-to-end message. Being shown as connected in Tailscale alone does not establish classroom access.
