import { describe, expect, it } from "vitest";
import type { Routine } from "../src/alexa/client.js";
import { ALIASES, ECHOES, fakeAlexa } from "./fake.js";
import {
  callTool,
  echoNames,
  findRoutine,
  resolveEcho,
  stripWakeWord,
  toolDefinitions,
  TOOL_CONTROL_DEVICE,
  TOOL_LIST_DEVICES,
  TOOL_LIST_ROUTINES,
  TOOL_RUN_ROUTINE,
  TOOL_SPEAK,
  TOOL_TEXT_COMMAND
} from "../src/mcp/tools.js";

const routine = (name: string, enabled = true): Routine => ({ name, enabled, raw: { name } });

describe("echo names", () => {
  it("offers aliases and un-aliased Alexa names", () => {
    expect(echoNames(ECHOES, ALIASES)).toEqual(["Echo - Den", "Porch Echo"]);
  });

  it("resolves an alias, an Alexa name, case-insensitively", () => {
    expect(resolveEcho("echo - den", ECHOES, ALIASES).serial).toBe("SERIAL-A");
    expect(resolveEcho("Den Echo", ECHOES, ALIASES).serial).toBe("SERIAL-A");
    expect(resolveEcho("porch echo", ECHOES, ALIASES).serial).toBe("SERIAL-B");
  });

  it("rejects made-up names and lists the real ones", () => {
    expect(() => resolveEcho("Echo - Garage", ECHOES, ALIASES)).toThrow(/No Echo named "Echo - Garage".*Echo - Den, Porch Echo/);
  });

  it("explains an alias that points at nothing", () => {
    expect(() => resolveEcho("Gone", ECHOES, { Gone: "Missing Echo" })).toThrow(/set up to mean "Missing Echo"/);
  });
});

describe("routines", () => {
  it("needs the exact name and hints at a case mismatch", () => {
    const list = [routine("Good Night"), routine("Morning")];
    expect(findRoutine("Good Night", list).name).toBe("Good Night");
    expect(() => findRoutine("good night", list)).toThrow(/Did you mean "Good Night"/);
    expect(() => findRoutine("Nope", list)).toThrow(/No Alexa routine named exactly "Nope"\. Use alexa_list_routines/);
  });

  it("refuses ambiguous duplicates", () => {
    expect(() => findRoutine("Dup", [routine("Dup"), routine("Dup")])).toThrow(/More than one/);
  });
});

