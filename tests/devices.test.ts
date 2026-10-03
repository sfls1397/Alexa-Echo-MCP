import { describe, expect, it } from "vitest";
import { checkControlResponse, parseDeviceStates, toSmartDevices } from "../src/alexa/devices.js";

const item = (name: string, category: string, ifs: string[], extra: Record<string, unknown> = {}) => ({
  friendlyName: name,
  displayCategories: { primary: { value: category } },
  legacyAppliance: {
    applianceId: `APP-${name}`,
    entityId: `ent-${name}`,
    applianceTypes: [category],
    capabilities: ifs.map((interfaceName) => ({ interfaceName })),
    ...extra
  }
});

describe("toSmartDevices", () => {
  it("keeps enabled, controllable, non-speaker devices", () => {
    const out = toSmartDevices([
      item("Lamp", "LIGHT", ["Alexa.PowerController", "Alexa.BrightnessController", "Alexa.EndpointHealth"]),
      item("Plug", "SMARTPLUG", ["Alexa.PowerController"]),
      item("Den Echo", "ALEXA_VOICE_ENABLED", ["Alexa.Speaker"]),
      item("Printer", "PRINTER", ["Alexa.PrinterController"]),
      item("Old", "LIGHT", ["Alexa.PowerController"], { isEnabled: false }),
      item("Away", "LIGHT", ["Alexa.PowerController"], { applianceNetworkState: { reachability: "NOT_REACHABLE" } })
    ]);
    expect(out).toEqual([
      { name: "Away", applianceId: "APP-Away", entityId: "ent-Away", type: "light", controls: ["power"], reachable: false },
      { name: "Lamp", applianceId: "APP-Lamp", entityId: "ent-Lamp", type: "light", controls: ["power", "brightness"], reachable: true },
      { name: "Plug", applianceId: "APP-Plug", entityId: "ent-Plug", type: "smart plug", controls: ["power"], reachable: true }
    ]);
  });
});

describe("parseDeviceStates", () => {
  it("reads power, brightness, connectivity, and marks errors offline", () => {
    const states = parseDeviceStates({
      deviceStates: [
        {
          entity: { entityId: "A" },
          capabilityStates: [
            JSON.stringify({ namespace: "Alexa.PowerController", name: "powerState", value: "ON" }),
            JSON.stringify({ namespace: "Alexa.BrightnessController", name: "brightness", value: 30 }),
            JSON.stringify({ namespace: "Alexa.EndpointHealth", name: "connectivity", value: { value: "OK" } })
          ]
        },
        { entity: { entityId: "B" }, capabilityStates: [JSON.stringify({ namespace: "Alexa.EndpointHealth", name: "connectivity", value: { value: "UNREACHABLE" } })] }
      ],
      errors: [{ entity: { entityId: "C" }, code: "ENDPOINT_UNREACHABLE" }]
    });
    expect(states.get("A")).toEqual({ online: true, power: "on", brightness: 30 });
    expect(states.get("B")).toEqual({ online: false });
    expect(states.get("C")).toEqual({ online: false });
  });
});

describe("checkControlResponse", () => {
  it("passes clean responses and explains errors", () => {
    expect(() => checkControlResponse({ controlResponses: [{}], errors: [] })).not.toThrow();
    expect(() => checkControlResponse({ errors: [{ code: "ENDPOINT_UNREACHABLE" }] })).toThrow(/offline/);
    expect(() => checkControlResponse({ errors: [{ code: "INVALID_VALUE", message: "bad" }] })).toThrow(/INVALID_VALUE: bad/);
  });
});
