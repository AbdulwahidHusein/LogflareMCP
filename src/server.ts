/**
 * Main Express server for Logflare MCP integration.
 * Handles SSE connections, session management, and message routing.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import cors from "cors";
import { SESSION_TIMEOUT_MS, DEFAULT_PORT } from "./config.js";
import { Session, LogflareApiConfig } from "./types.js";
import { registerTools } from "./tools.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text());

const activeSessions = new Map<string, Session>();

/**
 * Validates and extracts authentication headers from the request.
 */
function getAuthConfig(req: express.Request): LogflareApiConfig | null {
  const apiKey = req.headers["x-logflare-api-key"];
  const sourceToken = req.headers["x-logflare-source-token"];

  if (!apiKey || typeof apiKey !== "string") {
    return null;
  }

  if (!sourceToken || typeof sourceToken !== "string") {
    return null;
  }

  return { apiKey, sourceToken };
}

/**
 * Creates a new session timeout handler.
 */
function createSessionTimeout(sessionId: string): NodeJS.Timeout {
  return setTimeout(() => {
    activeSessions.delete(sessionId);
    console.log(`Session ${sessionId} expired`);
  }, SESSION_TIMEOUT_MS);
}

/**
 * Cleans up a session and clears its timeout.
 */
function cleanupSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    clearTimeout(session.timeout);
    activeSessions.delete(sessionId);
    console.log(`Session ${sessionId} closed`);
  }
}

/**
 * SSE endpoint for establishing MCP connections.
 */
app.get("/sse", async (req, res) => {
  const config = getAuthConfig(req);

  if (!config) {
    res.status(401).send(
      "Missing required headers: 'x-logflare-api-key' and 'x-logflare-source-token'"
    );
    return;
  }

  const server = new McpServer({
    name: "logflare-mcp",
    version: "1.0.0",
  });

  registerTools(server, config);

  const transport = new SSEServerTransport("/messages", res);
  const timeout = createSessionTimeout(transport.sessionId);

  activeSessions.set(transport.sessionId, {
    server,
    transport,
    timeout,
  });

  res.on("close", () => {
    cleanupSession(transport.sessionId);
  });

  try {
    await server.connect(transport);
  } catch (error: unknown) {
    cleanupSession(transport.sessionId);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).send(`Failed to connect: ${errorMessage}`);
  }
});

/**
 * Handles POST requests to /sse endpoint.
 * Returns 405 Method Not Allowed since SSE uses GET.
 */
app.post("/sse", (req, res) => {
  res.status(405).json({
    error: "Method not allowed. Use GET for SSE connections.",
  });
});

/**
 * Message endpoint for MCP protocol communication.
 */
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).send("Missing sessionId parameter");
    return;
  }

  const session = activeSessions.get(sessionId);

  if (!session) {
    res.status(404).send("Session not found or expired");
    return;
  }

  clearTimeout(session.timeout);
  session.timeout = createSessionTimeout(sessionId);

  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).send(`Message handling error: ${errorMessage}`);
  }
});

const PORT = process.env.PORT || DEFAULT_PORT;
app.listen(PORT, () => {
  console.log(`Logflare MCP server running on port ${PORT}`);
});