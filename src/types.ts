/**
 * Type definitions for the Logflare MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export interface Session {
  server: McpServer;
  transport: SSEServerTransport;
  timeout: NodeJS.Timeout;
}

export interface LogflareSource {
  id?: string;
  name?: string;
  description?: string;
}

export interface FieldInfo {
  type: string;
  sampleValues: unknown[];
  isNested: boolean;
}

export interface LogflareApiConfig {
  apiKey: string;
  sourceToken: string;
}

