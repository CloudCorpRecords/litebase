# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `litebase query <db> <sql>` runs a read query and prints the
  rows as JSON; `litebase tables <db>` lists user tables;
  `litebase mcp [db-path]` starts the MCP server.
- MCP server (stdio) with six tools: `read_query`, `write_query`,
  `create_table`, `list_tables`, `describe_table`, and
  `append_insight`.
- Statement guards: reads accept a single SELECT/WITH statement only,
  writes accept INSERT/UPDATE/DELETE only, table creation accepts
  CREATE TABLE only, and multi-statement input is rejected.
- Storage engine is Node's built-in `node:sqlite` module; no native
  addons and no runtime dependencies beyond the MCP SDK.
