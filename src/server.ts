import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text());

// Store active sessions: sessionId -> { server, transport, timeout }
const activeSessions = new Map<string, { server: McpServer; transport: SSEServerTransport; timeout: NodeJS.Timeout }>();

// Session timeout: 30 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

app.get("/sse", async (req, res) => {
  // We look for 'x-logflare-api-key' which the user sets in Caller
  const apiKey = req.headers["x-logflare-api-key"];
  // Required: source token for scoping queries to a specific source
  const sourceToken = req.headers["x-logflare-source-token"];

  if (!apiKey || typeof apiKey !== "string") {
    res.status(401).send("Missing 'x-logflare-api-key' header. Please configure it in your request header");
    return;
  }

  if (!sourceToken || typeof sourceToken !== "string") {
    res.status(401).send("Missing 'x-logflare-source-token' header. Please configure it in your request header");
    return;
  }

  // 2. Create a PRIVATE server instance for this specific connection
  const server = new McpServer({
    name: "logflare-proxy",
    version: "1.0.0",
  });

  // 3. Define the tool using the USER'S key and source token (Closure)
  server.tool(
    "query_logs",
    {
      sql: z.string().describe("Execute raw BigQuery SQL queries against Logflare logs. The source is automatically scoped from connection configuration via source token parameter. IMPORTANT: SQL queries must reference source names as table names (e.g., FROM `source-name.logs`). Use list_sources tool first to get available source names, then use the source name in your SQL. Returns raw results with microsecond timestamps. For human-readable timestamps, use query_logs_formatted instead. For discovering available columns, use get_source_schema first. Example: SELECT * FROM `my-source.logs` WHERE timestamp > 1234567890000000 LIMIT 10"),
    },
    async ({ sql }) => {
      try {
        const params = new URLSearchParams({ bq_sql: sql });
        // Add source token to query params (required, scopes query to specific source)
        params.append("source", sourceToken);
        const response = await fetch(`https://api.logflare.app/api/query?${params.toString()}`, {
          headers: {
            "Authorization": `Bearer ${apiKey}`, // <--- Uses the user's header key
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Logflare Error: ${await response.text()}` }],
            isError: true,
          };
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data.result || data, null, 2) }],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Proxy Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // Helper function to execute Logflare queries
  const executeQuery = async (sql: string) => {
    const params = new URLSearchParams({ bq_sql: sql });
    params.append("source", sourceToken);
    const response = await fetch(`https://api.logflare.app/api/query?${params.toString()}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Logflare API Error: ${await response.text()}`);
    }

    const data = await response.json();
    return data.result || data;
  };

  // Add tool to list all sources
  server.tool(
    "list_sources",
    {},
    async () => {
      try {
        const response = await fetch("https://api.logflare.app/api/sources", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Logflare Error: ${await response.text()}` }],
            isError: true,
          };
        }

        const data = await response.json();
        // Format the response to show source names and IDs clearly
        const sources = Array.isArray(data) ? data : (data.sources || []);
        const formattedSources = sources.map((source: { id?: string; name?: string; description?: string }) => ({
          id: source.id || "",
          name: source.name || "",
          description: source.description || "",
        }));

        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ sources: formattedSources }, null, 2) 
          }],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Proxy Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 1: Get source schema (columns/fields)
  // IMPORTANT: This tool takes NO parameters. It automatically uses the source token
  // configured in the connection (x-logflare-source-token header). Do not pass any source name.
  server.tool(
    "get_source_schema",
    {},
    async () => {
      try {
        // Always use the source token from connection configuration
        // The API endpoint requires the source token, not the source name
        const sourceId = sourceToken;
        
        // Fetch schema from Logflare API
        const response = await fetch(`https://api.logflare.app/api/sources/${sourceId}/schema`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: "text", text: `Logflare API Error: ${errorText}` }],
            isError: true,
          };
        }

        const schema = await response.json();
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              source: sourceId,
              schema: schema
            }, null, 2) 
          }],
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

  // Tool 2: Get sample logs
  server.tool(
    "get_sample_logs",
    {
      sourceName: z.string().describe("Source name to get sample logs from. Get source names using list_sources tool first - use the 'name' field from the response. Example: if list_sources returns {id: '36025', name: 'whisprcoach.all'}, use 'whisprcoach.all' as the sourceName parameter."),
      limit: z.number().optional().default(5).describe("Number of sample log entries to retrieve (default: 5, max: 100). Returns the most recent logs with ALL fields visible. Use this to see actual log structure, nested fields, and data formats. Perfect for understanding what fields exist and their values before writing queries."),
    },
    async ({ sourceName, limit = 5 }) => {
      try {
        // Build query - use explicit columns since SELECT * is restricted in BigQuery
        // Based on schema: timestamp, event_message, level, id, metadata
        const query = `SELECT timestamp, event_message, level, id, metadata FROM \`${sourceName}\` WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) ORDER BY timestamp DESC LIMIT ${Math.min(limit, 100)}`;
  
        const params = new URLSearchParams({ 
          bq_sql: query,
          source: sourceToken, // Use source token from connection config (same as query_logs)
        });
  
        const response = await fetch(`https://api.logflare.app/api/query?${params.toString()}`, {
          headers: {
            "Authorization": `Bearer ${apiKey}`, // Same auth format as query_logs
            "Accept": "application/json",
          },
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: "text", text: `Logflare API Error: ${errorText}` }],
            isError: true,
          };
        }
  
        const data = await response.json();
        const result = data.result || (Array.isArray(data) ? data : []);
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              source: sourceName,
              count: result.length,
              samples: result
            }, null, 2) 
          }],
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

  // Tool 3: Query logs with formatted timestamps
  server.tool(
    "query_logs_formatted",
    {
      sql: z.string().describe("Execute BigQuery SQL query with automatically formatted human-readable timestamps. IMPORTANT: Your SQL MUST specify columns explicitly (cannot use SELECT *). Must include 'timestamp' column in SELECT. Source names are table names (e.g., FROM `source-name`). Use list_sources tool first. Example: SELECT timestamp, message, level FROM `my-source` WHERE level = 'error' LIMIT 10. Returns your columns plus 'formatted_timestamp' (YYYY-MM-DD HH:MM:SS)."),
    },
    async ({ sql }) => {
      try {
        // Extract column names from user's SELECT clause
        const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
        if (!selectMatch) {
          throw new Error("Invalid SQL: Could not parse SELECT clause. Must use explicit columns, not SELECT *");
        }
  
        const userColumns = selectMatch[1].trim();
        
        // Check if user tried to use SELECT *
        if (userColumns === '*' || userColumns.includes('*')) {
          throw new Error("SELECT * is not allowed. Please specify columns explicitly (e.g., SELECT timestamp, event_message, level FROM ...)");
        }
  
        // Wrap query to add formatted timestamp
        // Since timestamp is already a TIMESTAMP type in BigQuery, format it directly
        const formattedSql = `
          SELECT 
            ${userColumns},
            FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', timestamp) as formatted_timestamp
          FROM (
            ${sql}
          )
        `;
  
        const result = await executeQuery(formattedSql);
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              result: result,
              count: result.length
            }, null, 2) 
          }],
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

  // Tool 4: Explore fields (analyze nested structure)
