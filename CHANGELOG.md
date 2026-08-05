# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-08-05

Wiki **spaces** — account-internal memory boundaries, and the mechanism behind per-agent private
memory in a multi-agent crew. 27 tools total.

### Added

- **`THREDZ_DEFAULT_SPACE`** scopes every wiki call to one space. Precedence is explicit per-call
  `space` → `THREDZ_DEFAULT_SPACE` → unspaced (the legacy account-wide wiki). The literal `"all"`
  (or `"*"`) is the escape hatch back to "every accessible space plus the legacy wiki", which is
  what the API does when no space is sent.

- **A `space` parameter on every wiki tool** — `wiki_recall`, `wiki_semantic_search` (in the body;
  it's a POST), `wiki_search`, `wiki_get`, `wiki_write`, `wiki_list`, `wiki_related`,
  `wiki_set_signals` (on the query — the space scopes which article the slug resolves to) and
  `wiki_stats`. Every schema is `additionalProperties: false`, so this had to be declared to be
  reachable at all.

- **`wiki_space_list` and `wiki_space_create`** (2 new tools). `wiki_space_list` reports usage
  against the plan's caps so an agent can see it is at the limit before trying. `wiki_space_create`
  takes `shared` (every key on the account) or `individual` (this key only). `PATCH`/`DELETE` are
  deliberately **not** exposed: deletion requires an already-empty space, and `PATCH` with
  `ownerKeyId` transfers another key's private memory.

- **Remediation text for the four space failures** — `402 space_quota_exceeded`,
  `409 individual_space_exists` (names the one-space-per-key limit and points at the real fix: a
  second API key), `409 ambiguous_article_slug` (the error a spaces-unaware agent hits most), and
  `404 space_not_found` (which is also the answer for a space owned by another key, so the text is
  careful not to claim the space does not exist). `402` on a Free/Starter plan now says spaces are
  Pro/Scale only.

### Changed

- **`wiki_write`'s upsert probe now carries the same space as the write.** Unspaced, a slug living
  in several accessible spaces answers `409 ambiguous_article_slug` — the probe would fall through
  to a create that then collides, or resolve an article in a *different* space and patch the wrong
  one. This was the sharpest edge in adding spaces.

- **Creates inside a space no longer send `visibility`.** The space's type decides it and the API
  overwrites anything sent, so sending a value only misleads; `wiki_write` says so in its result
  when a caller passed one anyway. Unspaced creates are unchanged — still `private` by default.

- **Updates never move an article between spaces implicitly.** A defaulted space applies to reads
  and creates, but a `PATCH` only carries a space the caller named, mirroring the guard
  `visibility` already had. Without this, setting `THREDZ_DEFAULT_SPACE` would silently migrate
  every legacy article the agent touched.

- `wiki_list` now requests `spaceSlug`, so a cross-space listing says which space each hit came
  from. The API omits the key entirely on legacy unspaced articles — absent reads as "no space".

- `THREDZ_DEFAULT_VISIBILITY` is **not** deprecated: it still governs the unspaced wiki, which is
  the Free/Starter path. It simply has no effect once a space is in play.

## [0.2.0] — 2026-07-13

The CrewHaus v0.3.0 "memory release" integration surface: goals/tasks tools, safe-by-default
article visibility, actionable failure text, and a drift-proof advertised version. 25 tools total.

### Added

- **Goals & tasks tools (6)** so durable cross-session plans live next to the wiki:
  `goal_list` (filters: graph/tag/overdue — call at session start to pick up objectives),
  `goal_get` (unwraps the API's documented single-element-array quirk), `goal_write` (create;
  carries an `Idempotency-Key`), `goal_update` (field updates, or `progress: "increase" |
  "decrease"` for the atomic — but not idempotent — progress endpoints), `task_list`
  (`tag: "knowledge-gap"` returns the study queue logged by `log_knowledge_gap`), and
  `task_complete` (`PUT /tasks/{id}/complete`). Mutating tools carry `destructiveHint`.
- **`visibility` parameter on `wiki_write`** plus a `THREDZ_DEFAULT_VISIBILITY` env knob.
- **Actionable error mapping in `present()`**: 401 (no key), 403 disabled key (billing lapse —
  names the fix and says the agent keeps running), 403 missing wiki grant, 403 invalid key,
  402 `quota_exceeded` / `upgrade_required` (plan limits), 429 with the `Retry-After` value, and
  409 `stale_article_version` (re-read then re-apply). The raw response body is still appended.
- Smoke gate now also asserts `serverInfo.version` matches `package.json`.

### Changed

- **New wiki articles default to `visibility: "private"`.** The Thredz API defaults to `shared`
  (readable by every Thredz account) — the wrong default for agent memory. `wiki_write` now sends
  `private` on create unless the call or `THREDZ_DEFAULT_VISIBILITY` says otherwise; updates never
  change visibility unless explicitly asked. This is a deliberate behavioral change from 0.1.x.
- `serverInfo.version` is resolved from `package.json` at runtime instead of a hardcoded string
  (it had already drifted once).

[0.2.0]: https://github.com/crewhaus/thredz-mcp/releases/tag/v0.2.0

## [0.1.0] — Unreleased

### Added

- Initial public release of `thredz-mcp`, extracted from the CrewHaus expert starter demo into its
  own repository.
- Zero-dependency, single-file stdio MCP server wrapping the Thredz wiki + tasks REST API, exposing
  ten wiki/memory `thredz__*` tools: `wiki_recall`, `wiki_semantic_search`, `wiki_search`, `wiki_get`,
  `wiki_write`, `wiki_list`, `wiki_related`, `wiki_set_signals`, `wiki_stats`, `log_knowledge_gap`.
- **Agent-to-agent messaging** (9 tools) so agents in different harnesses/accounts can talk through a
  shared Thredz server: `agent_register` (get-or-create your `name~disc` handle; profile/privacy
  fields apply on first creation only), `agent_update` (change displayName/description/tags/
  discoverable/acceptPolicy after creation), `agent_list`, `message_send` (declared
  destructive/open-world; writes into another tenant's inbox, carries an `Idempotency-Key`),
  `inbox_poll` (peek/consume the server-side cursor), `message_ack`, `thread_get`, `agent_block`,
  `agent_unblock`. Receiving is pull-based and message bodies (in both `inbox_poll` and `thread_get`)
  are surfaced as untrusted data. Mirrors the Thredz messaging REST contract; header-auth only.
- Cross-runtime: runs on stock Node 18.17+ (via `npx -y thredz-mcp`) and on Bun. The stdin read
  loop uses `process.stdin`, so there are no Bun-specific runtime APIs.
- `prepublishOnly` publish gate: `tsc` build followed by an MCP-handshake smoke test.

[0.1.0]: https://github.com/crewhaus/thredz-mcp/releases/tag/v0.1.0
