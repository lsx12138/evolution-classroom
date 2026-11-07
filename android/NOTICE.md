# Android third-party components

The application wrapper, connection handling, menus and export code are provided in `src/` under this project's MIT license.

The build installs assets from the pinned `@ansuman-shukla/whiteboard-mcp@0.3.5` dependency. Whiteboard MCP is Copyright (c) 2026 Ansuman Shukla, MIT; its complete license is copied into the APK as `assets/WHITEBOARD_LICENSE.txt`. The drawing engine is based on Excalidraw and its React, drawing and font components. Upstream asset names and embedded notices are preserved. These components and fonts retain their respective licenses and authorship.

- Whiteboard MCP: https://github.com/ansuman-shukla/whiteboard-mcp
- Excalidraw: https://github.com/excalidraw/excalidraw

The build generates signing material for the local installer. No access credentials or private signing keys are included in the source distribution or APK. Keep `signing/` local for future upgrades; never publish it.
