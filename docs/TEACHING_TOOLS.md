# Teaching tools and whiteboard controls

Version 0.2.0 adds six tools to the existing classroom: 25 local STDIO tools and 21 authenticated remote HTTP tools. These tools do not change the active teacher or replace the original desktop conversation.

## Install and upgrade

Use the pinned JavaScript dependencies with `npm ci`. Formula input uses MathLive 0.111.4. Mathematics and sampled graphs additionally need Python 3.10+ and:

```sh
python -m pip install -r teaching-kit/requirements.txt
```

`STUDY_PYTHON` can name a Python executable containing these dependencies, including a virtual environment. `teaching_tools_status` reports the detected SymPy version and optional components. The existing drawing/chat tools work without Python; unavailable mathematics must be reported rather than guessed.

For an existing installation, preserve `state/`, the learning workspace and `android/signing/`. Update the source, run `npm ci` and `npm run init` (existing credentials and files are retained), then restart this installation's gateway when its lessons are idle. Reload the classroom MCP in each client using it. Check for 25 local / 21 remote tools. Do not stop another installation or change network routes as part of this upgrade.

## Tools

- `teaching_tools_status`: inspect installed mathematics, formula input and optional GeoGebra assets, without joining a lesson or writing progress.
- `math_verify`: teacher checks for real domains, inequalities, derivatives, integrals, simplification, expression equivalence and plot samples. Use explicit multiplication, for example `a*x**2+b`. Original-domain exclusions are retained: `x/x` and `1` simplify alike but have different full domains. Unsupported cases and timeouts require independent teacher checking. The process uses a bounded syntax interpreter, not Python expression evaluation, and cannot read answer files.
- `classroom_activity`: prepare a complete question, read actual submissions, record hint level and feedback, and get a difficulty suggestion. There is no expected-answer field. Assessment requires a submission and its current revision. Teacher transcriptions require original student evidence. Difficulty levels are provisional teacher labels, not official exam classifications. A student reporting “too easy” does not automatically get locked into elementary drills after one local mistake.
- `teaching_graph`: save expressions, axis ranges and parameter sliders. The built-in sampled graph works with SymPy. Sampling is an illustration, not proof of exact endpoints, continuity or a learner's understanding.
- `teaching_panel`: return the private student page for prepared questions and graphs. Local STDIO starts a separate loopback panel; the remote gateway returns its own private `/learning-tools/<token>/` URL. A link can include `activity_id` or `graph_id`. Both surfaces share the installation's toolkit state. The panel offers text/MathLive answers, saved drafts, difficulty feedback and teacher comments. Submitting saves the answer; it does not automatically wake an agent. Tell the current teacher “I submitted” in classroom chat.
- `review_cards`: prepare cards from content actually taught or submitted, with evidence, then export UTF-8 tab-separated text for Anki. Import into Anki with HTML enabled (line breaks are escaped). The tool does not install Anki, upload/sync cards or fabricate review history. Official clients: [Anki](https://apps.ankiweb.net/) and [AnkiDroid](https://ankidroid.org/).

Toolkit questions, answers, graph configurations, decks and exports stay in `state/teaching-kit/` and must not be committed. They do not automatically update subject learning files: the teacher still records only real evidence through the study tools.

## Optional local GeoGebra

GeoGebra is **not included** in this MIT source release, APK or source archive. The built-in sampled graph remains available without it. If you choose to use GeoGebra, obtain it from [GeoGebra's official site](https://www.geogebra.org/download), review its [separate license](https://www.geogebra.org/license), and install its offline web assets locally.

The integration was developed against the official Math Apps Bundle 5.4.934.0. Its expected local paths are `teaching-kit/vendor/geogebra/GeoGebra/deployggb.js` and `teaching-kit/vendor/geogebra/GeoGebra/HTML5/5.0/web3d/`. The `vendor/` directory is ignored by Git. On-demand loading uses this installation's private asset routes, rather than a third-party CDN. If the optional component is missing, the page keeps the built-in graph available. Do not assume another bundle version is compatible without testing it.

## Whiteboard controls

- Upper mouse side button (usually Forward / button 4): switch to the hand tool, then left-drag to pan.
- Lower mouse side button (usually Back / button 3): return to the previous tool, including drawing, text, shapes, eraser and selection. Mouse drivers can reverse physical side-button positions.
- Plain wheel over the drawing canvas: zoom around the cursor. Ctrl+wheel and pinch keep their native zoom behavior. Trackpad scrolling over the canvas also zooms; pan with the hand tool, Space+drag or the middle mouse button.
- Right-click the canvas and choose “批注…” to pick an object or drag a region for an object-linked annotation. Hover highlights the current target; Escape cancels. The original whiteboard menu remains available.

Side buttons do not interrupt a held drawing stroke and leave text fields/dialogs alone. Menu/panel scrolling keeps its original behavior. Controls are local input preferences; they do not edit shared scene objects.

Refresh browser whiteboards after an update. The Android app bundles its whiteboard frontend, so these frontend changes require an updated APK. Android 0.2.2 includes the updated assets. Mouse shortcuts on a phone require an external mouse and actual device testing; touch gestures are not remapped to side buttons. Server-delivered chat and shared board data still come from the same computer.

## Learner context and validation

Initialization creates generic `PROFILE.md` and `TEACHING.md` without overwriting existing files. Configure `study.profileFile` and `study.teachingModeFile` for other names. `study_context` reads their current content and revisions along with the current task and records; it does not ship the original user's profile or curriculum. Subject keys/folders remain configurable, including subjects beyond the four initial examples.

Run `npm test` and `npm run test:smoke`. Tests cover mathematical exclusions, rejected syntax, submission revisions, evidence requirements, HTTP boundaries, real MCP handshakes, mouse event logic and whiteboard asset delivery. Browser rendering, physical mouse mappings and real Android touch interaction require separate acceptance checks. Test fixtures and prepared materials do not count as learning.
