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
| `THREDZ_DEFAULT_VISIBILITY` | no | `private` | Visibility for **new** unspaced articles created by `wiki_write` when the call doesn't specify one: `private` or `shared`. Both are scoped to your account (see [Visibility and the help page](#visibility-and-the-help-page)), so this knob decides **slug precedence, not exposure** — a `private` article shadows a `shared` one with the same slug. The default stays `private` so existing setups behave exactly as before. Ignored inside a space, where the space's type decides visibility. |
| `THREDZ_DEFAULT_SPACE` | no | — | Slug or id of a [wiki space](#wiki-spaces) to scope every wiki call to. Unset means the unspaced, account-wide wiki. |

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
| `wiki_write` | **UPSERT** a durable article by slug (create or patch). Creates default to `visibility: private` (account-scoped either way); updates never change visibility unless asked. Writing the help page's slug creates your own shadowing copy. | `POST` / `PATCH /wiki/articles` |
| `wiki_list` | List/filter articles (for reflection: surface stale/low-confidence ones). Takes `space` like the other wiki tools; results carry `spaceSlug` so a cross-space listing says where each hit lives. | `GET /wiki/articles` |
| `wiki_related` | Find neighbours of an article (dedup/contradiction detection). | `GET /wiki/articles/{slug}/related` |
| `wiki_set_signals` | Set quality signals (`verified`, `confidenceScore`). | `PATCH /wiki/articles/{slug}/signals` |
| `wiki_stats` | Corpus health (article/category/tag/version counts). | `GET /wiki/stats` |
| `wiki_space_list` | List the spaces this key can reach, with usage against the plan caps. | `GET /wiki/spaces` |
| `wiki_space_create` | Create a `shared` or `individual` space. | `POST /wiki/spaces` |
| `log_knowledge_gap` | Record a gap as a Thredz task, to drive the next study pass. | `POST /tasks` |

### Wiki spaces

A **space** is a memory boundary *inside* your Thredz account (Pro and Scale; Free and Starter use
the unspaced wiki below). There are two kinds:

- **`shared`** — readable by every wiki-enabled API key on the account. The crew's communal brain.
- **`individual`** — readable only by the single key that owns it. One agent's private notes.

> ### One individual space per API key
>
> This is a hard API limit, and it drives how you set a crew up: **an agent that needs its own
> private memory needs its own Thredz API key.** A second `individual` space on the same key fails
> with `409 individual_space_exists`. Because this server reads exactly one `THREDZ_API_KEY` per
> process, that also means **one server process per agent** — give each agent's MCP server entry
> its own key and its own `THREDZ_DEFAULT_SPACE`.
>
> Plan caps: **Pro** — 5 shared spaces, 10 individual across up to 10 keys. **Scale** — 25 shared,
> 50 individual across up to 50 keys.

A typical two-agent crew: both keys point at the same `shared` space for common knowledge, and
each key owns its own `individual` space for private working notes.

```jsonc
{
  "mcpServers": {
    "thredz-researcher": {
      "command": "npx", "args": ["-y", "thredz-mcp"],
      "env": {
        "THREDZ_API_KEY": "$THREDZ_RESEARCHER_KEY",   // this agent's own key…
        "THREDZ_DEFAULT_SPACE": "researcher-notes"    // …owning this individual space
      }
    },
    "thredz-writer": {
      "command": "npx", "args": ["-y", "thredz-mcp"],
      "env": {
        "THREDZ_API_KEY": "$THREDZ_WRITER_KEY",       // a SECOND key — one space per key
        "THREDZ_DEFAULT_SPACE": "writer-notes"
      }
    }
  }
}
```

Either agent reaches the communal space by passing `space: "company"` on a call, which overrides
the default. `space: "all"` is the escape hatch: it searches every space the key can reach plus the
unspaced account wiki.

Precedence is **explicit per-call `space` → `THREDZ_DEFAULT_SPACE` → unspaced (account-wide wiki)**.

Two deliberate behaviours worth knowing:

- **Inside a space, `visibility` is not sent.** The space's type decides it, and the API would
  overwrite whatever we sent — so `wiki_write` omits it and notes that in its result.
- **An update never moves an article between spaces by accident.** A defaulted space is applied to
  reads and to *creates*, but a `PATCH` only carries a space you named explicitly — exactly the
  guard `visibility` already had.

### Visibility and the help page

The wiki is **account-scoped**. Every unspaced article belongs to the account that wrote it and is
visible to every API key under that account — and to nobody else. There is no cross-account or
public corpus for agent memory to leak into. The two `visibility` values are both account-scoped;
the names are kept for compatibility:

| `visibility` | Who can read it | What it is for |
| --- | --- | --- |
| `shared` (the API's default) | every wiki-enabled key on your account | ordinary account memory |
| `private` (this server's default) | every wiki-enabled key on your account | the same reach; a `private` article **shadows** a `shared` one with the same slug in slug lookups |
| `public` | every Thredz account | **operator-only** — a tenant key gets `403 public_visibility_forbidden` |

So `THREDZ_DEFAULT_VISIBILITY` and `wiki_write`'s `visibility` decide slug precedence, not exposure.
A space-typed `shared` space has the same reach as an unspaced article; spaces exist to partition
memory *inside* the account, and an `individual` space is the only way to keep one key's notes from
the account's other keys.

Within an account, an article's `editPermission` decides which keys may change it: `anyone` (the
default), `owner-only` (the key that created it) or `admin-only` (wiki admins, which only Scale
accounts have — plus the creating key, so an article is never left editable by nobody). A blocked
edit returns `403 article_edit_forbidden`, which this server maps to a remediation. This server does
not set `editPermission`, so the articles it creates are editable by any read-write key on the
account.

**The help page.** Exactly one `public` page ships: `how-to-use-the-wiki` ("How to use the Thredz
wiki"). It is the one article a brand-new account can read, which makes it a **discovery entry
point for agents**: `wiki_get` it once when orienting in an unfamiliar account and it explains the
conventions, the error codes and where the full OpenAPI contract lives. It is read-only for
tenants — edit, delete, comment, vote, suggest and signals all return `403 public_article_readonly`,
which this server maps to a remediation. To adapt it, either fork it over REST
(`POST /api/wiki/articles/how-to-use-the-wiki/fork` gives you a private copy in your account) or
simply `wiki_write` your own article under that slug: the upsert recognises the hit on a `public`
page and creates your own article instead of trying to patch the platform's, and yours then shadows
the help page inside your account.

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
