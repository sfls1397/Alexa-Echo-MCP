import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AlexaService, localizeRoutine, NOT_SIGNED_IN, toEchoDevices } from "../src/alexa/client.js";
import { isRegistrationData, keychainSessionStore, type SessionStore } from "../src/alexa/session.js";
import { resolveConfig } from "../src/config.js";

const config = resolveConfig(path.join(os.tmpdir(), "alexa-echo-mcp-no-such-config.json"));

function memoryStore(initial: Record<string, unknown> | null): SessionStore & { saved: unknown[] } {
  let value = initial;
  const saved: unknown[] = [];
  return {
    saved,
    load: () => (value && isRegistrationData(value) ? value : null),
    save: (d) => {
      value = d;
      saved.push(d);
    },
    clear: () => {
      value = null;
      return true;
    }
  };
}

const SESSION = { localCookie: "csrf=x", refreshToken: "r", macDms: { a: 1 } };

describe("toEchoDevices", () => {
  it("keeps Echo speakers and Shows, drops apps, groups and sub-devices", () => {
    const devices = toEchoDevices({
      a: { serialNumber: "a", accountName: "B Echo", deviceFamily: "ECHO", online: true },
      b: { serialNumber: "b", accountName: "A Show", deviceFamily: "KNIGHT", online: false },
      c: { serialNumber: "c", accountName: "Phone app", deviceFamily: "VOX" },
      d: { serialNumber: "d", accountName: "Everywhere", deviceFamily: "WHA" },
      e: { serialNumber: "e", accountName: "Child", deviceFamily: "ECHO", parentDeviceSerialNumber: "a" }
    });
    expect(devices.map((d) => d.name)).toEqual(["A Show", "B Echo"]);
    expect(devices[0]).toMatchObject({ serial: "b", online: false });
  });
});

describe("localizeRoutine", () => {
  it("replaces only the current-locale placeholder", () => {
    const out = localizeRoutine({ sequence: { a: { locale: "ALEXA_CURRENT_LOCALE" }, b: { locale: "fr-FR" } } }, "en-US");
    expect(out).toEqual({ sequence: { a: { locale: "en-US" }, b: { locale: "fr-FR" } } });
  });
});

describe("AlexaService", () => {
  it("says how to sign in when there is no session, without touching Amazon", async () => {
    let created = 0;
    const svc = new AlexaService(config, memoryStore(null), () => {
      created++;
      throw new Error("should not be created");
    });
    await expect(svc.echoes()).rejects.toThrow(NOT_SIGNED_IN);
    expect(created).toBe(0);
  });

  it("never opens the sign-in proxy from the server and saves refreshed sessions", async () => {
    const store = memoryStore(SESSION);
    let generateResult: unknown;
    const fake = {
      cookieData: { ...SESSION, refreshToken: "r2" } as unknown,
      serialNumbers: { s: { serialNumber: "s", accountName: "Den Echo", deviceFamily: "ECHO", online: true } },
      listeners: [] as (() => void)[],
      on(_e: string, l: () => void) {
        this.listeners.push(l);
      },
      generateCookie: (_e: unknown, _p: unknown, cb: (err: Error | null) => void) => cb(null),
      init(options: Record<string, unknown>, cb: (err?: Error) => void) {
        expect(options.cookie).toEqual(SESSION);
        expect(options.useWsMqtt).toBe(false);
        expect(options.logger).toBeUndefined();
        this.generateCookie(undefined, undefined, (err) => {
          generateResult = err;
        });
        this.listeners.forEach((l) => l());
        cb();
      },
      createSequenceNode: () => null,
      sendSequenceCommand: () => undefined,
      getAutomationRoutines: () => undefined,
      stop: () => undefined
    };
    const svc = new AlexaService(config, store, () => fake, () => {});
    const echoes = await svc.echoes();
    expect(echoes.map((e) => e.name)).toEqual(["Den Echo"]);
    expect(String(generateResult)).toContain("Not signed in");
    expect(store.saved.length).toBeGreaterThan(0);
    expect((store.saved.at(-1) as { refreshToken: string }).refreshToken).toBe("r2");
  });

  it("forces the configured locale onto speak requests", async () => {
    let sent: Record<string, unknown> | undefined;
    const fake = {
      cookieData: SESSION as unknown,
      serialNumbers: {},
      on: () => undefined,
      generateCookie: () => undefined,
      init: (_o: unknown, cb: (err?: Error) => void) => cb(),
      createSequenceNode: (command: string, value: string) => ({
        type: command,
        operationPayload: { locale: "ALEXA_CURRENT_LOCALE", textToSpeak: value }
      }),
      sendSequenceCommand: (_s: string, seq: Record<string, unknown>, cb: (err: null) => void) => {
        sent = seq;
        cb(null);
      },
      getAutomationRoutines: () => undefined,
      stop: () => undefined
    };
    const svc = new AlexaService(config, memoryStore(SESSION), () => fake, () => {});
    await svc.speak("s", "hi");
    expect(JSON.stringify(sent)).toContain('"locale":"en-US"');
  });
});

describe("keychainSessionStore", () => {
  it("round-trips through security(1) argv as base64 and rejects junk", () => {
    const items = new Map<string, string>();
    const exec = ((file: string, args: string[]) => {
      expect(file).toBe("/usr/bin/security");
      const key = `${args[args.indexOf("-s") + 1]}/${args[args.indexOf("-a") + 1]}`;
      if (args[0] === "add-generic-password") {
        items.set(key, args[args.indexOf("-w") + 1]);
        return Buffer.from("");
      }
      if (args[0] === "find-generic-password") {
        const v = items.get(key);
        if (v === undefined) throw new Error("not found");
        return Buffer.from(`${v}\n`);
      }
      items.delete(key);
      return Buffer.from("");
    }) as unknown as typeof import("node:child_process").execFileSync;
    const store = keychainSessionStore(exec);
    expect(store.load()).toBeNull();
    store.save(SESSION);
    expect([...items.values()][0]).not.toContain("refreshToken");
    expect(store.load()).toEqual(SESSION);
    items.set([...items.keys()][0], Buffer.from('{"nope":1}').toString("base64"));
    expect(store.load()).toBeNull();
    expect(store.clear()).toBe(true);
  });
});

describe("config", () => {
  it("defaults and validates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aem-"));
    const file = path.join(dir, "config.json");
    expect(resolveConfig(file)).toMatchObject({ serverPort: 8426, loginPort: 8427, amazonPage: "amazon.com", locale: "en-US", echoes: {} });
    fs.writeFileSync(file, JSON.stringify({ serverPort: 9000, echoes: { " My Echo ": " Den Echo " } }));
    expect(resolveConfig(file)).toMatchObject({ serverPort: 9000, echoes: { "My Echo": "Den Echo" } });
    fs.writeFileSync(file, JSON.stringify({ echoes: { x: 5 } }));
    expect(() => resolveConfig(file)).toThrow(/echoes/);
    fs.writeFileSync(file, "{");
    expect(() => resolveConfig(file)).toThrow(/not valid JSON/);
  });
});
