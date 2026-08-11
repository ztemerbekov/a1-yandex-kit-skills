# Agent Plugins schema snapshots

These files are pinned copies of the official Agent Plugins 1.0.0 JSON Schemas used
by the repository's offline validation.

- [plugin.schema.json](./1.0.0/plugin.schema.json)
- [mcp.schema.json](./1.0.0/mcp.schema.json)

Source of truth: [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec),
revision checked on 2026-08-11. The corresponding canonical schema URLs are embedded
in the schemas and referenced by the root `plugin.json` and `mcp.json`.

Update these snapshots only when deliberately adopting another Agent Plugins schema
version, and keep the repository validator and migration documentation on the same
version.
