# Logflare MCP Server

A  [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides AI assistants with powerful tools to query, analyze, and explore logs from [Logflare](https://logflare.app). Built with TypeScript and Express, this server enables seamless integration between AI applications and Logflare's BigQuery-powered log management platform.

## Features

- **🔍 Advanced Log Querying**: Execute raw BigQuery SQL queries against Logflare logs with full BigQuery syntax support
- **📊 Schema Discovery**: Automatically discover available columns and field structures in your log sources
- **📈 Log Analytics**: Get aggregated statistics, error counts, and time-based analysis
- **🔎 Field Exploration**: Discover nested fields and metadata structures in your logs
- **⏱️ Time Range Queries**: Query logs between specific time points with flexible time format parsing
- **🎯 Source Management**: List and manage multiple Logflare sources
- **📝 Formatted Output**: Get human-readable timestamps alongside raw microsecond timestamps
- **🔐 Secure Authentication**: API key and source token-based authentication
- **⚡ High Performance**: Efficient session management with automatic cleanup
- **🧩 Modular Architecture**: Clean, maintainable codebase ready for production deployment

## Installation

### Prerequisites

- Node.js 18+ 
- npm, yarn, or pnpm
- A Logflare account with API key and source token

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/logflare-mcp-remote.git
cd logflare-mcp-remote

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

For development:

```bash
npm run dev
```

## Configuration

### Environment Variables

The server runs on port `3000` by default. You can override this with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### MCP Client Configuration

Configure your MCP client (e.g., Cursor, Claude Desktop) with the following settings:

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
- `x-logflare-source-token`: The source token for the Logflare source you want to query

## Available Tools

The server provides the following MCP tools for AI assistants:

### 1. `query_logs`

Execute raw BigQuery SQL queries against Logflare logs. Returns results with microsecond timestamps.

**Parameters:**
- `sql` (string): BigQuery SQL query. Must reference source names as table names (e.g., `FROM \`source-name\``)

**Example:**
```sql
SELECT timestamp, event_message, level 
FROM `my-source` 
WHERE level = 'error' 
LIMIT 10
```

### 2. `list_sources`

Retrieve all available Logflare sources for your account.

**Returns:** Array of sources with `id`, `name`, and `description` fields.

### 3. `get_source_schema`

Get the schema (columns and field definitions) for the configured source. Automatically uses the source token from connection configuration.

**Returns:** Complete schema information including field types and nested structures.

### 4. `get_sample_logs`

Retrieve sample log entries to understand log structure and available fields.

**Parameters:**
- `sourceName` (string): Source name from `list_sources`
- `limit` (number, optional): Number of samples (default: 5, max: 100)

### 5. `query_logs_formatted`

Execute SQL queries with automatically formatted human-readable timestamps.

**Parameters:**
- `sql` (string): BigQuery SQL query (must specify columns explicitly, no `SELECT *`)

**Returns:** Original columns plus `formatted_timestamp` field (YYYY-MM-DD HH:MM:SS format)

### 6. `explore_fields`

Analyze log structure to discover nested fields and metadata paths.

**Parameters:**
- `sourceName` (string, optional): Source name (defaults to configured source)
- `limit` (number, optional): Number of logs to analyze (default: 10, max: 50)

**Returns:** Field analysis with types, sample values, and nested field paths.

### 7. `get_log_stats`

Get aggregated statistics for logs within a time range.

**Parameters:**
- `timeRange` (string, optional): Time range (e.g., '1h', '24h', '7d', '30d', default: '24h')
- `sourceName` (string, optional): Source name (defaults to configured source)

**Returns:** Statistics including total logs, error counts, warning counts, log levels, and time range.

### 8. `get_logs_by_time_range`

Query logs between two specific time points.

**Parameters:**
- `startTime` (string): Start time (ISO 8601, relative time like '1 hour ago', or Unix timestamp)
- `endTime` (string): End time (same formats as startTime)
- `sourceName` (string, optional): Source name (defaults to configured source)
- `limit` (number, optional): Maximum results (default: 100, max: 1000)
- `formatted` (boolean, optional): Include formatted timestamps (default: false)

**Time Format Examples:**
- ISO 8601: `2024-01-15T10:30:00Z`
- Relative: `1 hour ago`, `2 days ago`, `yesterday`
- Unix timestamp: `1705312200`

## Architecture


```
src/
├── server.ts      # Express server and route handlers
├── tools.ts       # MCP tool definitions
├── logflare.ts    # Logflare API client functions
├── utils.ts       # Utility functions (time parsing, field analysis)
├── types.ts       # TypeScript type definitions
└── config.ts      # Configuration constants
```

## API Endpoints

### `GET /sse`

Establishes an SSE (Server-Sent Events) connection for MCP protocol communication.

**Headers:**
- `x-logflare-api-key`: Required
- `x-logflare-source-token`: Required

### `POST /messages`

Handles MCP protocol messages. Requires `sessionId` query parameter.

### `POST /sse`

Returns `405 Method Not Allowed` (SSE uses GET).

## Session Management

- Sessions automatically expire after 30 minutes of inactivity
- Session timeouts reset on each message exchange
- Automatic cleanup on connection close
- Each connection gets its own isolated MCP server instance

## Error Handling

All tools return structured error responses with clear error messages. The server handles:
- Missing authentication headers
- Invalid API keys or source tokens
- BigQuery SQL syntax errors
- Network errors
- Session expiration

## Development

### Project Structure

- **TypeScript**: Strict type checking enabled
- **ES Modules**: Modern JavaScript module system
- **Express**: Web framework for HTTP server
- **Zod**: Schema validation for tool parameters

### Building

```bash
npm run build
```

Output is compiled to the `dist/` directory.

### Development Mode

```bash
npm run dev
```

Uses `tsx` for direct TypeScript execution without compilation.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.



## Related Projects

- [Logflare](https://logflare.app) - Log management and analytics platform
- [Model Context Protocol](https://modelcontextprotocol.io) - Protocol for AI application context
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - TypeScript SDK for MCP

## Support

For issues, questions, or contributions, please open an issue on GitHub.


