# Logflare MCP Server

MCP server for querying and analyzing Logflare logs with AI assistants. Provides tools for log exploration, schema discovery, and time-based queries.

## Quick Start

```bash
npm install
npm run build
npm start
```

The server runs on port `3000` by default. Set `PORT` environment variable to change it.

## Configuration

Configure your MCP client (Cursor, Claude Desktop, etc.):

```json
{
  "logflare": {
    "url": "http://localhost:3000/sse",
    "headers": {
      "x-logflare-api-key": "your-logflare-api-key",
      "x-logflare-source-token": "your-source-token"
    }
  }
}
```

**Required Headers:**
- `x-logflare-api-key`: Your Logflare API key
- `x-logflare-source-token`: Source token for the Logflare source to query

## Tools

### `query_logs`

Execute raw BigQuery SQL queries against Logflare logs. Returns results with microsecond timestamps.

**Parameters:**
- `sql` (string): BigQuery SQL query. Source names are table names (e.g., `FROM \`source-name\``)

**Example:**
```sql
SELECT timestamp, event_message, level 
FROM `my-source` 
WHERE level = 'error' 
LIMIT 10
```

### `list_sources`

Retrieve all available Logflare sources for your account.

**Returns:** Array of sources with `id`, `name`, and `description` fields.

### `get_source_schema`

Get the schema (columns and field definitions) for the configured source. Automatically uses the source token from connection configuration.

**Returns:** Complete schema information including field types and nested structures.

### `get_sample_logs`

Retrieve sample log entries to understand log structure and available fields.

**Parameters:**
- `sourceName` (string): Source name from `list_sources`
- `limit` (number, optional): Number of samples (default: 5, max: 100)

### `query_logs_formatted`

Execute SQL queries with automatically formatted human-readable timestamps.

**Parameters:**
- `sql` (string): BigQuery SQL query. Must specify columns explicitly (no `SELECT *`). Must include `timestamp` column.

**Returns:** Original columns plus `formatted_timestamp` field (YYYY-MM-DD HH:MM:SS format)

**Example:**
```sql
SELECT timestamp, event_message, level 
FROM `my-source` 
WHERE level = 'error' 
LIMIT 10
```

### `explore_fields`

Analyze log structure to discover nested fields and metadata paths.

**Parameters:**
- `sourceName` (string, optional): Source name (defaults to configured source)
- `limit` (number, optional): Number of logs to analyze (default: 10, max: 50)

**Returns:** Field analysis with types, sample values, and nested field paths (e.g., `metadata.userId`, `metadata.email`).

### `get_log_stats`

Get aggregated statistics for logs within a time range.

**Parameters:**
- `timeRange` (string, optional): Time range format - '1h', '24h', '7d', '30d' (default: '24h')
- `sourceName` (string, optional): Source name (defaults to configured source)

**Returns:** Statistics including:
- Total logs count
- Error and warning counts
- Distinct log levels
- Earliest and latest log timestamps

### `get_logs_from_time`

Get logs from a specific timestamp forward. Useful for investigating past incidents by passing the incident timestamp.

**Parameters:**
- `startTime` (string): Timestamp to get logs from. Returns the 20 most recent logs from this time forward
- `sourceName` (string, optional): Source name (defaults to configured source)
- `limit` (number, optional): Number of logs to return (default: 20, max: 20)
- `formatted` (boolean, optional): Include formatted timestamps (default: false)

**Time Format Examples:**
- ISO 8601: `2024-01-15T10:30:00Z`
- Relative: `1 hour ago`, `2 days ago`, `30 minutes ago`, `yesterday`, `now`
- Unix timestamp: `1705312200`

**Use Case:** Pass any timestamp to see what happened from that point forward. Perfect for investigating incidents by providing the incident timestamp.

## Development

```bash
npm run dev    # Development mode with hot reload
npm run build  # Build for production
npm start      # Run production build
```

## Project Structure

```
src/
├── server.ts      # Express server and route handlers
├── tools.ts       # MCP tool definitions
├── logflare.ts    # Logflare API client functions
├── utils.ts       # Utility functions (time parsing, field analysis)
├── types.ts       # TypeScript type definitions
└── config.ts      # Configuration constants
```

## Session Management

- Sessions expire after 30 minutes of inactivity
- Timeouts reset on each message exchange
- Automatic cleanup on connection close
- Each connection gets an isolated MCP server instance

## Error Handling

All tools return structured error responses. The server handles:
- Missing or invalid authentication headers
- BigQuery SQL syntax errors
- Network and API errors
- Session expiration

## Requirements

- Node.js 18+
- Logflare account with API key and source token

## License

MIT
