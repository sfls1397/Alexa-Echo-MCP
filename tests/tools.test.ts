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
    expect(() => findRoutine("Nope", list)).toThrow(/No Alexa routine named exactly "Nope"\.$/);
  });

  it("refuses ambiguous duplicates", () => {
    expect(() => findRoutine("Dup", [routine("Dup"), routine("Dup")])).toThrow(/More than one/);
  });
});

describe("tools", () => {
  it("lists exactly three tools with the real Echo names as the enum", async () => {
    const { backend } = fakeAlexa();
    const defs = await toolDefinitions({ alexa: backend, aliases: ALIASES });
    expect(defs.map((d) => d.name)).toEqual([TOOL_SPEAK, TOOL_RUN_ROUTINE, TOOL_TEXT_COMMAND]);
    const echo = (defs[0].inputSchema.properties as Record<string, { enum?: string[] }>).echo;
    expect(echo.enum).toEqual(["Echo - Den", "Porch Echo"]);
  });

  it("still lists tools (aliases only) when not signed in", async () => {
    const { backend } = fakeAlexa();
    backend.echoes = async () => {
      throw new Error("Not signed in");
    };
    const defs = await toolDefinitions({ alexa: backend, aliases: ALIASES });
    const echo = (defs[2].inputSchema.properties as Record<string, { enum?: string[] }>).echo;
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

  it("runs a routine by exact name and flags disabled ones", async () => {
    const { backend, calls } = fakeAlexa([routine("Lights Off", false)]);
    const out = JSON.parse(
      await callTool({ alexa: backend, aliases: ALIASES }, TOOL_RUN_ROUTINE, { routine: "Lights Off", echo: "Porch Echo" })
    );
    expect(calls).toEqual(["routine SERIAL-B Lights Off"]);
    expect(out.warning).toMatch(/disabled/);
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
