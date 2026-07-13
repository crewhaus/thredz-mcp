#!/usr/bin/env node
/**
 * Smoke test / publish gate. Spawns the built bin (dist/server.js), performs the
 * MCP handshake over stdio, and asserts:
 *   - `initialize` returns serverInfo.name === "thredz"
 *   - `tools/list` returns the full tool set
 *   - stdout carries ONLY newline-delimited JSON-RPC frames (nothing leaks)
 *
 * No THREDZ_API_KEY is needed — these methods are answered offline, before any
 * HTTP call. Exits non-zero on any failure so `prepublishOnly` blocks a bad publish.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "dist", "server.js");
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const EXPECTED_TOOLS = [
  "wiki_recall",
  "wiki_semantic_search",
  "wiki_search",
  "wiki_get",
  "wiki_write",
  "wiki_list",
  "wiki_related",
  "wiki_set_signals",
  "wiki_stats",
  "log_knowledge_gap",
  // Goals & tasks
  "goal_list",
  "goal_get",
  "goal_write",
  "goal_update",
  "task_list",
  "task_complete",
  // Agent-to-agent messaging
  "agent_register",
  "agent_update",
  "agent_list",
  "message_send",
  "inbox_poll",
  "message_ack",
  "thread_get",
  "agent_block",
  "agent_unblock",
];

const fail = (msg) => {
  console.error(`smoke: FAIL — ${msg}`);
  process.exit(1);
};

const child = spawn(process.execPath, [BIN], {
  stdio: ["pipe", "pipe", "inherit"], // stderr (diagnostics) passes through
  env: { ...process.env, THREDZ_API_KEY: "" }, // prove no key is needed for the handshake
});

let out = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  out += d;
});

child.on("error", (e) => fail(`could not spawn ${BIN}: ${e.message}`));

child.on("close", (code) => {
  if (code !== 0) return fail(`server exited with code ${code}`);

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return fail("server produced no stdout");

  const frames = [];
  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line); // every stdout line MUST be a JSON-RPC frame
    } catch {
      return fail(`non-JSON line leaked to stdout: ${line.slice(0, 80)}`);
    }
    if (msg.jsonrpc !== "2.0") return fail(`frame missing jsonrpc:"2.0": ${line.slice(0, 80)}`);
    frames.push(msg);
  }

  const init = frames.find((m) => m.id === 1);
  if (!init?.result?.serverInfo || init.result.serverInfo.name !== "thredz") {
    return fail(`initialize did not return serverInfo.name "thredz": ${JSON.stringify(init)}`);
  }
  // serverInfo.version is resolved from package.json at runtime — assert it so
  // a version bump can never ship with a stale advertised version again.
  if (init.result.serverInfo.version !== PKG.version) {
    return fail(`serverInfo.version "${init.result.serverInfo.version}" != package.json version "${PKG.version}"`);
  }

  const list = frames.find((m) => m.id === 2);
  const names = (list?.result?.tools ?? []).map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
  if (missing.length) return fail(`tools/list missing: ${missing.join(", ")}`);
  // Catch drift in the other direction too — an advertised tool not in the
  // expected set means the publish gate is no longer verifying the full surface.
  const unexpected = names.filter((t) => !EXPECTED_TOOLS.includes(t));
  if (unexpected.length) return fail(`tools/list has unlisted tools (add to EXPECTED_TOOLS): ${unexpected.join(", ")}`);

  console.error(`smoke: OK — initialize + tools/list (${names.length} tools), stdout is pure JSON-RPC`);
  process.exit(0);
});

// Drive the handshake, then close stdin so the server's for-await loop ends.
child.stdin.write(
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n",
);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
child.stdin.end();
