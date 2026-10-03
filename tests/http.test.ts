import type http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { startHttpServer } from "../src/mcp/server.js";
import { fakeAlexa } from "./fake.js";

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("HTTP server", () => {
  it("requires the bearer token and serves the three tools over MCP", async () => {
    const { backend, calls } = fakeAlexa();
    const server = await startHttpServer({
      ctx: { alexa: backend, aliases: { "Echo - Den": "Den Echo" } },
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      log: () => {}
    });
    const port = (server.address() as { port: number }).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: "Bearer nope" } })).status).toBe(401);

      const client = new Client({ name: "test", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: "Bearer test-token" } }
        })
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["alexa_list_routines", "alexa_run_routine", "alexa_speak", "alexa_text_command"]);

      const ok = await client.callTool({ name: "alexa_speak", arguments: { echo: "Echo - Den", message: "hi" } });
      expect(ok.isError).toBeFalsy();
      expect(calls).toEqual(["speak SERIAL-A hi"]);

      const bad = await client.callTool({ name: "alexa_speak", arguments: { echo: "Echo - Nowhere", message: "hi" } });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toContain("No Echo named");
      await client.close();
    } finally {
      await closeServer(server);
    }
  });
});
