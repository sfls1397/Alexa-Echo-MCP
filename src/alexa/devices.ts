/**
 * Smart-home devices on the Alexa account (lights, plugs, ...): what each one
 * is, what it can do, and its live state. Echo / speaker devices are left out;
 * they're driven by the speak and text-command tools instead.
 */

export type DeviceControl = "power" | "brightness";

export interface SmartDevice {
  name: string;
  /** Used for state queries and control requests. */
  applianceId: string;
  /** Used by routine steps to refer to the device. */
  entityId: string;
  /** Plain words, e.g. "light", "smart plug", "tv". */
  type: string;
  controls: DeviceControl[];
}

export interface DeviceState {
  online: boolean;
  power?: "on" | "off";
  brightness?: number;
}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

const INTERFACE_CONTROLS: Record<string, DeviceControl> = {
  "Alexa.PowerController": "power",
  "Alexa.BrightnessController": "brightness"
};

/** Parse alexa-remote2 getSmarthomeDevicesV2 items into controllable, enabled, non-speaker devices. */
export function toSmartDevices(items: unknown[]): SmartDevice[] {
  const out: SmartDevice[] = [];
  for (const raw of items || []) {
    const item = obj(raw);
    const la = obj(item.legacyAppliance);
    const category = String(obj(obj(item.displayCategories).primary).value ?? "");
    if (category === "ALEXA_VOICE_ENABLED") continue;
    if (la.isEnabled === false) continue;
    const name = typeof item.friendlyName === "string" ? item.friendlyName.trim() : "";
    const applianceId = typeof la.applianceId === "string" ? la.applianceId : "";
    const entityId = typeof la.entityId === "string" ? la.entityId : "";
    if (!name || !applianceId) continue;
    const controls = new Set<DeviceControl>();
    for (const c of Array.isArray(la.capabilities) ? la.capabilities : []) {
      const control = INTERFACE_CONTROLS[String(obj(c).interfaceName ?? "")];
      if (control) controls.add(control);
    }
    if (!controls.size) continue;
    const types = Array.isArray(la.applianceTypes) ? la.applianceTypes : [];
    const type = String(types[0] ?? category ?? "device")
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^smartplug$/, "smart plug");
    out.push({ name, applianceId, entityId, type, controls: (["power", "brightness"] as DeviceControl[]).filter((c) => controls.has(c)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse a /api/phoenix/state response into applianceId -> state. Devices with errors are offline. */
export function parseDeviceStates(response: unknown): Map<string, DeviceState> {
  const states = new Map<string, DeviceState>();
  const res = obj(response);
  for (const ds of Array.isArray(res.deviceStates) ? res.deviceStates : []) {
    const d = obj(ds);
    const id = String(obj(d.entity).entityId ?? "");
    if (!id) continue;
    const state: DeviceState = { online: true };
    for (const cs of Array.isArray(d.capabilityStates) ? d.capabilityStates : []) {
      let c: Obj;
      try {
        c = obj(typeof cs === "string" ? JSON.parse(cs) : cs);
      } catch {
        continue;
      }
      if (c.namespace === "Alexa.PowerController" && c.name === "powerState") state.power = c.value === "ON" ? "on" : "off";
      if (c.namespace === "Alexa.BrightnessController" && c.name === "brightness" && typeof c.value === "number") state.brightness = c.value;
      if (c.namespace === "Alexa.EndpointHealth" && c.name === "connectivity") {
        const v = obj(c.value).value ?? c.value;
        if (v !== "OK") state.online = false;
      }
    }
    states.set(id, state);
  }
  for (const e of Array.isArray(res.errors) ? res.errors : []) {
    const id = String(obj(obj(e).entity).entityId ?? "");
    if (id) states.set(id, { online: false });
  }
  return states;
}

/** Throw if a /api/phoenix/state PUT reported errors for any device. */
export function checkControlResponse(response: unknown): void {
  const errors = obj(response).errors;
  if (Array.isArray(errors) && errors.length) {
    const e = obj(errors[0]);
    const code = String(e.code ?? "UNKNOWN");
    const message = e.message ? `: ${String(e.message)}` : "";
    throw new Error(code === "ENDPOINT_UNREACHABLE" ? "The device is not reachable (offline)." : `Amazon refused the request (${code}${message}).`);
  }
}

export function describeControls(controls: DeviceControl[]): string[] {
  return controls.map((c) => (c === "power" ? "turn on/off" : "brightness 0-100%"));
}
