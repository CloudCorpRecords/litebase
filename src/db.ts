/**
 * litebase core: a small guarded wrapper over a SQLite database.
 *
 * The engine is Node's built-in `node:sqlite` module (DatabaseSync),
 * loaded through `createRequire` so this package needs no native addon
 * and no extra dependency. `node:sqlite` exists only in Node >= 22.5;
 * when it cannot be loaded the constructor throws an error that says
 * exactly that (see README, "Node version requirement").
 *
 * Each public operation enforces the statement class it is for:
 *   - readQuery   — a single SELECT (or WITH ... SELECT) statement
 *   - writeQuery  — a single INSERT, UPDATE, or DELETE statement
 *   - createTable — a single CREATE TABLE statement
 * Multi-statement input is rejected everywhere before anything runs.
 *
 * Insights are kept in memory on the instance: `appendInsight` adds
 * one and returns the full memo text accumulated so far.
 */
import { createRequire } from "node:module";
import type {
  CreateTableResult,
  DescribeTableResult,
  ListTablesResult,
  ReadQueryResult,
  Row,
  SqliteDatabase,
  WriteQueryResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_DB_PATH = "./litebase.db";

/**
 * Resolve which database file to open: an explicit path wins, then
 * the LITEBASE_DB environment variable, then ./litebase.db.
 * ":memory:" is a valid explicit path (a private in-memory database).
 */
export function resolveDbPath(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  const fromEnv = process.env.LITEBASE_DB;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return DEFAULT_DB_PATH;
}

type DatabaseSyncCtor = new (path: string) => SqliteDatabase;

function loadDatabaseSync(): DatabaseSyncCtor {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("node:sqlite") as { DatabaseSync?: unknown };
    if (typeof mod.DatabaseSync !== "function") {
      throw new Error("module loaded but DatabaseSync is missing");
    }
    return mod.DatabaseSync as DatabaseSyncCtor;
  } catch (err) {
    throw new Error(
      "litebase could not load Node's built-in SQLite engine (node:sqlite). " +
        "That module requires Node.js >= 22.5; this package's engines field " +
        "says >=20 (the fleet standard), so on Node 20 the server starts but " +
        "cannot open a database. Run litebase on Node >= 22.5. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Validate that `sql` is exactly one statement and return it with any
 * single trailing semicolon removed. A semicolon anywhere else means
 * a second statement (or an empty one) follows, which is rejected.
 */
function singleStatement(sql: string, tool: string): string {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new Error(`${tool}: query must be a non-empty string`);
  }
  let s = sql.trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trimEnd();
  if (s.includes(";")) {
    throw new Error(`${tool}: only a single SQL statement is allowed`);
  }
  if (!s) throw new Error(`${tool}: query must be a non-empty string`);
  return s;
}

function firstKeyword(sql: string): string {
  const m = /^\s*([A-Za-z]+)/.exec(sql);
  return m ? m[1].toUpperCase() : "";
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class LitebaseDb {
  readonly path: string;
  private readonly db: SqliteDatabase;
  private readonly insights: string[] = [];
  private closed = false;

  constructor(path: string) {
    if (typeof path !== "string" || !path) {
      throw new Error("litebase: a database path is required");
    }
    this.path = path;
    const DatabaseSync = loadDatabaseSync();
    this.db = new DatabaseSync(path);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("litebase: database is closed");
  }

  /** Execute a single SELECT (or WITH) statement; rows come back as objects. */
  readQuery(query: string): ReadQueryResult {
    this.ensureOpen();
    const sql = singleStatement(query, "read_query");
    const kw = firstKeyword(sql);
    if (kw !== "SELECT" && kw !== "WITH") {
      throw new Error(
        `read_query only accepts SELECT (or WITH ... SELECT) queries; got ${kw || "an unrecognised statement"}`,
      );
    }
    const stmt = this.db.prepare(sql);
    // node:sqlite returns null-prototype row objects; normalise them
    // into plain objects so callers get ordinary, comparable rows.
    const rows = (stmt.all() as Row[]).map((r) => ({ ...r }));
    let columns: string[] = [];
    try {
      columns = stmt.columns().map((c) => c.name);
    } catch {
      columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    }
    if (columns.length === 0 && rows.length > 0) columns = Object.keys(rows[0]);
    return { columns, rows, row_count: rows.length };
  }

  /** Execute a single INSERT, UPDATE, or DELETE statement. */
  writeQuery(query: string): WriteQueryResult {
    this.ensureOpen();
    const sql = singleStatement(query, "write_query");
    const kw = firstKeyword(sql);
    if (kw !== "INSERT" && kw !== "UPDATE" && kw !== "DELETE") {
      throw new Error(
        `write_query only accepts INSERT, UPDATE, or DELETE queries; got ${kw || "an unrecognised statement"}`,
      );
    }
    const result = this.db.prepare(sql).run();
    return {
      affected_rows: Number(result.changes),
      last_insert_rowid: Number(result.lastInsertRowid),
    };
  }

  /** Execute a single CREATE TABLE statement. */
  createTable(query: string): CreateTableResult {
    this.ensureOpen();
    const sql = singleStatement(query, "create_table");
    if (!/^\s*CREATE\s+TABLE\b/i.test(sql)) {
      throw new Error("create_table only accepts CREATE TABLE statements");
    }
    this.db.exec(sql);
    return { success: true };
  }

  /** List user tables, excluding SQLite's internal sqlite_% tables. */
  listTables(): ListTablesResult {
    this.ensureOpen();
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' " +
          "AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Row[];
    const tables = rows.map((r) => String(r.name));
    return { tables, count: tables.length };
  }

  /**
   * Describe a table's columns via PRAGMA table_info. The name must be
   * a plain identifier — it is interpolated into the PRAGMA, never
   * bound as a parameter (PRAGMA does not accept bound names).
   */
  describeTable(tableName: string): DescribeTableResult {
    this.ensureOpen();
    if (typeof tableName !== "string" || !IDENTIFIER_RE.test(tableName)) {
      throw new Error(
        `describe_table: '${String(tableName)}' is not a valid table name (expected a plain identifier)`,
      );
    }
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Row[];
    if (rows.length === 0) {
      throw new Error(`describe_table: table not found: '${tableName}'`);
    }
    const columns = rows.map((r) => ({
      name: String(r.name),
      type: typeof r.type === "string" ? r.type : "",
      notnull: Number(r.notnull) === 1,
      default_value: r.dflt_value ?? null,
      primary_key: Number(r.pk) > 0,
    }));
    return { table_name: tableName, columns, column_count: columns.length };
  }

  /** Add an insight to the memo and return the full memo text. */
  appendInsight(insight: string): string {
    if (typeof insight !== "string" || !insight.trim()) {
      throw new Error("append_insight: insight must be a non-empty string");
    }
    this.insights.push(insight.trim());
    return this.getMemo();
  }

  /** Insights recorded so far, in the order they were added. */
  getInsights(): string[] {
    return [...this.insights];
  }

  /** The full memo text: every insight recorded so far, numbered. */
  getMemo(): string {
    if (this.insights.length === 0) {
      return "Business insights memo: no insights recorded yet.";
    }
    const lines = this.insights.map((text, i) => `${i + 1}. ${text}`);
    return `Business insights memo (${this.insights.length} insight${this.insights.length === 1 ? "" : "s"}):\n\n${lines.join("\n")}`;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
