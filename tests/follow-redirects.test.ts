import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const { http: redirects } = createRequire(import.meta.url)("follow-redirects");

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a loopback TCP listener"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function redirectedHeaders(sensitiveHeaders: string[], arrayHeaders: boolean): Promise<IncomingHttpHeaders> {
  const destination = createServer((request, response) => response.end(JSON.stringify(request.headers)));
  const origin = createServer();
  try {
    const destinationPort = await listen(destination);
    origin.on("request", (_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${destinationPort}/target` });
      response.end();
    });
    const originPort = await listen(origin);
    const headers = {
      "X-Test-Sensitive": "synthetic-test-value",
      "X-Harmless": "preserved",
      Authorization: "synthetic-authorization",
      "Proxy-Authorization": "synthetic-proxy-authorization",
      Cookie: "synthetic-cookie=yes"
    };
    return await new Promise((resolve, reject) => {
      const request = redirects.get(`http://127.0.0.1:${originPort}/start`, {
        sensitiveHeaders,
        headers: arrayHeaders ? Object.entries(headers).flat() : headers,
        maxRedirects: 1
      }, (response: import("node:http").IncomingMessage) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("error", reject);
        response.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      });
      request.setTimeout(2000, () => request.destroy(new Error("Loopback redirect timed out")));
      request.on("error", reject);
    });
  } finally {
    await Promise.all([close(origin), close(destination)]);
  }
}

describe("follow-redirects sensitive headers", () => {
  it.each([
    ["same-realm object headers", false, false],
    ["cross-realm object headers", true, false],
    ["same-realm array headers", false, true],
    ["cross-realm array headers", true, true]
  ])("strips credentials across origins with %s", async (_label, crossRealm, arrayHeaders) => {
    const sensitiveHeaders = crossRealm ? runInNewContext('["X-Test-Sensitive"]') : ["X-Test-Sensitive"];
    const received = await redirectedHeaders(sensitiveHeaders, arrayHeaders);
    expect(received["x-test-sensitive"]).toBeUndefined();
    expect(received.authorization).toBeUndefined();
    expect(received["proxy-authorization"]).toBeUndefined();
    expect(received.cookie).toBeUndefined();
    expect(received["x-harmless"]).toBe("preserved");
  });
});
