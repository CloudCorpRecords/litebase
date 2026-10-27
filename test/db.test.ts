import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LitebaseDb, resolveDbPath } from "../src/db.js";

function memoryDb(): LitebaseDb {
  return new LitebaseDb(":memory:");
}

describe("create_table + list_tables", () => {
  it("creates a table and lists it", () => {
    const db = memoryDb();
    try {
      assert.deepEqual(db.listTables(), { tables: [], count: 0 });
      const r = db.createTable(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      assert.deepEqual(r, { success: true });
      assert.deepEqual(db.listTables(), { tables: ["users"], count: 1 });
    } finally {
      db.close();
    }
  });

  it("excludes SQLite internal tables from the listing", () => {
    const db = memoryDb();
    try {
      // AUTOINCREMENT makes SQLite create the internal sqlite_sequence table.
      db.createTable("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");
      assert.deepEqual(db.listTables().tables, ["items"]);
    } finally {
      db.close();
    }
  });

  it("persists tables to a file database across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "litebase-test-"));
    const path = join(dir, "data.db");
    try {
      const first = new LitebaseDb(path);
      first.createTable("CREATE TABLE notes (body TEXT)");
      first.writeQuery("INSERT INTO notes (body) VALUES ('hello')");
      first.close();

      const second = new LitebaseDb(path);
      try {
        assert.deepEqual(second.listTables().tables, ["notes"]);
        assert.deepEqual(second.readQuery("SELECT body FROM notes").rows, [
          { body: "hello" },
        ]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("write_query + read_query roundtrip", () => {
  it("inserts rows and reads them back as objects", () => {
    const db = memoryDb();
    try {
      db.createTable("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score REAL)");
      const w1 = db.writeQuery("INSERT INTO users (name, score) VALUES ('Ada', 9.5)");
      assert.equal(w1.affected_rows, 1);
      assert.equal(w1.last_insert_rowid, 1);
      db.writeQuery("INSERT INTO users (name, score) VALUES ('Grace', 8.25)");

      const r = db.readQuery("SELECT id, name, score FROM users ORDER BY id");
      assert.deepEqual(r.columns, ["id", "name", "score"]);
      assert.equal(r.row_count, 2);
      assert.deepEqual(r.rows, [
        { id: 1, name: "Ada", score: 9.5 },
        { id: 2, name: "Grace", score: 8.25 },
      ]);
    } finally {
      db.close();
    }
  });

  it("reports the affected count for UPDATE and DELETE", () => {
    const db = memoryDb();
    try {
      db.createTable("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      db.writeQuery("INSERT INTO t (v) VALUES ('a')");
      db.writeQuery("INSERT INTO t (v) VALUES ('b')");
      db.writeQuery("INSERT INTO t (v) VALUES ('b')");

      assert.equal(db.writeQuery("UPDATE t SET v = 'c' WHERE v = 'b'").affected_rows, 2);
      assert.equal(db.writeQuery("UPDATE t SET v = 'd' WHERE v = 'zzz'").affected_rows, 0);
      assert.equal(db.writeQuery("DELETE FROM t WHERE v = 'c'").affected_rows, 2);
      assert.deepEqual(db.readQuery("SELECT v FROM t").rows, [{ v: "a" }]);
    } finally {
      db.close();
    }
  });

  it("accepts WITH ... SELECT for reads and a trailing semicolon", () => {
    const db = memoryDb();
    try {
      const r = db.readQuery("WITH x AS (SELECT 1 AS n) SELECT n FROM x;");
      assert.deepEqual(r.rows, [{ n: 1 }]);
    } finally {
      db.close();
    }
  });
});

describe("statement guards", () => {
  it("read_query rejects non-SELECT statements", () => {
    const db = memoryDb();
    try {
      db.createTable("CREATE TABLE t (a INTEGER)");
      assert.throws(() => db.readQuery("INSERT INTO t VALUES (1)"), /only accepts SELECT/);
      assert.throws(() => db.readQuery("DELETE FROM t"), /only accepts SELECT/);
      assert.throws(() => db.readQuery("DROP TABLE t"), /only accepts SELECT/);
    } finally {
      db.close();
    }
  });

  it("write_query rejects SELECT, CREATE, and DROP", () => {
    const db = memoryDb();
    try {
      db.createTable("CREATE TABLE t (a INTEGER)");
      assert.throws(() => db.writeQuery("SELECT * FROM t"), /only accepts INSERT, UPDATE, or DELETE/);
      assert.throws(() => db.writeQuery("CREATE TABLE u (a INTEGER)"), /only accepts INSERT, UPDATE, or DELETE/);
      assert.throws(() => db.writeQuery("DROP TABLE t"), /only accepts INSERT, UPDATE, or DELETE/);
    } finally {
      db.close();
    }
  });

  it("create_table rejects non-CREATE TABLE statements", () => {
    const db = memoryDb();
    try {
      assert.throws(() => db.createTable("DROP TABLE t"), /only accepts CREATE TABLE/);
      assert.throws(() => db.createTable("INSERT INTO t VALUES (1)"), /only accepts CREATE TABLE/);
      assert.throws(() => db.createTable("CREATE INDEX i ON t (a)"), /only accepts CREATE TABLE/);
    } finally {
      db.close();
    }
  });

  it("rejects multi-statement input in every guarded operation", () => {
    const db = memoryDb();
    try {
      db.createTable("CREATE TABLE t (a INTEGER)");
      assert.throws(
        () => db.readQuery("SELECT * FROM t; DROP TABLE t"),
        /single SQL statement/,
      );
      assert.throws(
        () => db.writeQuery("INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)"),
        /single SQL statement/,
      );
      assert.throws(
        () => db.createTable("CREATE TABLE u (a INTEGER); CREATE TABLE v (a INTEGER)"),
        /single SQL statement/,
      );
      // The rejected statements must not have run at all.
      assert.deepEqual(db.listTables().tables, ["t"]);
      assert.equal(db.readQuery("SELECT COUNT(*) AS n FROM t").rows[0].n, 0);
    } finally {
      db.close();
    }
  });

  it("rejects empty queries", () => {
    const db = memoryDb();
    try {
      assert.throws(() => db.readQuery(""), /non-empty/);
      assert.throws(() => db.writeQuery("   "), /non-empty/);
    } finally {
      db.close();
    }
  });
});

describe("describe_table", () => {
  it("returns column names, types, nullability, and primary key", () => {
    const db = memoryDb();
    try {
      db.createTable(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, nick TEXT DEFAULT 'anon', score REAL)",
      );
      const d = db.describeTable("users");
      assert.equal(d.table_name, "users");
      assert.equal(d.column_count, 4);
      assert.deepEqual(
        d.columns.map((c) => c.name),
        ["id", "name", "nick", "score"],
      );
      const byName = Object.fromEntries(d.columns.map((c) => [c.name, c]));
      assert.equal(byName.id.type, "INTEGER");
      assert.equal(byName.id.primary_key, true);
      assert.equal(byName.name.type, "TEXT");
      assert.equal(byName.name.notnull, true);
      assert.equal(byName.name.primary_key, false);
      assert.equal(byName.nick.default_value, "'anon'");
      assert.equal(byName.score.type, "REAL");
    } finally {
      db.close();
    }
  });

  it("errors on an unknown table", () => {
    const db = memoryDb();
    try {
      assert.throws(() => db.describeTable("nope"), /table not found: 'nope'/);
    } finally {
      db.close();
    }
  });

  it("rejects names that are not plain identifiers", () => {
    const db = memoryDb();
    try {
      assert.throws(() => db.describeTable("users; DROP TABLE users"), /not a valid table name/);
      assert.throws(() => db.describeTable("user-name"), /not a valid table name/);
      assert.throws(() => db.describeTable("1users"), /not a valid table name/);
      assert.throws(() => db.describeTable(""), /not a valid table name/);
    } finally {
      db.close();
    }
  });
});

describe("append_insight", () => {
  it("accumulates insights into the memo and returns the full text", () => {
    const db = memoryDb();
    try {
      assert.match(db.getMemo(), /no insights recorded yet/);
      const first = db.appendInsight("Churn is concentrated in the free tier.");
      assert.match(first, /1\. Churn is concentrated in the free tier\./);
      const second = db.appendInsight("Paid users renew at 92 percent.");
      assert.match(second, /1\. Churn is concentrated in the free tier\./);
      assert.match(second, /2\. Paid users renew at 92 percent\./);
      assert.deepEqual(db.getInsights(), [
        "Churn is concentrated in the free tier.",
        "Paid users renew at 92 percent.",
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects empty insights", () => {
    const db = memoryDb();
    try {
      assert.throws(() => db.appendInsight(""), /non-empty/);
      assert.throws(() => db.appendInsight("   "), /non-empty/);
    } finally {
      db.close();
    }
  });
});

describe("resolveDbPath", () => {
  it("prefers the explicit path, then LITEBASE_DB, then the default", () => {
    const saved = process.env.LITEBASE_DB;
    try {
      delete process.env.LITEBASE_DB;
      assert.equal(resolveDbPath(), "./litebase.db");
      assert.equal(resolveDbPath("given.db"), "given.db");
      process.env.LITEBASE_DB = "from-env.db";
      assert.equal(resolveDbPath(), "from-env.db");
      assert.equal(resolveDbPath("given.db"), "given.db");
      assert.equal(resolveDbPath(":memory:"), ":memory:");
    } finally {
      if (saved === undefined) delete process.env.LITEBASE_DB;
      else process.env.LITEBASE_DB = saved;
    }
  });
});
