# openclawd-zai-skills

This repository currently contains one OpenClaw skill: `zai-vision-mcp`.

It is a self-contained OpenClaw skill wrapper for Zhipu's vision MCP server.

You can move this whole directory into any OpenClaw skill location later:

- `<workspace>/skills/openclaw-zai-vision-mcp-skill`
- `~/.openclaw/skills/openclaw-zai-vision-mcp-skill`
- or keep it anywhere and load it via `skills.load.extraDirs`

## What it wraps

The wrapper resolves and starts the official Z.AI vision MCP server entry directly:

```bash
node .../@z_ai/mcp-server/build/index.js
```

Expected environment:

- `Z_AI_API_KEY` (required)
- `Z_AI_MODE` (`ZHIPU` by default, or `ZAI`)
- `ZAI_MCP_LOG_PATH` is auto-set to a writable file under `/tmp` unless you override it

## Files

```text
openclawd-zai-skills/
  README.md
  SKILL.md
  scripts/
    call_zai_vision_mcp.mjs
```

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
