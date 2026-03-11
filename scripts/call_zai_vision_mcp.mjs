#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_PROTOCOL_VERSION =
  process.env.MCP_PROTOCOL_VERSION || "2025-06-18";
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.MCP_REQUEST_TIMEOUT_MS || "60000",
  10
);

function printHelp() {
  console.log(`Usage:
  node scripts/call_zai_vision_mcp.mjs [options]

Options:
  --image <path>         Primary local image path
  --image2 <path>        Secondary local image path for compare/diff tools
  --video <path>         Local video path
  --prompt <text>        User instruction passed to the tool
  --tool <name>          Force a specific MCP tool
  --timeout-ms <n>       Request timeout in milliseconds
  --set <key=value>      Extra tool argument, can be repeated
  --json-args <json>     Raw JSON object merged into tool arguments
  --list-tools           List available MCP tools and exit
  --print-schema         Print the chosen tool schema before calling it
  --debug                Print stderr from the MCP server to stderr
  --help                 Show this help

Environment:
  Z_AI_API_KEY           Required by @z_ai/mcp-server
  Z_AI_MODE              Optional: ZHIPU or ZAI
  ZAI_MCP_ENTRY          Optional absolute path to @z_ai/mcp-server/build/index.js
  ZAI_MCP_INSTALL_ROOT   Optional install/cache root, default: ${os.tmpdir()}/openclaw-zai-mcp-server
  ZAI_MCP_LOG_PATH       Optional writable log file, default: ${os.tmpdir()}/zai-mcp.log
  MCP_REQUEST_TIMEOUT_MS Optional override, default: 60000
  MCP_PROTOCOL_VERSION   Optional override, default: 2025-06-18
`);
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function shellSplit(input) {
  if (!input) return [];
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        i += 1;
        current += input[i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (ch === "\\" && i + 1 < input.length) {
      i += 1;
      current += input[i];
      continue;
    }

    current += ch;
  }

  if (quote) {
    fail(`Unterminated quote in ZAI_MCP_ARGS: ${input}`);
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseArgs(argv) {
  const options = {
    extras: {},
    debug: false,
    listTools: false,
    printSchema: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--debug") {
      options.debug = true;
      continue;
    }

    if (arg === "--list-tools") {
      options.listTools = true;
      continue;
    }

    if (arg === "--print-schema") {
      options.printSchema = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next) {
      fail(`Missing value for ${arg}`);
    }

    if (arg === "--image") {
      options.image = next;
      i += 1;
      continue;
    }

    if (arg === "--image2") {
      options.image2 = next;
      i += 1;
      continue;
    }

    if (arg === "--video") {
      options.video = next;
      i += 1;
      continue;
    }

    if (arg === "--prompt") {
      options.prompt = next;
      i += 1;
      continue;
    }

    if (arg === "--tool") {
      options.tool = next;
      i += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = parseValue(next);
      i += 1;
      continue;
    }

    if (arg === "--json-args") {
      try {
        options.jsonArgs = JSON.parse(next);
      } catch (error) {
        fail(`Invalid JSON for --json-args: ${error.message}`);
      }
      i += 1;
      continue;
    }

    if (arg === "--set") {
      const eq = next.indexOf("=");
      if (eq === -1) {
        fail(`--set expects key=value, got: ${next}`);
      }
      const key = next.slice(0, eq);
      const value = next.slice(eq + 1);
      options.extras[key] = parseValue(value);
      i += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function ensureFile(filePath, label) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    fail(`${label} not found: ${absolute}`);
  }
  return absolute;
}

function newestDirFirst(a, b) {
  try {
    const aTime = fs.statSync(a).mtimeMs;
    const bTime = fs.statSync(b).mtimeMs;
    return bTime - aTime;
  } catch {
    return 0;
  }
}

function findCachedServerEntry() {
  const npmDir = path.join(os.homedir(), ".npm", "_npx");
  if (!fs.existsSync(npmDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(npmDir)
    .map((name) =>
      path.join(
        npmDir,
        name,
        "node_modules",
        "@z_ai",
        "mcp-server",
        "build",
        "index.js"
      )
    )
    .filter((entry) => fs.existsSync(entry))
    .sort(newestDirFirst);

  return candidates[0] || null;
}

function installServerPackage(installRoot) {
  fs.mkdirSync(installRoot, { recursive: true });

  const result = spawnSync(
    "npm",
    [
      "install",
      "--no-save",
      "--prefix",
      installRoot,
      "@z_ai/mcp-server@latest",
    ],
    {
      env: {
        ...process.env,
        npm_config_update_notifier: "false",
        npm_config_fund: "false",
        npm_config_audit: "false",
      },
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    fail(
      `Failed to install @z_ai/mcp-server@latest\n${result.stderr || result.stdout}`
    );
  }

  const entry = path.join(
    installRoot,
    "node_modules",
    "@z_ai",
    "mcp-server",
    "build",
    "index.js"
  );

  if (!fs.existsSync(entry)) {
    fail(`Installed package but entry was not found: ${entry}`);
  }

  return entry;
}

function resolveServerLaunch() {
  if (process.env.ZAI_MCP_COMMAND) {
    return {
      command: process.env.ZAI_MCP_COMMAND,
      args: shellSplit(process.env.ZAI_MCP_ARGS || ""),
      env: {
        ...process.env,
      },
    };
  }

  const installRoot =
    process.env.ZAI_MCP_INSTALL_ROOT ||
    path.join(os.tmpdir(), "openclaw-zai-mcp-server");

  const directEntry =
    process.env.ZAI_MCP_ENTRY ||
    path.join(
      installRoot,
      "node_modules",
      "@z_ai",
      "mcp-server",
      "build",
      "index.js"
    ) ||
    findCachedServerEntry();

  const entry =
    directEntry && fs.existsSync(directEntry)
      ? directEntry
      : findCachedServerEntry() || installServerPackage(installRoot);

  return {
    command: "node",
    args: [entry],
    env: {
      ...process.env,
      ZAI_MCP_LOG_PATH:
        process.env.ZAI_MCP_LOG_PATH ||
        path.join(os.tmpdir(), "zai-mcp.log"),
    },
  };
}

class McpStdioClient {
  constructor({ command, args, env, debug, timeoutMs }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.debug = debug;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.stderrChunks = [];
    this.stdoutNoise = [];
  }

  async start() {
    this.proc = spawn(this.command, this.args, {
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.proc.stderr.on("data", (chunk) => this.onStderr(chunk));
    this.proc.on("exit", (code, signal) => {
      const error = new Error(
        `MCP server exited before completing the request (code=${code}, signal=${signal ?? "none"})`
      );
      for (const { reject } of this.pending.values()) {
        reject(error);
      }
      this.pending.clear();
    });
    this.proc.on("error", (error) => {
      for (const { reject } of this.pending.values()) {
        reject(error);
      }
      this.pending.clear();
    });
  }

  onStderr(chunk) {
    const text = chunk.toString("utf8");
    this.stderrChunks.push(text);
    if (this.stderrChunks.join("").length > 6000) {
      this.stderrChunks = [this.stderrChunks.join("").slice(-6000)];
    }
    if (this.debug) {
      process.stderr.write(text);
    }
  }

  onStdout(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const message = this.readMessage();
      if (message === null) {
        return;
      }
      this.onMessage(message);
    }
  }

  readMessage() {
    if (this.buffer.length === 0) {
      return null;
    }

    const contentLengthMatch = this.buffer
      .toString("utf8", 0, Math.min(this.buffer.length, 64))
      .match(/^Content-Length:\s*(\d+)/i);

    if (contentLengthMatch) {
      const marker = this.buffer.indexOf("\r\n\r\n");
      if (marker === -1) {
        return null;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1], 10);
      const bodyStart = marker + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        return null;
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);
      return this.parseMessage(body);
    }

    const newline = this.buffer.indexOf("\n");
    if (newline === -1) {
      return null;
    }

    const line = this.buffer.toString("utf8", 0, newline).replace(/\r$/, "");
    this.buffer = this.buffer.subarray(newline + 1);

    if (line.trim() === "") {
      return null;
    }

    try {
      return this.parseMessage(line);
    } catch (error) {
      this.stdoutNoise.push(line);
      if (this.stdoutNoise.join("\n").length > 6000) {
        this.stdoutNoise = [this.stdoutNoise.join("\n").slice(-6000)];
      }

      if (this.debug) {
        process.stderr.write(`[stdout-noise] ${line}\n`);
      }

      return null;
    }
  }

  parseMessage(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`Failed to parse MCP response: ${error.message}`);
    }
  }

  onMessage(message) {
    if (typeof message.id !== "undefined") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);

      if (message.error) {
        const err = new Error(
          `${message.error.message || "Unknown MCP error"}`
        );
        err.data = message.error.data;
        pending.reject(err);
        return;
      }

      pending.resolve(message.result);
    }
  }

  send(message) {
    const json = JSON.stringify(message);
    const payload = `${json}\n`;
    this.proc.stdin.write(payload, "utf8");
  }

  request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Timed out waiting for MCP response to "${method}" after ${this.timeoutMs}ms`
          )
        );
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  notify(method, params = {}) {
    this.send({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "openclaw-zai-vision-wrapper",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result.tools || [];
  }

  async callTool(name, args) {
    return this.request("tools/call", {
      name,
      arguments: args,
    });
  }

  async close() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }

  stderrTail() {
    return this.stderrChunks.join("").trim();
  }

  stdoutNoiseTail() {
    return this.stdoutNoise.join("\n").trim();
  }
}

function chooseTool(tools, options) {
  if (options.tool) {
    return options.tool;
  }

  const toolNames = new Set(tools.map((tool) => tool.name));
  const prompt = (options.prompt || "").toLowerCase();

  if (options.video && toolNames.has("analyze_video")) {
    return "analyze_video";
  }

  if (options.image2 && toolNames.has("ui_diff_check")) {
    return "ui_diff_check";
  }

  if (
    /(ocr|extract text|read text|识别文字|提取文字|截图文字|终端|terminal|code screenshot|文档截图)/i.test(
      prompt
    ) &&
    toolNames.has("extract_text_from_screenshot")
  ) {
    return "extract_text_from_screenshot";
  }

  if (
    /(error|stack|trace|log screenshot|报错|异常|弹窗|堆栈|日志截图)/i.test(prompt) &&
    toolNames.has("diagnose_error_screenshot")
  ) {
    return "diagnose_error_screenshot";
  }

  if (
    /(uml|er diagram|architecture|flowchart|diagram|架构图|流程图|技术图|时序图)/i.test(
      prompt
    ) &&
    toolNames.has("understand_technical_diagram")
  ) {
    return "understand_technical_diagram";
  }

  if (
    /(dashboard|chart|plot|trend|visualization|仪表盘|图表|趋势图|统计图)/i.test(
      prompt
    ) &&
    toolNames.has("analyze_data_visualization")
  ) {
    return "analyze_data_visualization";
  }

  if (
    /(ui to code|react|vue|html|css|artifact|设计稿|还原界面|生成组件)/i.test(prompt) &&
    toolNames.has("ui_to_artifact")
  ) {
    return "ui_to_artifact";
  }

  if (toolNames.has("analyze_video") && options.video) {
    return "analyze_video";
  }

  if (toolNames.has("analyze_image")) {
    return "analyze_image";
  }

  return tools[0]?.name;
}

function isPromptKey(name) {
  return /^(prompt|query|question|instruction|task|text|request)$/i.test(name);
}

function isPrimaryImageKey(name) {
  return /^(image|image_path|imagepath|image_source|screenshot|screenshot_path|filepath|file_path|path|source_image|source_image_path|expected_image_source)$/i.test(
    name
  );
}

function isSecondaryImageKey(name) {
  return /^(image2|image2_path|second_image|second_image_path|after_image|after_image_path|target_image|target_image_path|compare_image|compare_image_path|actual_image_source)$/i.test(
    name
  );
}

function isVideoKey(name) {
  return /^(video|video_path|video_source)$/i.test(name);
}

function buildArguments(tool, options) {
  const args = {
    ...(options.jsonArgs || {}),
    ...options.extras,
  };

  const schema = tool.inputSchema || {};
  const properties = schema.properties || {};
  const names = Object.keys(properties);

  const media = {
    image: options.image ? ensureFile(options.image, "image") : null,
    image2: options.image2 ? ensureFile(options.image2, "image2") : null,
    video: options.video ? ensureFile(options.video, "video") : null,
  };

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(args, name)) {
      continue;
    }

    const normalized = name.toLowerCase();
    const prop = properties[name] || {};

    if (isPromptKey(normalized) && options.prompt) {
      args[name] = options.prompt;
      continue;
    }

    if (prop.type === "array" && /image/i.test(normalized) && media.image) {
      args[name] = media.image2 ? [media.image, media.image2] : [media.image];
      continue;
    }

    if (isPrimaryImageKey(normalized) && media.image) {
      args[name] = media.image;
      continue;
    }

    if (isSecondaryImageKey(normalized) && media.image2) {
      args[name] = media.image2;
      continue;
    }

    if (isVideoKey(normalized) && media.video) {
      args[name] = media.video;
      continue;
    }
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter(
    (name) => !Object.prototype.hasOwnProperty.call(args, name)
  );

  return {
    args,
    missing,
    schema,
  };
}

function summarizeTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema || {},
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!process.env.Z_AI_API_KEY) {
    fail("Z_AI_API_KEY is required");
  }

  const serverLaunch = resolveServerLaunch();

  const client = new McpStdioClient({
    command: serverLaunch.command,
    args: serverLaunch.args,
    env: serverLaunch.env,
    debug: options.debug,
    timeoutMs:
      options.timeoutMs || DEFAULT_TIMEOUT_MS,
  });

  try {
    await client.start();
    await client.initialize();

    const tools = await client.listTools();

    if (options.listTools) {
      console.log(JSON.stringify(summarizeTools(tools), null, 2));
      return;
    }

    const toolName = chooseTool(tools, options);
    if (!toolName) {
      fail("No tools were returned by the MCP server");
    }

    const tool = tools.find((item) => item.name === toolName);
    if (!tool) {
      fail(
        `Tool not found: ${toolName}\nAvailable tools: ${tools
          .map((item) => item.name)
          .join(", ")}`
      );
    }

    const { args: toolArgs, missing, schema } = buildArguments(tool, options);

    if (options.printSchema) {
      console.error(JSON.stringify(schema, null, 2));
    }

    if (missing.length > 0) {
      fail(
        `Missing required arguments for tool "${toolName}": ${missing.join(
          ", "
        )}\nUse --set key=value or --json-args to provide them.`
      );
    }

    const result = await client.callTool(toolName, toolArgs);
    console.log(
      JSON.stringify(
        {
          tool: toolName,
          arguments: toolArgs,
          result,
        },
        null,
        2
      )
    );
  } catch (error) {
    const stderrTail = client.stderrTail();
    const stdoutNoise = client.stdoutNoiseTail();
    const details = {
      error: error.message,
      stdoutNoise: stdoutNoise || undefined,
      stderr: stderrTail || undefined,
    };
    console.error(JSON.stringify(details, null, 2));
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
