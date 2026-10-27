# litebase

litebase gives you a SQLite database you can drive from a terminal or
hand to an agent as an MCP server. It covers the everyday loop of
working with a small database: create tables, put rows in, change
them, read them back, check what a table looks like, and keep a
running memo of what you learned from the data along the way.

There is nothing to provision and no native addon to compile: the
storage engine is the SQLite library built into Node itself
(`node:sqlite`), so a "database" is just a file path — or `:memory:`
when you want a throwaway one.

## Install

```bash
npx @reneturcios/litebase tables ./data.db
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/litebase
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## Node version requirement

litebase's engine is Node's built-in `node:sqlite` module, which only
exists in **Node 22.5 and newer**. The package's `engines` field says
`>=20` because that is the fleet standard, but that is an honest gap:
on Node 20 the CLI and server start, and then fail the moment a
database is opened, with an error that names the Node >= 22.5
requirement. Use Node 22.5+ (Node 24 recommended) to actually read or
write data.

## CLI

```bash
# List the user tables in a database file
litebase tables ./data.db

# Run a read query; rows print as JSON objects
litebase query ./data.db "SELECT id, name FROM users ORDER BY id"

litebase --version
```

Which database the MCP server opens is resolved in this order: the
path argument after `mcp`, then the `LITEBASE_DB` environment
variable, then `./litebase.db` in the current directory.

Exit codes: `0` on success, `1` when a query or the database itself
errors (the message says why), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/litebase mcp ./data.db
```

MCP client configuration:

```json
{
  "mcpServers": {
    "litebase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/litebase", "mcp", "./data.db"]
    }
  }
}
```

The database is opened lazily on the first tool call, so starting the
server never creates a file by itself.

### Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `read_query` | `query` (string, required) | Runs one SELECT (or WITH ... SELECT) statement and returns the column names plus the rows as objects. |
| `write_query` | `query` (string, required) | Runs one INSERT, UPDATE, or DELETE statement and reports how many rows were affected and the last insert rowid. |
| `create_table` | `query` (string, required) | Runs one CREATE TABLE statement. |
| `list_tables` | — | Lists the database's user tables (SQLite's internal `sqlite_%` tables are hidden). |
| `describe_table` | `table_name` (string, required) | Returns a table's columns with their declared types, nullability, defaults, and primary-key flags. |
| `append_insight` | `insight` (string, required) | Adds a note to the in-memory insights memo and returns the full memo text so far. |

### Statement guards

Each tool only accepts the kind of statement it is for, and only one
statement at a time:

- `read_query` rejects anything that does not start with SELECT or
  WITH.
- `write_query` rejects SELECT, CREATE, DROP, and everything else
  that is not INSERT, UPDATE, or DELETE.
- `create_table` rejects anything that is not CREATE TABLE.
- A second statement smuggled in after a `;` is rejected before
  anything executes.
- `describe_table` only accepts a plain table name (letters, digits,
  underscores) — the name goes into a PRAGMA, so it is validated
  rather than parameterised.

Guard rejections and SQL errors come back as tool errors with a
message naming the problem; nothing is executed on a rejected call.

### Insights memo

`append_insight` keeps a numbered memo on the server instance: every
call appends one insight and returns the whole memo, so an agent can
build up findings during an analysis session and read them back as a
single text. The memo lives in memory only — it is not written to the
database file and does not survive a server restart.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network
npm run dev     # run the CLI from source via tsx
```

Tests run against in-memory and temporary-file databases; no network
access is needed.

## License

MIT — see `LICENSE`.