server.tool(
    "explore_fields",
    {
      sourceName: z.string().optional().describe("Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."),
      limit: z.number().optional().default(10).describe("Number of recent logs to analyze for field structure (default: 10, max: 50). Discovers nested fields like 'metadata.userId', 'metadata.email', etc. Shows field types, sample values, and nested paths. Use this when you suspect fields are nested in objects or need to find hidden fields not visible in schema."),
    },
    async ({ sourceName, limit = 10 }) => {
      try {
        const tableName = sourceName || sourceToken;
        
        // Get sample logs - use event_message instead of message
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
  
        const samples = await executeQuery(sampleSql);
        
        // Analyze field structure
        interface FieldInfo {
          type: string;
          sampleValues: unknown[];
          isNested: boolean;
        }
        
        const fieldAnalysis: Record<string, FieldInfo> = {};
        
        samples.forEach((log: Record<string, unknown>) => {
          const analyzeObject = (obj: Record<string, unknown>, prefix = ""): void => {
            for (const [key, value] of Object.entries(obj)) {
              const fullKey = prefix ? `${prefix}.${key}` : key;
              
              if (!fieldAnalysis[fullKey]) {
                fieldAnalysis[fullKey] = {
                  type: typeof value,
                  sampleValues: [],
                  isNested: false,
                };
              }
              
              if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                fieldAnalysis[fullKey].isNested = true;
                analyzeObject(value as Record<string, unknown>, fullKey);
              } else {
                if (fieldAnalysis[fullKey].sampleValues.length < 3) {
                  fieldAnalysis[fullKey].sampleValues.push(value);
                }
              }
            }
          };
          
          analyzeObject(log);
        });
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              source: tableName,
              fieldsAnalyzed: Object.keys(fieldAnalysis).length,
              fieldStructure: fieldAnalysis
            }, null, 2) 
          }],
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



  // Tool 6: Get log statistics/aggregations
  server.tool(
    "get_log_stats",
    {
      timeRange: z.string().optional().default("24h").describe("Time range for statistics. Formats: '1h', '24h', '7d', '30d'. Default: '24h'. Returns aggregated statistics including total logs, error/warning counts, log levels, and time range."),
      sourceName: z.string().optional().describe("Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."),
    },
    async ({ timeRange = "24h", sourceName }) => {
      try {
        const tableName = sourceName || sourceToken;
        
        // Parse time range
        const hours = timeRange.includes("h") ? parseInt(timeRange) : 
                     timeRange.includes("d") ? parseInt(timeRange) * 24 : 24;
        
        // Use same approach as query_logs - TIMESTAMP_SUB directly
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
  
        const result = await executeQuery(sql);
        const stats = result[0] || {};
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
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
              }
            }, null, 2) 
          }],
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

  // Tool 7: Get logs between two specific time points (time A to time B)
  server.tool(
    "get_logs_by_time_range",
    {
      startTime: z.string().describe("Start time. Accepts: ISO 8601 (e.g., '2024-01-15T10:30:00Z'), relative time (e.g., '1 hour ago', '2 days ago', 'last 24 hours'), or Unix timestamp. Examples: '2024-01-15 10:30:00', '1 hour ago', 'yesterday'."),
      endTime: z.string().describe("End time. Accepts: ISO 8601 (e.g., '2024-01-15T15:45:00Z'), relative time (e.g., 'now', '1 hour ago'), or Unix timestamp. Must be after startTime. Examples: 'now', '2024-01-15 15:45:00', '30 minutes ago'."),
      sourceName: z.string().optional().describe("Source name. Get source names using list_sources tool first. If not provided, uses the configured source from connection."),
      limit: z.number().optional().default(100).describe("Maximum number of logs to return (default: 100, max: 1000). Returns logs ordered by timestamp descending (newest first)."),
      formatted: z.boolean().optional().default(false).describe("If true, returns human-readable timestamps in addition to microsecond timestamps. Default: false."),
    },
    async ({ startTime, endTime, sourceName, limit = 100, formatted = false }) => {
      try {
        const tableName = sourceName || sourceToken;
        
        // Helper function to parse various time formats to TIMESTAMP
        const parseTimeToTimestamp = (timeStr: string): string => {
          const lower = timeStr.toLowerCase().trim();
          
          // Handle relative times
          if (lower === 'now' || lower === 'current') {
            return 'CURRENT_TIMESTAMP()';
          }
          
          // Handle "X ago" format
          const agoMatch = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
          if (agoMatch) {
            const amount = parseInt(agoMatch[1]);
            const unit = agoMatch[2].toLowerCase();
            const intervalMap: Record<string, string> = {
              'second': 'SECOND',
              'minute': 'MINUTE',
              'hour': 'HOUR',
              'day': 'DAY',
              'week': 'WEEK',
              'month': 'MONTH',
              'year': 'YEAR'
            };
            return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${amount} ${intervalMap[unit]})`;
          }
          
          // Handle "last X" format
          const lastMatch = lower.match(/last\s+(\d+)\s*(second|minute|hour|day|week|month|year)s?/i);
          if (lastMatch) {
            const amount = parseInt(lastMatch[1]);
            const unit = lastMatch[2].toLowerCase();
            const intervalMap: Record<string, string> = {
              'second': 'SECOND',
              'minute': 'MINUTE',
              'hour': 'HOUR',
              'day': 'DAY',
              'week': 'WEEK',
              'month': 'MONTH',
              'year': 'YEAR'
            };
            return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${amount} ${intervalMap[unit]})`;
          }
          
          // Handle "yesterday", "today"
          if (lower === 'yesterday') {
            return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)`;
          }
          if (lower === 'today') {
            return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)`;
          }
          
          // Try ISO 8601 or other date formats
          const date = new Date(timeStr);
          if (!isNaN(date.getTime())) {
            // Convert to ISO 8601 format for BigQuery
            const isoString = date.toISOString();
            return `TIMESTAMP('${isoString}')`;
          }
          
          // Try Unix timestamp (seconds)
          const unixSeconds = parseFloat(timeStr);
          if (!isNaN(unixSeconds) && unixSeconds > 0) {
            // If it's a reasonable Unix timestamp (after 2000)
            if (unixSeconds > 946684800) { // Jan 1, 2000
              const dateFromUnix = new Date(unixSeconds * 1000);
              return `TIMESTAMP('${dateFromUnix.toISOString()}')`;
            }
          }
          
          throw new Error(`Invalid time format: ${timeStr}. Use ISO 8601, relative time (e.g., '1 hour ago'), or Unix timestamp.`);
        };
  
        const startTimestamp = parseTimeToTimestamp(startTime);
        const endTimestamp = parseTimeToTimestamp(endTime);
  
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
            WHERE timestamp >= ${startTimestamp} AND timestamp <= ${endTimestamp}
            ORDER BY timestamp DESC
            LIMIT ${Math.min(limit, 1000)}
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
            WHERE timestamp >= ${startTimestamp} AND timestamp <= ${endTimestamp}
            ORDER BY timestamp DESC
            LIMIT ${Math.min(limit, 1000)}
          `;
        }
  
        const result = await executeQuery(sql);
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              source: tableName,
              startTime: startTime,
              endTime: endTime,
              count: result.length,
              logs: result
            }, null, 2) 
          }],
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

  // 4. Set up the transport and session
  const transport = new SSEServerTransport("/messages", res);
  
  // Set up session timeout
  const timeout = setTimeout(() => {
    activeSessions.delete(transport.sessionId);
    console.log(`Session ${transport.sessionId} expired`);
  }, SESSION_TIMEOUT_MS);
  
  // Store the session so we can handle the subsequent POST requests
  activeSessions.set(transport.sessionId, { server, transport, timeout });

  // Handle cleanup when the connection drops
  res.on("close", () => {
    const session = activeSessions.get(transport.sessionId);
    if (session) {
      clearTimeout(session.timeout);
    activeSessions.delete(transport.sessionId);
    console.log(`Session ${transport.sessionId} closed`);
    }
  });

  try {
  await server.connect(transport);
  } catch (error: unknown) {
    // Clean up on connection error
    const session = activeSessions.get(transport.sessionId);
    if (session) {
      clearTimeout(session.timeout);
      activeSessions.delete(transport.sessionId);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).send(`Failed to connect: ${errorMessage}`);
  }
});

// Handle POST to /sse (some clients try this first, but SSE uses GET)
app.post("/sse", (req, res) => {
  res.status(405).json({ 
    error: "Method not allowed. Use GET for SSE connections." 
  });
});

app.post("/messages", async (req, res) => {
  // 1. Extract the session ID from the URL query (added automatically by the SDK)
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId) {
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  // 2. Find the correct transport for this user
  const session = activeSessions.get(sessionId);

  if (!session) {
    res.status(404).send("Session not found or expired");
    return;
  }

  // Reset session timeout on activity
  clearTimeout(session.timeout);
  session.timeout = setTimeout(() => {
    activeSessions.delete(sessionId);
    console.log(`Session ${sessionId} expired`);
  }, SESSION_TIMEOUT_MS);

  // 3. Forward the message to that user's specific server instance
  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).send(`Message handling error: ${errorMessage}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Logflare MCP Proxy running on port ${PORT}`);
});