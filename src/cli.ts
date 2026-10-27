#!/usr/bin/env node
/**
 * litebase CLI.
 *
 *   litebase mcp [db-path]
 *   litebase query <db> <sql>
 *   litebase tables <db>
 *   litebase --version
 *
 * Exit codes: 0 success, 1 query/database error, 2 usage error.
 * `query` is read-only (SELECT/WITH), enforced by the core guards.
 * For the `mcp` subcommand the database path may also come from the
 * LITEBASE_DB environment variable; the default is ./litebase.db.
 */
import { LitebaseDb, resolveDbPath, VERSION } from "./db.js";

function usage(): never {
  console.error(`Usage:
  litebase mcp [db-path]
  litebase query <db> <sql>
  litebase tables <db>
  litebase --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "query") {
      const [dbPath, ...sqlParts] = rest;
      const sql = sqlParts.join(" ");
      if (!dbPath || !sql) usage();
      const db = new LitebaseDb(resolveDbPath(dbPath));
      try {
        console.log(JSON.stringify(db.readQuery(sql), null, 2));
      } finally {
        db.close();
      }
    } else if (cmd === "tables") {
      const [dbPath] = rest;
      if (!dbPath) usage();
      const db = new LitebaseDb(resolveDbPath(dbPath));
      try {
        const { tables } = db.listTables();
        if (tables.length === 0) console.log("(no tables)");
        else for (const t of tables) console.log(t);
      } finally {
        db.close();
      }
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
