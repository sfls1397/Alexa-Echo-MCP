import type { AlexaBackend, EchoDevice, Routine } from "../alexa/client.js";
import { describeControls, type SmartDevice } from "../alexa/devices.js";
import { summarizeRoutine, type DeviceNames } from "../alexa/routines.js";

export const TOOL_SPEAK = "alexa_speak";
export const TOOL_RUN_ROUTINE = "alexa_run_routine";
export const TOOL_TEXT_COMMAND = "alexa_text_command";
export const TOOL_LIST_ROUTINES = "alexa_list_routines";
export const TOOL_LIST_DEVICES = "alexa_list_devices";
export const TOOL_CONTROL_DEVICE = "alexa_control_device";

const DEVICE_ACTIONS = ["turn_on", "turn_off", "set_brightness"] as const;
type DeviceAction = (typeof DEVICE_ACTIONS)[number];

const NO_REPLY =
  "The Echo's spoken reply (if any) does not come back here; this only confirms Amazon accepted the request.";
const SPEAK_MAX = 250;
const COMMAND_MAX = 250;

export interface ToolContext {
  alexa: AlexaBackend;
  /** Optional aliases from config: caller's name -> Alexa app name or serial. */
  aliases: Record<string, string>;
  /** Wait before reading a device's state back after a change (tests set 0). */
  settleMs?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The names offered to callers: every alias, plus the Alexa app name of any
 * Echo no alias points at. (resolveEcho still accepts an aliased Echo's
 * Alexa app name.)
 */
export function echoNames(echoes: EchoDevice[], aliases: Record<string, string>): string[] {
  const names = new Set<string>(Object.keys(aliases));
  const targets = new Set(Object.values(aliases).map((t) => t.toLowerCase()));
  for (const e of echoes) {
    if (!targets.has(e.name.toLowerCase()) && !targets.has(e.serial.toLowerCase())) names.add(e.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve a caller's Echo name. Only names that already exist are accepted:
 * a configured alias, or an Echo's exact name in the Alexa app (case-insensitive).
 */
export function resolveEcho(name: string, echoes: EchoDevice[], aliases: Record<string, string>): EchoDevice {
  const wanted = name.trim();
  const lower = wanted.toLowerCase();
  const aliasKey = Object.keys(aliases).find((k) => k.toLowerCase() === lower);
  if (aliasKey) {
    const target = aliases[aliasKey];
    const t = target.toLowerCase();
    const hit = echoes.find((e) => e.serial === target || e.name.toLowerCase() === t);
    if (!hit) {
      throw new Error(
        `"${aliasKey}" is set up to mean "${target}", but no Echo with that Alexa name or serial is on this Amazon account.`
      );
    }
    return hit;
  }
  const hit = echoes.find((e) => e.name.toLowerCase() === lower);
  if (hit) return hit;
  const valid = echoNames(echoes, aliases);
  throw new Error(`No Echo named "${wanted}". Use one of: ${valid.length ? valid.join(", ") : "(no Echo devices found)"}.`);
}

export function findRoutine(name: string, routines: Routine[]): Routine {
  const exact = routines.filter((r) => r.name === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`More than one Alexa routine is named exactly "${name}". Rename one in the Alexa app.`);
  const near = routines.filter((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase()).map((r) => `"${r.name}"`);
  const hint = near.length ? ` Did you mean ${near.join(" or ")}? Names must match exactly.` : "";
  throw new Error(`No Alexa routine named exactly "${name}".${hint} Use ${TOOL_LIST_ROUTINES} to see every routine and what it does.`);
}

export function resolveDevice(name: string, devices: SmartDevice[]): SmartDevice {
  const wanted = name.trim().toLowerCase();
  const hit = devices.find((d) => d.name.toLowerCase() === wanted);
  if (hit) return hit;
  throw new Error(
    `No controllable device named "${name.trim()}". Use ${TOOL_LIST_DEVICES} to see the online devices and what they do, then use one of those exact names.`
  );
}

async function deviceNames(ctx: ToolContext): Promise<DeviceNames> {
  try {
    return new Map((await ctx.alexa.devices()).filter((d) => d.entityId).map((d) => [d.entityId, d.name]));
  } catch {
    return new Map();
  }
}

function echoProperty(names: string[]): Record<string, unknown> {
  const prop: Record<string, unknown> = {
    type: "string",
    description: "Which Echo, by its existing name. Do not make up names."
  };
  if (names.length) prop.enum = names;
  return prop;
}

/** Tool list. When signed in, the `echo` argument lists the real Echo names. */
export async function toolDefinitions(ctx: ToolContext): Promise<ToolDefinition[]> {
  let deviceNameList: string[] = [];
  try {
    deviceNameList = (await ctx.alexa.devices()).map((d) => d.name);
  } catch {
    deviceNameList = [];
  }
  const deviceProp: Record<string, unknown> = {
    type: "string",
    description: `The device's exact name from ${TOOL_LIST_DEVICES}. Do not make up names.`
  };
  if (deviceNameList.length) deviceProp.enum = deviceNameList;
  let names: string[] = [];
  try {
    names = echoNames(await ctx.alexa.echoes(), ctx.aliases);
  } catch {
    names = Object.keys(ctx.aliases).sort((a, b) => a.localeCompare(b));
  }
  const echo = echoProperty(names);
  return [
    {
      name: TOOL_SPEAK,
      description: `Make a named Echo say a message out loud (text-to-speech, up to ${SPEAK_MAX} characters). ${NO_REPLY}`,
      inputSchema: {
        type: "object",
        properties: {
          echo,
          message: { type: "string", description: "What the Echo should say.", minLength: 1, maxLength: SPEAK_MAX }
        },
        required: ["echo", "message"],
        additionalProperties: false
      }
    },
    {
      name: TOOL_LIST_ROUTINES,
      description: `List every enabled Alexa routine with its voice phrases, other triggers, and what each step does, in plain words. Read-only: runs nothing. Use it when the user describes what they want instead of saying a routine's exact name ("make it dark for bed", "shut the garage"): pick the routine whose steps do that, by meaning, then call ${TOOL_RUN_ROUTINE} with its exact name. If more than one could fit, or none clearly does, ask the user.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: TOOL_RUN_ROUTINE,
      description: `Run an existing, enabled Alexa routine by its exact name (as shown in the Alexa app), on a named Echo. Disabled routines are refused. Steps that say "the device you speak to" use that Echo. ${NO_REPLY}`,
      inputSchema: {
        type: "object",
        properties: {
          routine: { type: "string", description: "The routine's exact name in the Alexa app.", minLength: 1 },
          echo
        },
        required: ["routine", "echo"],
        additionalProperties: false
      }
    },
    {
      name: TOOL_TEXT_COMMAND,
      description: `Send a command to a named Echo as if it had been spoken to it, without the wake word, e.g. "turn off the kitchen light" or "play jazz". ${NO_REPLY}`,
      inputSchema: {
        type: "object",
        properties: {
          echo,
          command: {
            type: "string",
            description: "What to say to Alexa, without the wake word.",
            minLength: 1,
            maxLength: COMMAND_MAX
          }
        },
        required: ["echo", "command"],
        additionalProperties: false
      }
    },
    {
      name: TOOL_LIST_DEVICES,
      description: `List the smart-home devices (lights, plugs, TV, ...) that are online right now: each one's type, what it can do, and its current state (on/off, brightness). Read-only. Offline and disabled devices are left out. Use it when the user describes a device instead of naming it exactly ("the coffee thing", "lamps by my desk"): pick by meaning, then call ${TOOL_CONTROL_DEVICE} with the exact name. If more than one could fit, ask.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: TOOL_CONTROL_DEVICE,
      description: `Turn an online smart-home device on or off, or set a light's brightness (0-100%). Use the exact device name from ${TOOL_LIST_DEVICES}. Refuses offline devices and controls the device doesn't have. Returns the device's state afterwards. For several devices, call once per device.`,
      inputSchema: {
        type: "object",
        properties: {
          device: deviceProp,
          action: { type: "string", enum: [...DEVICE_ACTIONS], description: "turn_on, turn_off, or set_brightness." },
          brightness: { type: "integer", minimum: 0, maximum: 100, description: "Percent, for set_brightness only." }
        },
        required: ["device", "action"],
        additionalProperties: false
      }
    }
  ];
}

function requireString(args: Record<string, unknown>, key: string, max?: number): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`"${key}" is required`);
  const s = v.trim().replace(/\s+/g, " ");
  if (max && s.length > max) throw new Error(`"${key}" is ${s.length} characters; the limit is ${max}`);
  return s;
}

/** Strip a leading wake word so "Alexa, turn off the light" works too. */
export function stripWakeWord(command: string): string {
  return command.replace(/^\s*(alexa|echo|computer|amazon|ziggy)\s*[,.!:]?\s+/i, "").trim();
}

export async function callTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case TOOL_SPEAK: {
      const echoName = requireString(args, "echo");
      const message = requireString(args, "message", SPEAK_MAX);
      const echo = resolveEcho(echoName, await ctx.alexa.echoes(), ctx.aliases);
      await ctx.alexa.speak(echo.serial, message);
      return JSON.stringify({ ok: true, echo: echoName, alexaName: echo.name, spoke: message, note: NO_REPLY });
    }
    case TOOL_RUN_ROUTINE: {
      const routineName = typeof args.routine === "string" ? args.routine : "";
      if (!routineName.trim()) throw new Error('"routine" is required');
      const echoName = requireString(args, "echo");
      const echo = resolveEcho(echoName, await ctx.alexa.echoes(), ctx.aliases);
      const routine = findRoutine(routineName, await ctx.alexa.routines());
      if (!routine.enabled) {
        throw new Error(`"${routine.name}" is turned off in the Alexa app, so it won't be run. Turn it on there first if you want to use it.`);
      }
      await ctx.alexa.runRoutine(echo.serial, routine);
      return JSON.stringify({ ok: true, routine: routine.name, echo: echoName, alexaName: echo.name, note: NO_REPLY });
    }
    case TOOL_TEXT_COMMAND: {
      const echoName = requireString(args, "echo");
      const command = stripWakeWord(requireString(args, "command", COMMAND_MAX));
      if (!command) throw new Error('"command" is empty after removing the wake word');
      const echo = resolveEcho(echoName, await ctx.alexa.echoes(), ctx.aliases);
      await ctx.alexa.textCommand(echo.serial, command);
      return JSON.stringify({ ok: true, echo: echoName, alexaName: echo.name, command, note: NO_REPLY });
    }
    case TOOL_LIST_ROUTINES: {
      // Disabled routines are left out: they aren't offered and can't be run.
      const names = await deviceNames(ctx);
      const routines = (await ctx.alexa.routines())
        .filter((r) => r.enabled)
        .map((r) => summarizeRoutine(r, names))
        .map(({ enabled: _enabled, ...rest }) => rest)
        .sort((a, b) => a.name.localeCompare(b.name));
      return JSON.stringify({ routines });
    }
    case TOOL_LIST_DEVICES: {
      const devices = await ctx.alexa.devices();
      const states = await ctx.alexa.deviceStates(devices.map((d) => d.applianceId));
      const online = devices
        .filter((d) => states.get(d.applianceId)?.online)
        .map((d) => {
          const { online: _online, ...state } = states.get(d.applianceId) as NonNullable<ReturnType<typeof states.get>>;
          return { name: d.name, type: d.type, can: describeControls(d.controls), state };
        });
      return JSON.stringify({ devices: online });
    }
    case TOOL_CONTROL_DEVICE: {
      const deviceName = requireString(args, "device");
      const action = args.action as DeviceAction;
      if (!DEVICE_ACTIONS.includes(action)) throw new Error(`"action" must be one of ${DEVICE_ACTIONS.join(", ")}`);
      const device = resolveDevice(deviceName, await ctx.alexa.devices());
      let parameters: Record<string, unknown>;
      if (action === "set_brightness") {
        const b = args.brightness;
        if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 100) throw new Error('"brightness" must be a whole number from 0 to 100');
        if (!device.controls.includes("brightness")) throw new Error(`"${device.name}" (${device.type}) has no brightness control; it can: ${describeControls(device.controls).join(", ")}.`);
        parameters = { action: "setBrightness", brightness: b };
      } else {
        if (!device.controls.includes("power")) throw new Error(`"${device.name}" can't be turned on or off; it can: ${describeControls(device.controls).join(", ")}.`);
        parameters = { action: action === "turn_on" ? "turnOn" : "turnOff" };
      }
      const before = (await ctx.alexa.deviceStates([device.applianceId])).get(device.applianceId);
      if (!before?.online) throw new Error(`"${device.name}" is offline right now, so it can't be controlled.`);
      await ctx.alexa.controlDevice(device.applianceId, parameters);
      await new Promise((r) => setTimeout(r, ctx.settleMs ?? 1500));
      const after = (await ctx.alexa.deviceStates([device.applianceId])).get(device.applianceId);
      const { online: _o, ...state } = after ?? { online: false };
      return JSON.stringify({ ok: true, device: device.name, action, ...(action === "set_brightness" ? { brightness: args.brightness } : {}), stateAfter: state });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