describe("tools", () => {
  it("lists all tools, with the real Echo names as the enum", async () => {
    const { backend } = fakeAlexa();
    const defs = await toolDefinitions({ alexa: backend, aliases: ALIASES });
    expect(defs.map((d) => d.name)).toEqual([TOOL_SPEAK, TOOL_LIST_ROUTINES, TOOL_RUN_ROUTINE, TOOL_TEXT_COMMAND, TOOL_LIST_DEVICES, TOOL_CONTROL_DEVICE]);
    const device = (defs[5].inputSchema.properties as Record<string, { enum?: string[] }>).device;
    expect(device.enum).toEqual(["Hall Light", "Kettle", "Fan", "Garage Plug", "Old Lamp"]);
    const echo = (defs[0].inputSchema.properties as Record<string, { enum?: string[] }>).echo;
    expect(echo.enum).toEqual(["Echo - Den", "Porch Echo"]);
  });

  it("still lists tools (aliases only) when not signed in", async () => {
    const { backend } = fakeAlexa();
    backend.echoes = async () => {
      throw new Error("Not signed in");
    };
    const defs = await toolDefinitions({ alexa: backend, aliases: ALIASES });
    const echo = (defs[3].inputSchema.properties as Record<string, { enum?: string[] }>).echo;
    expect(echo.enum).toEqual(["Echo - Den"]);
  });

  it("speaks on the resolved Echo", async () => {
    const { backend, calls } = fakeAlexa();
    const out = JSON.parse(await callTool({ alexa: backend, aliases: ALIASES }, TOOL_SPEAK, { echo: "Echo - Den", message: " hello   there " }));
    expect(calls).toEqual(["speak SERIAL-A hello there"]);
    expect(out).toMatchObject({ ok: true, echo: "Echo - Den", alexaName: "Den Echo" });
    expect(out.note).toMatch(/reply.*does not come back/);
  });

  it("rejects over-long speech before calling Amazon", async () => {
    const { backend, calls } = fakeAlexa();
    await expect(
      callTool({ alexa: backend, aliases: ALIASES }, TOOL_SPEAK, { echo: "Echo - Den", message: "x".repeat(251) })
    ).rejects.toThrow(/limit is 250/);
    expect(calls).toEqual([]);
  });

  it("runs an enabled routine by exact name", async () => {
    const { backend, calls } = fakeAlexa([routine("Lights Off")]);
    const out = JSON.parse(
      await callTool({ alexa: backend, aliases: ALIASES }, TOOL_RUN_ROUTINE, { routine: "Lights Off", echo: "Porch Echo" })
    );
    expect(calls).toEqual(["routine SERIAL-B Lights Off"]);
    expect(out).toMatchObject({ ok: true, routine: "Lights Off" });
  });

  it("refuses a disabled routine and runs nothing", async () => {
    const { backend, calls } = fakeAlexa([routine("Lights Off", false)]);
    await expect(
      callTool({ alexa: backend, aliases: ALIASES }, TOOL_RUN_ROUTINE, { routine: "Lights Off", echo: "Porch Echo" })
    ).rejects.toThrow(/turned off in the Alexa app/);
    expect(calls).toEqual([]);
  });

  it("sends a text command without the wake word", async () => {
    const { backend, calls } = fakeAlexa();
    await callTool({ alexa: backend, aliases: ALIASES }, TOOL_TEXT_COMMAND, { echo: "Echo - Den", command: "Alexa, turn off the lamp" });
    expect(calls).toEqual(["command SERIAL-A turn off the lamp"]);
  });

  it("does nothing for an unknown Echo", async () => {
    const { backend, calls } = fakeAlexa();
    await expect(
      callTool({ alexa: backend, aliases: ALIASES }, TOOL_TEXT_COMMAND, { echo: "Echo - Attic", command: "play jazz" })
    ).rejects.toThrow(/No Echo named/);
    expect(calls).toEqual([]);
  });

  it("strips only a leading wake word", () => {
    expect(stripWakeWord("Alexa play jazz")).toBe("play jazz");
    expect(stripWakeWord("echo, what time is it")).toBe("what time is it");
    expect(stripWakeWord("play alexa radio")).toBe("play alexa radio");
  });
});

describe("alexa_list_routines", () => {
  const routines = [
    {
      name: "Bedtime",
      enabled: true,
      raw: {
        name: "Bedtime",
        triggers: [{ type: "CustomUtterance", payload: { utterances: ["bedtime", "lights out"] } }],
        sequence: {
          "@type": "Sequence",
          startNode: {
            "@type": "SerialNode",
            nodesToExecute: [
              { "@type": "ParallelNode", nodesToExecute: [
                { type: "Alexa.SmartHome.Batch", operationPayload: { target: "virtual@LIGHT@X", filter: { includeList: ["a", "b"] }, operations: [{ type: "turnOn" }, { type: "setBrightness", brightness: 5 }] } }
              ] },
              { type: "Alexa.Speak", operationPayload: { textToSpeak: "good night" } },
              { type: "Alexa.LLM.CustomTextCommand", operationPayload: { text: "ask door control to close the shed" } }
            ]
          }
        }
      }
    },
    {
      name: "Away",
      enabled: false,
      raw: {
        name: "Away",
        triggers: [{ type: "Alexa.Trigger.HomeModes.ModeRoutineStateChange", payload: { state: "AWAY" } }, { type: "geoFenceTriggerEvent", payload: {} }],
        sequence: { startNode: { type: "Alexa.SmartHome.Batch", operationPayload: { target: "virtual@LIGHT@X", operations: [{ type: "turnOff" }] } } }
      }
    }
  ];

  it("returns enabled routines in plain words, sorted, and runs nothing", async () => {
    const { backend, calls } = fakeAlexa(routines);
    const out = JSON.parse(await callTool({ alexa: backend, aliases: ALIASES }, TOOL_LIST_ROUTINES, {}));
    expect(calls).toEqual([]);
    expect(out.routines).toEqual([
      {
        name: "Bedtime",
        voicePhrases: ["bedtime", "lights out"],
        otherTriggers: [],
        steps: ["Smart home: lights (2): turn on, brightness 5%", 'Alexa says: "good night"', 'Tells Alexa: "ask door control to close the shed"']
      }
    ]);
  });
});

