/**
 * MCP tool definitions for Logflare integration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeQuery, getSourceSchema, listSources } from "./logflare.js";
import { analyzeFieldStructure, parseTimeRangeToHours, parseTimeToTimestamp } from "./utils.js";
import { LogflareApiConfig } from "./types.js";

/**
 * Registers all MCP tools with the server instance.
 */
export function registerTools(server: McpServer, config: LogflareApiConfig): void {
  const { apiKey, sourceToken } = config;

  server.tool(
    "query_logs",
    {
      sql: z
        .string()
        .describe(
          "Execute raw BigQuery SQL queries against Logflare logs. The source is automatically scoped from connection configuration via source token parameter. IMPORTANT: SQL queries must reference source names as table names (e.g., FROM `source-name`). Use list_sources tool first to get available source names, then use the source name in your SQL. Returns raw results with microsecond timestamps. For human-readable timestamps, use query_logs_formatted instead. For discovering available columns, use get_source_schema first. Example: SELECT timestamp, event_message, level FROM `my-source` WHERE timestamp > 1234567890000000 LIMIT 10"
        ),
    },
    async ({ sql }) => {
      try {
        const params = new URLSearchParams({ bq_sql: sql });
        params.append("source", sourceToken);

        const response = await fetch(
          `https://api.logflare.app/api/query?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Logflare Error: ${await response.text()}`,
              },
            ],
            isError: true,
          };
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data.result || data, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_sources",
    {},
    async () => {
      try {
        const data = await listSources(config);
        const sources = Array.isArray(data) ? data : (data as { sources?: unknown[] }).sources || [];
        const formattedSources = (sources as Array<{ id?: string; name?: string; description?: string }>).map(
          (source) => ({
            id: source.id || "",
            name: source.name || "",
            description: source.description || "",
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sources: formattedSources }, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_source_schema",
    {},
    async () => {
      try {
        const schema = await getSourceSchema(config);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: sourceToken,
                  schema: schema,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_sample_logs",
    {
      sourceName: z
        .string()
        .describe(
          "Source name to get sample logs from. Get source names using list_sources tool first - use the 'name' field from the response. Example: if list_sources returns {id: '36025', name: 'whisprcoach.all'}, use 'whisprcoach.all' as the sourceName parameter."
        ),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe(
          "Number of sample log entries to retrieve (default: 5, max: 100). Returns the most recent logs with all fields visible. Use this to see actual log structure, nested fields, and data formats."
        ),
    },
    async ({ sourceName, limit = 5 }) => {
      try {
        const query = `SELECT timestamp, event_message, level, id, metadata FROM \`${sourceName}\` WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) ORDER BY timestamp DESC LIMIT ${Math.min(limit, 100)}`;

        const params = new URLSearchParams({
          bq_sql: query,
          source: sourceToken,
        });

        const response = await fetch(
          `https://api.logflare.app/api/query?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [
              {
                type: "text",
                text: `Logflare API Error: ${errorText}`,
              },
            ],
            isError: true,
          };
        }

        const data = await response.json();
        const result = data.result || (Array.isArray(data) ? data : []);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: sourceName,
                  count: result.length,
                  samples: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "query_logs_formatted",
    {
      sql: z
        .string()
        .describe(
          "Execute BigQuery SQL query with automatically formatted human-readable timestamps. IMPORTANT: Your SQL MUST specify columns explicitly (cannot use SELECT *). Must include 'timestamp' column in SELECT. Source names are table names (e.g., FROM `source-name`). Use list_sources tool first. Example: SELECT timestamp, event_message, level FROM `my-source` WHERE level = 'error' LIMIT 10. Returns your columns plus 'formatted_timestamp' (YYYY-MM-DD HH:MM:SS)."
        ),
    },
    async ({ sql }) => {
      try {
        const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
        if (!selectMatch) {
          throw new Error(
            "Invalid SQL: Could not parse SELECT clause. Must use explicit columns, not SELECT *"
          );
        }

        const userColumns = selectMatch[1].trim();

        if (userColumns === "*" || userColumns.includes("*")) {
          throw new Error(
            "SELECT * is not allowed. Please specify columns explicitly (e.g., SELECT timestamp, event_message, level FROM ...)"
          );
        }

        const formattedSql = `
          SELECT 
            ${userColumns},
            FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', timestamp) as formatted_timestamp
          FROM (
            ${sql}
          )
        `;

        const result = (await executeQuery(formattedSql, config)) as unknown[];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  result: result,
                  count: result.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "explore_fields",
    {
      sourceName: z
        .string()
        .optional()
        .describe(
          "Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."
        ),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe(
          "Number of recent logs to analyze for field structure (default: 10, max: 50). Discovers nested fields like 'metadata.userId', 'metadata.email', etc. Shows field types, sample values, and nested paths."
        ),
    },
    async ({ sourceName, limit = 10 }) => {
      try {
        const tableName = sourceName || sourceToken;

        const sampleSql = `
          SELECT 
            timestamp,
            event_message,
            metadata,
            level,
            id
          FROM \`${tableName}\`
          WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
          ORDER BY timestamp DESC
          LIMIT ${Math.min(limit, 50)}
        `;

        const samples = (await executeQuery(sampleSql, config)) as Record<string, unknown>[];
        const fieldAnalysis = analyzeFieldStructure(samples);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: tableName,
                  fieldsAnalyzed: Object.keys(fieldAnalysis).length,
                  fieldStructure: fieldAnalysis,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_log_stats",
    {
      timeRange: z
        .string()
        .optional()
        .default("24h")
        .describe(
          "Time range for statistics. Formats: '1h', '24h', '7d', '30d'. Default: '24h'. Returns aggregated statistics including total logs, error/warning counts, log levels, and time range."
        ),
      sourceName: z
        .string()
        .optional()
        .describe(
          "Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."
        ),
    },
    async ({ timeRange = "24h", sourceName }) => {
      try {
        const tableName = sourceName || sourceToken;
        const hours = parseTimeRangeToHours(timeRange);

        const sql = `
          SELECT 
            COUNT(*) as total_logs,
            COUNT(DISTINCT CAST(level AS STRING)) as distinct_levels,
            MIN(timestamp) as earliest_log,
            MAX(timestamp) as latest_log,
            COUNTIF(LOWER(CAST(event_message AS STRING)) LIKE '%error%') as error_count,
            COUNTIF(LOWER(CAST(event_message AS STRING)) LIKE '%warn%') as warning_count,
            COUNTIF(LOWER(CAST(level AS STRING)) = 'error') as error_level_count,
            COUNTIF(LOWER(CAST(level AS STRING)) = 'warn') as warn_level_count
          FROM \`${tableName}\`
          WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${hours} HOUR)
        `;

        const result = (await executeQuery(sql, config)) as Array<Record<string, unknown>>;
        const stats = result[0] || {};

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: tableName,
                  timeRange: timeRange,
                  statistics: {
                    totalLogs: stats.total_logs || 0,
                    distinctLevels: stats.distinct_levels || 0,
                    errorCount: stats.error_count || 0,
                    warningCount: stats.warning_count || 0,
                    errorLevelCount: stats.error_level_count || 0,
                    warnLevelCount: stats.warn_level_count || 0,
                    earliestLog: stats.earliest_log || null,
                    latestLog: stats.latest_log || null,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_logs_from_time",
    {
      startTime: z
        .string()
        .describe(
          "Timestamp to get logs from. Returns the 20 most recent logs from this time forward. Use this to investigate past incidents by passing the incident timestamp. Accepts: ISO 8601 (e.g., '2024-01-15T10:30:00Z'), relative time (e.g., '1 hour ago', '2 days ago', '30 minutes ago'), or Unix timestamp. Examples: '2024-01-15 10:30:00', '1 hour ago', 'yesterday', 'now'. Pass any timestamp to see what happened from that point forward."
        ),
      sourceName: z
        .string()
        .optional()
        .describe(
          "Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."
        ),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe(
          "Number of logs to return (default: 20, max: 20). Always returns the most recent logs from startTime forward, ordered by timestamp descending."
        ),
      formatted: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, returns human-readable timestamps in addition to microsecond timestamps. Default: false."
        ),
    },
    async ({ startTime, sourceName, limit = 20, formatted = false }) => {
      try {
        const tableName = sourceName || sourceToken;

        const actualLimit = Math.min(limit || 20, 20);

        const startTimestamp = parseTimeToTimestamp(startTime);

        let sql: string;

        if (formatted) {
          sql = `
            SELECT 
              event_message,
              metadata,
              level,
              id,
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', timestamp) as formatted_timestamp,
              timestamp as timestamp_micros
            FROM \`${tableName}\`
            WHERE timestamp >= ${startTimestamp}
            ORDER BY timestamp DESC
            LIMIT ${actualLimit}
          `;
        } else {
          sql = `
            SELECT 
              timestamp,
              event_message,
              metadata,
              level,
              id
            FROM \`${tableName}\`
            WHERE timestamp >= ${startTimestamp}
            ORDER BY timestamp DESC
            LIMIT ${actualLimit}
          `;
        }

        const result = (await executeQuery(sql, config)) as unknown[];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  source: tableName,
                  startTime: startTime,
                  count: result.length,
                  logs: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );
}