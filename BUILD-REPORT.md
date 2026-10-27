# litebase — Build Report

Wave 1 (Batch 2), MCP Rebuild 100. Clean-room rebuild of the "sqlite"
MCP server (mcp-server-sqlite), built from the public tool spec in
`harness/fixtures/sqlite-tools-original.json` only. Local build only —
nothing pushed or published.

Identity: repo `litebase`, npm `@reneturcios/litebase`,
MCP name `io.github.CloudCorpRecords/litebase`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `litebase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "SQLite database access for agents:
  query, write, create and describe tables, record insights." =
  **93 chars** (≤100 ✓, verified programmatically); npm entry carries
  `version: 0.1.0`; OCI entry `ghcr.io/cloudcorprecords/litebase:0.1.0`
  carries **no** `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT `node /app/dist/cli.js`,
  CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/litebase"`
- `tsconfig.json` (byte-identical to clockport's/shipcheck's, 318 bytes),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios),
  `README.md` (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp [db-path]`, `query <db> <sql>`,
  `tables <db>`, `--version`; exit 2 usage / 1 query error),
  `src/mcp.ts`, `src/types.ts`, `src/db.ts` (core logic, `VERSION = "0.1.0"`)
- `test/db.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (adapted from clockport; image name and smoke-test server name changed)

## Implementation notes

- Engine is Node's built-in `node:sqlite` (`DatabaseSync`) — no native
  addon, no new dependency. It is loaded via `createRequire` inside
  `src/db.ts` and cast to a minimal local interface declared in
  `src/types.ts`, because the fleet's `@types/node` ^20 (20.19.43 on
  disk) has no `node:sqlite` types. `tsconfig.json` is untouched.
- **Honest gap — Node >= 22.5 required at runtime:** `node:sqlite`
  exists only in Node >= 22.5, while `package.json` `engines` says
  `>=20` (fleet standard) and the Dockerfile base is `node:20-alpine`
  (fleet standard). On Node 20 the CLI/server start, but opening a
  database fails with a clear error naming the requirement ("litebase
  could not load Node's built-in SQLite engine (node:sqlite). That
  module requires Node.js >= 22.5 ..."). The import failure is caught
  in `loadDatabaseSync()` and surfaced as exactly that message.
  Documented in the README ("Node version requirement") as well. This
  VM runs Node v24.22.1, where the engine works with no flag.
  The container image inherits the same gap: its initialize/usage
  smoke checks pass on Node 20 (the DB opens lazily), but tool calls
  that touch data need a Node >= 22.5 base — flag for the publish wave.
- Guards (core-enforced, so CLI and MCP behave identically):
  `read_query` accepts a single SELECT/WITH statement only;
  `write_query` accepts INSERT/UPDATE/DELETE only (SELECT/CREATE/DROP
  rejected); `create_table` accepts CREATE TABLE only; a second
  statement after a `;` is rejected before anything executes (one
  trailing semicolon is tolerated). `describe_table` validates the
  name as a plain identifier before interpolating it into
  `PRAGMA table_info(...)` and errors on unknown tables.
  `list_tables` reads `sqlite_master` excluding `sqlite_%` internals.
- `node:sqlite` returns null-prototype row objects; `readQuery`
  normalises rows into plain objects so callers get ordinary,
  deep-comparable rows (caught by the first test run).
- `append_insight` keeps an in-memory list on the core instance and
  returns the full numbered memo text on every call. It is not
  persisted to the database file (documented in the README).
- DB path resolution (core `resolveDbPath`): explicit path wins, then
  env `LITEBASE_DB`, then `./litebase.db`. The MCP server opens the
  database lazily on the first tool call, so starting it and listing
  tools has no filesystem side effects.
- **Deviation from the TEMPLATE §2.12 pattern, with reason:** as with
  clockport, `src/mcp.ts` uses the SDK's low-level `Server` (zod still
  validates every `tools/call`) instead of `McpServer`, whose
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties: false` keys absent from the public spec and
  caps parity at 50%.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang, db.js,
mcp.js, index.js, types.js, plus .d.ts/.js.map).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 17
ℹ suites 6
ℹ pass 17
ℹ fail 0
```
Covers: create_table + list_tables (including `sqlite_sequence`
exclusion), file-DB persistence across instances, insert + read
roundtrip with rows as objects, UPDATE/DELETE affected counts,
WITH...SELECT reads, guard rejections (read with INSERT/DELETE/DROP,
write with SELECT/CREATE/DROP, create with DROP/INSERT/CREATE INDEX,
multi-statement in all three, empty input), describe_table columns
(types / NOT NULL / default / primary key), describe unknown table,
describe invalid identifier, append_insight memo accumulation,
resolveDbPath precedence.

