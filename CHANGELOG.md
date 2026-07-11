# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
