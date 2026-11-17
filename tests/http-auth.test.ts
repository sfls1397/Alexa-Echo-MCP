import { describe, it, expect, vi } from "vitest";
import { ENV_TOKEN_VAR, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, loadOrCreateHttpAuthToken, verifyAuthHeader } from "../src/mcp/httpAuth.js";

const KEYCHAIN_FIXTURE = "FAKE_KEYCHAIN_TOKEN";
const ENV_FIXTURE = "FAKE_ENV_TOKEN";

function keychainHolding(value: string | null) {
  return vi.fn((_file: string, args: readonly string[]) => {
    if (args[0] === "find-generic-password") {
      if (value === null) throw new Error("item not found");
      return Buffer.from(`${value}\n`);
    }
    return Buffer.from("");
  });
}

const quiet = () => undefined;
const fixedBytes = vi.fn(() => Buffer.alloc(32, 0xab)) as any;

describe("loadOrCreateHttpAuthToken", () => {
  it("exports the injected variable name the http-proxy already uses", () => {
    expect(ENV_TOKEN_VAR).toBe("ALEXA_ECHO_MCP_TOKEN");
  });

  it("uses a nonempty injected token with zero Keychain calls", () => {
    const exec = keychainHolding(KEYCHAIN_FIXTURE);
    const result = loadOrCreateHttpAuthToken({ env: { [ENV_TOKEN_VAR]: ENV_FIXTURE }, execFileSync: exec as any, log: quiet });
    expect(result).toEqual({ token: ENV_FIXTURE, generated: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from the injected token, still with zero Keychain calls", () => {
    const exec = keychainHolding(KEYCHAIN_FIXTURE);
    const result = loadOrCreateHttpAuthToken({ env: { [ENV_TOKEN_VAR]: `  ${ENV_FIXTURE}\n` }, execFileSync: exec as any, log: quiet });
    expect(result).toEqual({ token: ENV_FIXTURE, generated: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ["empty", { [ENV_TOKEN_VAR]: "" }],
    ["whitespace only", { [ENV_TOKEN_VAR]: " \t\n " }]
  ])("falls back to the Keychain when the variable is %s", (_label, env) => {
    const exec = keychainHolding(KEYCHAIN_FIXTURE);
    const result = loadOrCreateHttpAuthToken({ env, execFileSync: exec as any, log: quiet });
    expect(result).toEqual({ token: KEYCHAIN_FIXTURE, generated: false });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe("/usr/bin/security");
    expect(exec.mock.calls[0][1]).toEqual(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"]);
  });

  it("generates and stores a token when neither the variable nor the Keychain has one", () => {
    const exec = keychainHolding(null);
    const result = loadOrCreateHttpAuthToken({ env: { [ENV_TOKEN_VAR]: "  " }, execFileSync: exec as any, randomBytes: fixedBytes, log: quiet });
    expect(result).toEqual({ token: "ab".repeat(32), generated: true });
    expect(exec.mock.calls.map((c) => c[1][0])).toEqual(["find-generic-password", "-i"]);
  });

  it("forceNew ignores the injected token and the Keychain, generating and storing a new one", () => {
    const exec = keychainHolding(KEYCHAIN_FIXTURE);
    const logs: string[] = [];
    const result = loadOrCreateHttpAuthToken({
      forceNew: true,
      env: { [ENV_TOKEN_VAR]: ENV_FIXTURE },
      execFileSync: exec as any,
      randomBytes: fixedBytes,
      log: (m) => logs.push(m)
    });
    expect(result).toEqual({ token: "ab".repeat(32), generated: true });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toEqual(["-i"]);
    expect(logs.join("\n")).not.toContain("ab".repeat(32));
    expect(logs.join("\n")).not.toContain(ENV_FIXTURE);
  });

  it("env: {} (the http-token command) ignores an ALEXA_ECHO_MCP_TOKEN in process.env and generates into the Keychain", () => {
    const saved = process.env[ENV_TOKEN_VAR];
    process.env[ENV_TOKEN_VAR] = ENV_FIXTURE;
    try {
      const exec = keychainHolding(null);
      const result = loadOrCreateHttpAuthToken({ env: {}, execFileSync: exec as any, randomBytes: fixedBytes, log: quiet });
      expect(result).toEqual({ token: "ab".repeat(32), generated: true });
      expect(exec.mock.calls.map((c) => c[1][0])).toEqual(["find-generic-password", "-i"]);
    } finally {
      if (saved === undefined) delete process.env[ENV_TOKEN_VAR];
      else process.env[ENV_TOKEN_VAR] = saved;
    }
  });

  it("reads process.env when no env option is given", () => {
    const saved = process.env[ENV_TOKEN_VAR];
    process.env[ENV_TOKEN_VAR] = ENV_FIXTURE;
    try {
      const exec = keychainHolding(KEYCHAIN_FIXTURE);
      expect(loadOrCreateHttpAuthToken({ execFileSync: exec as any, log: quiet }).token).toBe(ENV_FIXTURE);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env[ENV_TOKEN_VAR];
      else process.env[ENV_TOKEN_VAR] = saved;
    }
  });
});

describe("verifyAuthHeader with an injected token", () => {
  it("accepts only the exact injected token", () => {
    const exec = keychainHolding(KEYCHAIN_FIXTURE);
    const { token } = loadOrCreateHttpAuthToken({ env: { [ENV_TOKEN_VAR]: ENV_FIXTURE }, execFileSync: exec as any, log: quiet });
    expect(verifyAuthHeader(`Bearer ${ENV_FIXTURE}`, token)).toBe(true);
    expect(verifyAuthHeader(`Bearer ${KEYCHAIN_FIXTURE}`, token)).toBe(false);
    expect(verifyAuthHeader(undefined, token)).toBe(false);
  });
});
