import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config.js";

const remote = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../src/alexa/client.js", async (original) => {
  const actual: Record<string, unknown> = await original();
  return { ...actual, newAlexaRemote: () => remote.current };
});

it("shows the sign-in URL once when alexa-cookie2's first callback says the proxy is up, and finishes on the later result", async () => {
  const { runLogin } = await import("../src/alexa/login.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "alexa-echo-mcp-login-"));
  process.env.ALEXA_ECHO_MCP_HOME = home;
  const session = { localCookie: "csrf=x", refreshToken: "r" };
  const saved: unknown[] = [];
  const urls: string[] = [];
  remote.current = {
    cookieData: session,
    serialNumbers: { s: { serialNumber: "s", accountName: "Den Echo", deviceFamily: "ECHO", online: true } },
    init: (_options: unknown, cb: (err?: Error) => void) => {
      cb(new Error("Please open http://127.0.0.1:8427/ in your browser"));
      cb(new Error("Please open http://127.0.0.1:8427/ in your browser"));
      cb();
    },
    stop: () => undefined
  };
  try {
    const names = await runLogin({
      config: resolveConfig(path.join(home, "no-such-config.json")),
      store: { load: () => null, save: (data) => void saved.push(data), clear: () => true },
      onUrl: (url) => void urls.push(url),
      log: () => {}
    });
    expect(urls).toEqual(["http://127.0.0.1:8427/"]);
    expect(saved).toEqual([session]);
    expect(names).toEqual(["Den Echo"]);
  } finally {
    delete process.env.ALEXA_ECHO_MCP_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
