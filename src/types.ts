/**
 * litebase types.
 *
 * The query/write results mirror what a caller needs to act on an
 * answer: for reads, the column names plus one plain object per row;
 * for writes, how many rows changed and the rowid of the last insert.
 * The SQLite interfaces at the bottom are the minimal surface of
 * Node's built-in `node:sqlite` module that the core uses — declared
 * locally because the fleet's `@types/node` ^20 predates that module.
 */

/** One result row: column name -> value (number, string, null, bytes). */
export type Row = Record<string, unknown>;

export interface ReadQueryResult {
  columns: string[];
  rows: Row[];
  row_count: number;
}

export interface WriteQueryResult {
  /** Rows changed by the statement, as reported by SQLite. */
  affected_rows: number;
  /** Rowid assigned by the most recent INSERT on this connection. */
  last_insert_rowid: number;
}

export interface CreateTableResult {
  success: true;
}

export interface ListTablesResult {
  /** User tables only; SQLite internal `sqlite_%` tables are excluded. */
  tables: string[];
  count: number;
}

export interface ColumnInfo {
  name: string;
  /** Declared column type, e.g. "INTEGER" or "TEXT" ("" when undeclared). */
  type: string;
  notnull: boolean;
  /** Declared default value, or null when there is none. */
  default_value: unknown;
  primary_key: boolean;
}

export interface DescribeTableResult {
  table_name: string;
  columns: ColumnInfo[];
  column_count: number;
}

/** Minimal shape of a prepared statement from `node:sqlite`. */
export interface SqliteStatement {
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  columns(): Array<{ name: string }>;
}

/** Minimal shape of a database handle from `node:sqlite`. */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
