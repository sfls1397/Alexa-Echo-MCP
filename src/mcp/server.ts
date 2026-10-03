import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { packageVersion } from "../version.js";
import { verifyAuthHeader } from "./httpAuth.js";
import { callTool, toolDefinitions, type ToolContext } from "./tools.js";

const INSTRUCTIONS = `Alexa Echo MCP: drives the account owner's own Amazon Echo devices through the unofficial Alexa app session (alexa-remote2). Amazon has no official API for this, so it can stop working if Amazon changes things.
- Three actions: alexa_speak (say a message), alexa_run_routine (run a routine by its exact Alexa app name), alexa_text_command (send a command as if spoken, e.g. "turn off the kitchen light").
- alexa_list_routines is read-only: when the user describes what they want rather than naming a routine, read what each routine does, pick by meaning (ask if unsure), then run that exact name.
- Name Echoes only with the names offered in the echo argument. Never invent a device name.
- The Echo's spoken reply does not come back; a success result only means Amazon accepted the request.
- No Drop In, calling, volume, or playback controls.`;

export function createMcpServer(ctx: ToolContext): Server {
  const server = new Server(
    { name: "alexa-echo-mcp", version: packageVersion() },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await toolDefinitions(ctx) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    try {
      const text = await callTool(ctx, request.params.name, args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true };
    }
  });

  return server;
}

export async function startStdioServer(ctx: ToolContext): Promise<void> {
  await createMcpServer(ctx).connect(new StdioServerTransport());
}

export interface StartHttpOptions {
  ctx: ToolContext;
  host: string;
  port: number;
  token: string;
  log?: (message: string) => void;
}

/**
 * Stateless Streamable HTTP (a fresh Server + transport per request, as the
 * SDK's stateless example requires) with a bearer token on every request,
 * including /health. The Alexa connection itself is shared across requests.
 * Binds exactly `port`; clients are configured with that port.
 */
export async function startHttpServer(opts: StartHttpOptions): Promise<http.Server> {
  const log = opts.log || ((message: string) => console.error(message));
  const httpServer = http.createServer((req, res) => {
    if (!verifyAuthHeader(req.headers.authorization, opts.token)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "Unauthorized: missing or invalid bearer token" }));
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad request" }));
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: packageVersion() }));
      return;
    }
    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    void (async () => {
      const server = createMcpServer(opts.ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
      } catch (err) {
        log(`MCP HTTP request error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const port = address && typeof address !== "string" ? address.port : opts.port;
  log(`Alexa Echo MCP (v${packageVersion()}) listening on http://${opts.host}:${port}/mcp`);
  return httpServer;
}