First run was 16/17: the WITH...SELECT test failed because
`node:sqlite` rows are null-prototype objects and fail strict
deep-equal against plain literals; fixed in the core (row
normalisation above), then 17/17.

### 3. MCP + CLI smoke
initialize -> `serverInfo: {"name":"litebase","version":"0.1.0"}`;
live stdio session against a temp file DB: `create_table` ->
`{"success": true}`; `write_query` INSERT -> `affected_rows 1,
last_insert_rowid 1`; `read_query` returned the inserted row as an
object; `describe_table` returned the column list; `append_insight`
returned the memo text "Business insights memo (1 insight): 1. First
user is Ada."; `read_query` with `DROP TABLE users` returned an
isError result naming the guard. CLI checks: `--version` -> `0.1.0`,
`tables` on a fresh DB -> `(no tables)`, `query` printed rows as JSON,
a DELETE via `query` exited 1 with the guard message, unknown command
exited 2 with Usage.

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
Ground truth fixture created for this build:
`harness/fixtures/sqlite-tools-original.json` (tools-file mode — the
original mcp-server-sqlite was UNREACHABLE in the audit environment
per the audited index, and cannot launch live in this VM; see
SCOREBOARD.md blockers). Harness records
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected semantics, not
an error.
```
$ python3 parity.py --original fixtures/sqlite-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/litebase/dist/cli.js mcp" \
    --out /home/hatch/workspace/mcp-rebuild-100/builds/litebase/parity-out
verdict=PASS parity_pct=100.0 original_tools=6 rebuild_tools=6 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms: verdict PASS,
parity_pct 100.0, identical_tools 6, schema_differing_tools 0.

## Lockfile status

`package-lock.json` was copied from shipcheck's and edited with
`muse.edit`: top-level `name`, root package `name`, and root package
`bin` key changed shipcheck -> litebase (dependencies are identical
ranges, so the tree is unchanged). Per the fleet lesson in TEMPLATE.md
§2 item 6, a lockfile must be generated clean (no `node_modules`
present) before first publish — **clean lockfile regen required
before publish**; do not publish from this lockfile as-is.
`node_modules` in this build dir is a `cp -a` copy of shipcheck's
(local build only, gitignored; the copy printed benign
ownership-preservation warnings, files intact — tsc/tsx run from it).

## Blockers / honest gaps

None for the local build. For the publish wave:
- Regenerate `package-lock.json` clean before first publish (above).
- Node >= 22.5 runtime gap (above): `engines >=20` and the
  `node:20-alpine` container base are fleet standard, but data-touching
  calls need Node >= 22.5; consider bumping the Dockerfile base for
  this one tool at publish time.
- Container build not exercised locally (no Docker run in this wave);
  the publish-container workflow smoke-tests the image at publish time.
- Live original parity could not be run (original unreachable, see
  fixture `_source`); parity is against the published public spec.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`. **No source change was needed for this
build**: its tool parameters already carried descriptions (it was the
one Wave 2 unit already at mcpaudit PASS 100/100; it had stopped at
the vet stage only). The dist was rebuilt with the project's own
build and the served surface verified deep-equal to the
pre-remediation tools/list, byte for byte in structure and text.

- Descriptions added: 0 (all 5 served parameters already described).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0; full
  test suite 17/17 pass.
- Parity harness re-run, verbatim: **PASS, parity_pct 100.0** — no
  schema diffs. Full record:
  `publish/parity-remediation/litebase/parity.json`.
- Re-gate: mcpaudit **PASS 100/100 grade A** (raw:
  `publish/regate/litebase-mcpaudit.json`); mcpvet raw **REVIEW,
  risk 50** (raw: `publish/regate/litebase-mcpvet.json`), findings
  adjudicated under GATE-POLICY.md — see PUBLISH-WAVES.md.
