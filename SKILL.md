---
name: zai-vision-mcp
description: Use Zhipu's vision MCP server for image analysis, OCR, screenshot debugging, diagram reading, chart interpretation, UI diffing, UI-to-code, and video analysis.
homepage: https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server
metadata: {"openclaw":{"homepage":"https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server","requires":{"bins":["node","npm"],"env":["Z_AI_API_KEY"]},"primaryEnv":"Z_AI_API_KEY"}}
---

# Z.AI Vision MCP

Use this skill when the user wants visual understanding through Zhipu's vision MCP server.

This skill runs the official Z.AI MCP server entry directly with Node after resolving the installed package path.

It also sets `ZAI_MCP_LOG_PATH` to a writable temp file by default so sandboxed runs do not fail on `~/.zai/...log`.

Required environment:

- `Z_AI_API_KEY`

Optional environment:

- `Z_AI_MODE=ZHIPU` or `Z_AI_MODE=ZAI`

Use the `exec` tool to run:

`node {baseDir}/scripts/call_zai_vision_mcp.mjs --image "<absolute-image-path>" --prompt "<user request>" --timeout-ms 60000`

Use `--image2` when the task compares two screenshots.

Use `--video` when the task is about a local video.

Use `--tool <tool-name>` when the task clearly maps to a specialized tool. The wrapped server exposes these tools:

- `ui_to_artifact`
- `extract_text_from_screenshot`
- `diagnose_error_screenshot`
- `understand_technical_diagram`
- `analyze_data_visualization`
- `ui_diff_check`
- `analyze_image`
- `analyze_video`

Tool selection guidance:

- OCR, code screenshot, terminal screenshot, or document screenshot: `extract_text_from_screenshot`
- Error dialog, stack trace screenshot, or log screenshot: `diagnose_error_screenshot`
- Architecture diagram, flowchart, UML, or ER diagram: `understand_technical_diagram`
- Dashboard, chart, trend plot, or business chart: `analyze_data_visualization`
- UI screenshot to code/spec/prompt: `ui_to_artifact`
- Two screenshots to compare: `ui_diff_check`
- Local or remote video understanding: `analyze_video`
- Anything else visual: `analyze_image`

Rules:

- Always pass absolute local paths.
- If the user gives a relative path, resolve it before running the wrapper.
- If the file does not exist locally, stop and say so.
- Prefer the specialized tool when the user intent is clear.
- When the wrapper returns JSON, summarize the result for the user and include extracted text, differences, or key findings explicitly.
- If the wrapper reports unresolved required parameters, rerun it with `--print-schema` or pass explicit values via repeated `--set key=value`.
