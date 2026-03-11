# openclawd-zai-skills

OpenClaw skills for Z.AI services.

This repository currently contains one published skill:

- `zai-vision-mcp`: a self-contained OpenClaw skill wrapper for Zhipu's vision MCP server

It is designed to be cloned, dropped into a skills directory, and used without adding local project dependencies.

## Why this exists

The upstream Z.AI MCP server works, but in real OpenClaw environments there are a few operational details to handle cleanly:

- long-running stdio through `npx` is brittle
- sandboxed runs may not be allowed to write `~/.zai/...log`
- tool schemas can evolve over time

This wrapper handles those details so the skill behaves more predictably in local and sandboxed agent runs.

## Features

- Wraps the official `@z_ai/mcp-server`
- Resolves and launches the server entry directly with `node`
- Uses a writable temp log path by default
- Auto-installs the MCP server package into a temp cache if needed
- Auto-selects an appropriate vision tool when `--tool` is omitted
- Supports image analysis, OCR, error screenshot diagnosis, diagram reading, chart analysis, UI diffing, UI-to-artifact, and video analysis

## Repo layout

```text
openclawd-zai-skills/
  README.md
  SKILL.md
  scripts/
    call_zai_vision_mcp.mjs
```

## Quick start

Clone this repo anywhere, then either:

- move the whole directory into an OpenClaw skills directory
- or keep it where it is and add its parent directory to `skills.load.extraDirs`

You can move this whole directory into any OpenClaw skill location later:

- `<workspace>/skills/openclawd-zai-skills`
- `~/.openclaw/skills/openclawd-zai-skills`
- or keep it anywhere and load it via `skills.load.extraDirs`

Required environment:

- `Z_AI_API_KEY`

Optional environment:

- `Z_AI_MODE=ZHIPU` or `Z_AI_MODE=ZAI`

## What it wraps

The wrapper resolves and starts the official Z.AI vision MCP server entry directly:

```bash
node .../@z_ai/mcp-server/build/index.js
```

`ZAI_MCP_LOG_PATH` is auto-set to a writable file under `/tmp` unless you override it.

## Local smoke test

Print wrapper help:

```bash
node scripts/call_zai_vision_mcp.mjs --help
```

List tools exposed by the MCP server:

```bash
Z_AI_API_KEY=your_key \
node scripts/call_zai_vision_mcp.mjs --list-tools --timeout-ms 60000
```

Analyze an image:

```bash
Z_AI_API_KEY=your_key \
node scripts/call_zai_vision_mcp.mjs \
  --image /absolute/path/to/demo.png \
  --prompt "Describe this image"
```

Compare two UI screenshots:

```bash
Z_AI_API_KEY=your_key \
node scripts/call_zai_vision_mcp.mjs \
  --tool ui_diff_check \
  --image /absolute/path/to/before.png \
  --image2 /absolute/path/to/after.png \
  --prompt "Summarize the visual differences"
```

Pass extra tool-specific arguments when needed:

```bash
Z_AI_API_KEY=your_key \
node scripts/call_zai_vision_mcp.mjs \
  --tool ui_to_artifact \
  --image /absolute/path/to/ui.png \
  --prompt "Generate a React component" \
  --set output_type=react
```

## Loading in OpenClaw

If you do not want to move the folder, add its parent directory to `skills.load.extraDirs` in `~/.openclaw/openclaw.json`.

Example:

```json
{
  "skills": {
    "load": {
      "extraDirs": [
        "/Users/you/Github"
      ]
    }
  }
}
```

If this repo is cloned at `/Users/you/Github/openclawd-zai-skills`, OpenClaw will discover that directory as a skill folder because it contains `SKILL.md`.

## Notes

- The wrapper is dependency-free on the client side. It uses only Node built-ins.
- The wrapper avoids long-running stdio through `npx`; it resolves the server package and launches the server entry with `node`.
- If `@z_ai/mcp-server` is not present yet, the wrapper installs it into a temp cache root before launching it.
- The wrapper forces the server log path into `/tmp` by default to avoid `~/.zai/...log` permission failures in sandboxed runs.
- The wrapper times out by default after 60 seconds. Override with `--timeout-ms` or `MCP_REQUEST_TIMEOUT_MS`.
- This wrapper auto-selects a tool when `--tool` is omitted, but you can force a specific tool with `--tool`.
- Tool argument names can vary over time. The wrapper first inspects each tool's input schema and then fills common fields like image path and prompt heuristically.