describe("devices", () => {
  const ctx = (b: ReturnType<typeof fakeAlexa>["backend"]) => ({ alexa: b, aliases: ALIASES });

  it("lists online devices (unknown state kept, unreachable left out) with plain controls", async () => {
    const { backend, calls } = fakeAlexa();
    const out = JSON.parse(await callTool(ctx(backend), TOOL_LIST_DEVICES, {}));
    expect(calls).toEqual([]);
    expect(out.devices).toEqual([
      { name: "Hall Light", type: "light", can: ["turn on/off", "brightness 0-100%"], state: { power: "off", brightness: 40 } },
      { name: "Kettle", type: "smart plug", can: ["turn on/off"], state: { power: "off" } },
      { name: "Fan", type: "smart plug", can: ["turn on/off"], state: "unknown" }
    ]);
    expect(out.note).toMatch(/lag/);
  });

  it("turns a device on without re-reading state", async () => {
    const { backend, calls } = fakeAlexa();
    const out = JSON.parse(await callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "kettle", action: "turn_on" }));
    expect(calls).toEqual(['control APP-2 {"action":"turnOn"}']);
    expect(out).toMatchObject({ ok: true, device: "Kettle", action: "turn_on" });
    expect(out.note).toMatch(/lag/);
  });

  it("controls a device whose state read timed out", async () => {
    const { backend, calls } = fakeAlexa();
    await callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Fan", action: "turn_off" });
    expect(calls).toEqual(['control APP-4 {"action":"turnOff"}']);
  });

  it("sets brightness", async () => {
    const { backend, calls } = fakeAlexa();
    const out = JSON.parse(await callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Hall Light", action: "set_brightness", brightness: 15 }));
    expect(calls).toEqual(['control APP-1 {"action":"setBrightness","brightness":15}']);
    expect(out).toMatchObject({ ok: true, brightness: 15 });
  });

  it("refuses offline devices, missing controls, bad values and unknown names without sending anything", async () => {
    const { backend, calls } = fakeAlexa();
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Garage Plug", action: "turn_on" })).rejects.toThrow(/"Garage Plug" is offline/);
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Old Lamp", action: "turn_on" })).rejects.toThrow(/"Old Lamp" is offline/);
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Kettle", action: "set_brightness", brightness: 50 })).rejects.toThrow(/no brightness control/);
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Hall Light", action: "set_brightness", brightness: 150 })).rejects.toThrow(/0 to 100/);
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Attic Fan", action: "turn_on" })).rejects.toThrow(/No controllable device named "Attic Fan"/);
    await expect(callTool(ctx(backend), TOOL_CONTROL_DEVICE, { device: "Kettle", action: "explode" })).rejects.toThrow(/action/);
    expect(calls).toEqual([]);
  });

  it("names devices in routine steps", async () => {
    const r = {
      name: "Evening",
      enabled: true,
      raw: { name: "Evening", triggers: [], sequence: { startNode: { type: "Alexa.SmartHome.Batch", operationPayload: { target: "virtual@LIGHT@X", filter: { includeList: ["ent-1", "ent-2"] }, operations: [{ type: "turnOff" }] } } } }
    };
    const { backend } = fakeAlexa([r]);
    const out = JSON.parse(await callTool(ctx(backend), TOOL_LIST_ROUTINES, {}));
    expect(out.routines[0].steps).toEqual(["Smart home: Hall Light, Kettle: turn off"]);
  });
});
