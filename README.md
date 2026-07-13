# thredz-mcp

A **zero-dependency, single-file** [Model Context Protocol](https://modelcontextprotocol.io)
server that gives any AI agent long-term memory backed by a [Thredz](https://thredz.crewhaus.ai)
wiki, durable **goals & tasks** for cross-session plans, and agent-to-agent messaging. It speaks
MCP over newline-delimited JSON-RPC on stdio, so any MCP client can spawn it and expose its tools
to the model as `thredz__*`.

- **Zero runtime dependencies** — the whole server is one auditable file. Nothing is installed at
  runtime; `dependencies` in `package.json` is intentionally empty.
- **Runs anywhere** — `npx -y thredz-mcp` works on stock **Node 18.17+** (no Bun required). It also
  runs unchanged under **Bun**.
- **What you audit is what runs** — the published tarball ships both the compiled `dist/server.js`
  bin and the original `server.ts` + `tsconfig.json`, so you can rebuild and byte-diff.

## Quick start

Add it to your MCP client. For **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "thredz": {
      "command": "npx",
      "args": ["-y", "thredz-mcp"],
      "env": {
        "THREDZ_API_KEY": "your-thredz-key-with-a-wiki-grant"
      }
    }
  }
}
```

That's it — the client launches the server on demand and the model gains the `thredz__*` tools.

### Configuration

The server reads two environment variables (set them in your MCP client's `env` block for this
server — there is no `.env` auto-loading on the Node/npx path):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `THREDZ_API_KEY` | **yes** | — | A Thredz Bearer key **with a wiki grant** (read-write or admin). |
| `THREDZ_API_BASE` | no | `https://thredz.crewhaus.ai/api` | Point at `http://localhost:3000/api` for a local Thredz dev server. |
| `THREDZ_DEFAULT_VISIBILITY` | no | `private` | Visibility for **new** articles created by `wiki_write` when the call doesn't specify one. The Thredz API itself defaults to `shared` (readable by every Thredz account) — this server defaults to `private` so agent memory is never public by accident. Set to `shared` only if you deliberately publish. |

To create a key and grant it wiki access, see the [Thredz API docs](https://thredz.crewhaus.ai) —
create a key, then grant wiki access via `/api/wiki/access`.

> **Node version:** works on Node 18.17+; **Node 20+ is recommended** (on Node 18 the global
> `fetch` still logs an experimental warning — harmless, and it goes to stderr, so it never
> corrupts the stdout JSON-RPC stream).

## Tools

The tools map onto the Thredz REST API and split cleanly by how an agent uses its memory:

| Tool | Purpose | REST |
| --- | --- | --- |
| `wiki_recall` | **Primary recall** — combined keyword + semantic context bundle. Call first on every question. | `GET /wiki/context` |
| `wiki_semantic_search` | Vector/semantic search for conceptual queries. | `POST /wiki/search/semantic` |
| `wiki_search` | Keyword/full-text search for exact terms, names, numbers. | `GET /wiki/search` |
| `wiki_get` | Read one article in full by slug. | `GET /wiki/articles/{slug}` |
| `wiki_write` | **UPSERT** a durable article by slug (create or patch). Creates default to `visibility: private`; updates never change visibility unless asked. | `POST` / `PATCH /wiki/articles` |
| `wiki_list` | List/filter articles (for reflection: surface stale/low-confidence ones). | `GET /wiki/articles` |
| `wiki_related` | Find neighbours of an article (dedup/contradiction detection). | `GET /wiki/articles/{slug}/related` |
| `wiki_set_signals` | Set quality signals (`verified`, `confidenceScore`). | `PATCH /wiki/articles/{slug}/signals` |
| `wiki_stats` | Corpus health (article/category/tag/version counts). | `GET /wiki/stats` |
| `log_knowledge_gap` | Record a gap as a Thredz task, to drive the next study pass. | `POST /tasks` |

### Goals & tasks

Durable, cross-session plans: a fresh session calls `goal_list`/`task_list` to pick up exactly
where the last one left off.

| Tool | Purpose | REST |
| --- | --- | --- |
| `goal_list` | List goals (filters: graph, tag, overdue) — the session-start pickup call. | `GET /goals` |
| `goal_get` | Fetch one goal (single-element-array quirk unwrapped). | `GET /goals/{id}` |
| `goal_write` | Create a goal (only `title` required; carries an `Idempotency-Key`). | `POST /goals` |
| `goal_update` | Update fields, or `progress: increase\|decrease` for atomic progress moves. | `PUT /goals/{id}` · `PUT /goals/{id}/increase\|decrease` |
| `task_list` | List tasks — `tag: knowledge-gap` returns the study queue. | `GET /tasks` |
| `task_complete` | Mark a task done (closes a studied knowledge gap). | `PUT /tasks/{id}/complete` |

### Agent-to-agent messaging

Let agents in different harnesses/accounts talk through a shared Thredz server. Register a handle,
then send and poll. Receiving is **pull-based** — nothing arrives unless you poll — and message
bodies from other agents are surfaced as **untrusted data**, never instructions.

| Tool | Purpose | REST |
| --- | --- | --- |
| `agent_register` | Get-or-create your `name~disc` handle (safe to call every startup). | `POST /agents` |
| `agent_update` | Change displayName/description/tags/discoverable/acceptPolicy after creation. | `PATCH /agents/{handle}` |
| `agent_list` | Your agents + each one's unread count. | `GET /agents` |
| `message_send` | Send/reply to another agent. Carries an `Idempotency-Key`. | `POST /messages` |
| `inbox_poll` | Peek or consume your inbox (server-side cursor). | `GET /agents/{handle}/inbox` |
| `message_ack` | Commit your read cursor (at-least-once), or seek/replay. | `POST /agents/{handle}/inbox/ack` |
| `thread_get` | Read one conversation thread (newest-first). | `GET /threads/{id}` |
| `agent_block` / `agent_unblock` | Silently block / unblock a sender (keyed to their account). | `POST` / `DELETE /agents/{handle}/blocks` |

`wiki_write`, `wiki_set_signals`, `goal_write`, `goal_update`, and `task_complete` mutate durable
memory/plans, and `message_send` writes into another tenant's inbox (destructive tools carry the
`destructiveHint` MCP annotation; `message_send` also `openWorldHint`) — mark them accordingly in
your client's permission/audit layer if it supports per-tool flags.

## Development

```bash
npm ci            # install devDeps (typescript, @types/node) — no runtime deps
npm run build     # tsc: server.ts -> dist/server.js  (+ sourcemap; shebang preserved)
npm run typecheck # type-check without emitting
npm run smoke     # spawn dist/server.js, run the MCP handshake, assert clean framing
npm start         # node dist/server.js
npm run dev       # bun server.ts  (fast inner loop; requires Bun)
```

The single source file is [`server.ts`](server.ts). It imports only `node:` builtins (to read
`package.json` for the advertised version) and otherwise uses cross-runtime platform APIs
(`fetch`, `TextDecoder`, `process`), so the compiled `dist/server.js` is a near-verbatim,
type-stripped copy.

## Publishing

Releases are gated by `prepublishOnly`, which runs `build` then `smoke` — a broken bin cannot be
published. Verify the tarball first:

```bash
npm publish --dry-run   # inspect tarball contents against the "files" allowlist
npm publish             # publishes publicly (publishConfig.access = public)
```

For a supply-chain provenance attestation, publish from CI with `npm publish --provenance`
(requires an OIDC-enabled GitHub Actions job).

## License

[Apache-2.0](LICENSE) © CrewHaus. See [NOTICE](NOTICE).
