import type http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { startHttpServer } from "../src/mcp/server.js";
import { fakeAlexa } from "./fake.js";
import { ENV_TOKEN_VAR, PREVIOUS_TOKEN_ENV, takePreviousHttpAuthToken } from "../src/mcp/httpAuth.js";

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("HTTP server", () => {
  it("requires the bearer token on every request, health check included, and serves the tools over MCP", async () => {
    const { backend, calls } = fakeAlexa();
    const server = await startHttpServer({
      ctx: { alexa: backend, aliases: { "Echo - Den": "Den Echo" } },
      host: "127.0.0.1",
      port: 0,
      token: "FAKE_TEST_TOKEN",
      log: () => {}
    });
    const port = (server.address() as { port: number }).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: "Bearer FAKE_INVALID_TOKEN" } })).status).toBe(401);

      const client = new Client({ name: "test", version: "0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: "Bearer FAKE_TEST_TOKEN" } }
        })
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["alexa_control_device", "alexa_list_devices", "alexa_list_routines", "alexa_run_routine", "alexa_speak", "alexa_text_command"]);

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

it.each([
  { phase: "overlap", token: "fixture-new", current: "fixture-new", previous: "fixture-old", statuses: [200, 200] },
  { phase: "rollback", token: "fixture-old", current: "fixture-old", previous: undefined, statuses: [200, 401] },
  { phase: "retirement", token: "fixture-new", current: "fixture-new", previous: undefined, statuses: [401, 200] },
  { phase: "Keychain fallback", token: "fixture-old", current: undefined, previous: "fixture-new", statuses: [200, 401] },
  { phase: "wrong primary", token: "fixture-old", current: "fixture-other", previous: "fixture-new", statuses: [200, 401] },
])("enforces the $phase token slots on HTTP requests", async ({ token, current, previous, statuses }) => {
  const env = { [ENV_TOKEN_VAR]: current, [PREVIOUS_TOKEN_ENV]: previous };
  const previousToken = takePreviousHttpAuthToken(token, env);
  expect(Object.hasOwn(env, PREVIOUS_TOKEN_ENV)).toBe(false);
  const { backend } = fakeAlexa();
  const fixture = await startHttpServer({ ctx: { alexa: backend, aliases: {} }, host: "127.0.0.1", port: 0, token, previousToken, log: () => {} });
  try {
    const { port } = fixture.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;
    const health = async (candidate: string) => {
      const response = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${candidate}` } });
      await response.arrayBuffer();
      return response.status;
    };
    expect(await Promise.all([health("fixture-old"), health("fixture-new")])).toEqual(statuses);
    expect(await health("fixture-bad")).toBe(401);
    const denied = await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: "Bearer fixture-bad" } });
    expect(denied.status).toBe(401);
    await denied.arrayBuffer();
  } finally {
    await closeServer(fixture);
  }
});
