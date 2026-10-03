import type { AlexaBackend, EchoDevice, Routine } from "../src/alexa/client.js";
import type { DeviceState, SmartDevice } from "../src/alexa/devices.js";

// Placeholder devices only; real names live in the user's local config / Alexa account.
export const ECHOES: EchoDevice[] = [
  { name: "Den Echo", serial: "SERIAL-A", family: "ECHO", online: true },
  { name: "Porch Echo", serial: "SERIAL-B", family: "KNIGHT", online: true }
];
export const ALIASES = { "Echo - Den": "Den Echo" };

export const DEVICES: SmartDevice[] = [
  { name: "Hall Light", applianceId: "APP-1", entityId: "ent-1", type: "light", controls: ["power", "brightness"], reachable: true },
  { name: "Kettle", applianceId: "APP-2", entityId: "ent-2", type: "smart plug", controls: ["power"], reachable: true },
  { name: "Fan", applianceId: "APP-4", entityId: "ent-4", type: "smart plug", controls: ["power"], reachable: true },
  { name: "Garage Plug", applianceId: "APP-3", entityId: "ent-3", type: "smart plug", controls: ["power"], reachable: true },
  { name: "Old Lamp", applianceId: "APP-5", entityId: "ent-5", type: "light", controls: ["power"], reachable: false }
];

export function fakeAlexa(routines: Routine[] = []) {
  const calls: string[] = [];
  const states = new Map<string, DeviceState>([
    ["APP-1", { online: true, power: "off", brightness: 40 }],
    ["APP-2", { online: true, power: "off" }],
    ["APP-3", { online: false }]
  ]);
  const backend: AlexaBackend = {
    echoes: async () => ECHOES,
    speak: async (serial, text) => void calls.push(`speak ${serial} ${text}`),
    textCommand: async (serial, text) => void calls.push(`command ${serial} ${text}`),
    routines: async () => routines,
    runRoutine: async (serial, routine) => void calls.push(`routine ${serial} ${routine.name}`),
    devices: async () => DEVICES,
    deviceStates: async (ids) => new Map(ids.filter((id) => states.has(id)).map((id) => [id, { ...(states.get(id) as DeviceState) }])),
    // APP-4 (Fan) never answers a state read in time: no entry = unknown.
    controlDevice: async (id, params) => {
      if (states.get(id)?.online === false) throw new Error("The device is not reachable (offline).");
      calls.push(`control ${id} ${JSON.stringify(params)}`);
      const s = states.get(id);
      if (!s) return;
      if (params.action === "turnOn") s.power = "on";
      if (params.action === "turnOff") s.power = "off";
      if (params.action === "setBrightness") {
        s.brightness = params.brightness as number;
        s.power = "on";
      }
    }
  };
  return { backend, calls, states };
}
