/**
 * litebase MCP server. Tools: read_query, write_query, create_table,
 * list_tables, describe_table, append_insight.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects two keys that are not
 * in this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * therefore serves tools/list with the spec's exact input schemas,
 * while zod still validates every tools/call argument set. Tool names,
 * descriptions, and parameter descriptions are taken from the public
 * spec.
 *
 * The database is opened lazily on the first tool call, so starting
 * the server (and listing tools) has no filesystem side effects. The
 * path comes from the argument after `mcp`, else the LITEBASE_DB
 * environment variable, else ./litebase.db.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LitebaseDb, resolveDbPath, VERSION } from "./db.js";

const QueryArgs = z.object({ query: z.string() });
const DescribeTableArgs = z.object({ table_name: z.string() });
const AppendInsightArgs = z.object({ insight: z.string() });
const NoArgs = z.object({});

const TOOLS = [
  {
    name: "read_query",
    description: "Execute a SELECT query on the SQLite database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The SELECT SQL query to execute" },
      },
      required: ["query"],
    },
  },
  {
    name: "write_query",
    description: "Execute an INSERT, UPDATE, or DELETE query on the SQLite database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The SQL modification query to execute" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_table",
    description: "Create a new table in the SQLite database",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "CREATE TABLE SQL statement" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tables",
    description: "List all tables in the SQLite database",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "describe_table",
    description: "Get the schema information for a specific table",
    inputSchema: {
      type: "object" as const,
      properties: {
        table_name: { type: "string", description: "Name of the table to describe" },
      },
      required: ["table_name"],
    },
  },
  {
    name: "append_insight",
    description: "Add a business insight to the memo",
    inputSchema: {
      type: "object" as const,
      properties: {
        insight: {
          type: "string",
          description: "Business insight discovered from data analysis",
        },
      },
      required: ["insight"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

let db: LitebaseDb | undefined;

function getDb(): LitebaseDb {
  if (!db) {
    const argv = process.argv.slice(2);
    const mcpIdx = argv.indexOf("mcp");
    const positional = mcpIdx >= 0 ? argv[mcpIdx + 1] : undefined;
    db = new LitebaseDb(resolveDbPath(positional));
  }
  return db;
}

const server = new Server(
  { name: "litebase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "read_query": {
        const parsed = QueryArgs.parse(args ?? {});
        return textResult(getDb().readQuery(parsed.query));
      }
      case "write_query": {
        const parsed = QueryArgs.parse(args ?? {});
        return textResult(getDb().writeQuery(parsed.query));
      }
      case "create_table": {
        const parsed = QueryArgs.parse(args ?? {});
        return textResult(getDb().createTable(parsed.query));
      }
      case "list_tables": {
        NoArgs.parse(args ?? {});
        return textResult(getDb().listTables());
      }
      case "describe_table": {
        const parsed = DescribeTableArgs.parse(args ?? {});
        return textResult(getDb().describeTable(parsed.table_name));
      }
      case "append_insight": {
        const parsed = AppendInsightArgs.parse(args ?? {});
        return textResult(getDb().appendInsight(parsed.insight));
      }
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
