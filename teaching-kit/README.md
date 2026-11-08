# Teaching toolkit

Six optional teaching tools extend the shared classroom. Read [installation, usage and boundaries](../docs/TEACHING_TOOLS.md).

Install the pinned Python dependencies in `requirements.txt` for mathematics and sampled graphs. MathLive is installed by `npm ci`. Third-party installers, offline GeoGebra assets, runtime data and real learner records are not distributed here.

Run `node teaching-kit/cli.mjs tools` to inspect schemas. To call a tool, pass `node teaching-kit/cli.mjs <tool-name> --file <input.json>`. `--verification` selects isolated verification storage; tests and demonstrations are not student evidence. The MCP entrypoints are the recommended classroom interface.
