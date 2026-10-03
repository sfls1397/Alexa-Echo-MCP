/**
 * Plain-language summaries of the user's Alexa routines (voice phrases,
 * triggers, steps) so the calling model can pick the routine that does what
 * the user asked, by meaning, when they don't use its exact name. No matching
 * logic lives here on purpose.
 */
import type { Routine } from "./client.js";

export interface RoutineSummary {
  name: string;
  enabled: boolean;
  /** Phrases that trigger it by voice in the Alexa app. */
  voicePhrases: string[];
  /** Non-voice triggers, e.g. "home mode: AWAY", "location". */
  otherTriggers: string[];
  /** What it does, one line per step. */
  steps: string[];
}

type Node = Record<string, unknown>;

function asNode(v: unknown): Node | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : null;
}

function describeSmartHome(payload: Node): string {
  const target = typeof payload.target === "string" ? payload.target : "";
  const filter = asNode(payload.filter);
  const kind = (/@([A-Z_]+)@/.exec(target)?.[1] || (typeof filter?.deviceType === "string" ? filter.deviceType : "") || "device")
    .toLowerCase()
    .replace(/_/g, " ");
  const count = Array.isArray(filter?.includeList) ? filter.includeList.length : 0;
  const what = count ? `${kind}s (${count})` : target.startsWith("virtual@") ? `all ${kind}s` : `${kind}`;
  const ops = (Array.isArray(payload.operations) ? payload.operations : [])
    .map((o) => {
      const op = asNode(o);
      if (!op) return "";
      const type = String(op.type ?? "");
      if (type === "turnOn") return "turn on";
      if (type === "turnOff") return "turn off";
      if (type === "setBrightness" && op.brightness !== undefined) return `brightness ${op.brightness}%`;
      if (type === "setColor" && op.colorName) return `color ${op.colorName}`;
      return type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    })
    .filter(Boolean);
  return `Smart home: ${what}: ${ops.join(", ") || "change"}`;
}

function describeStep(node: Node): string | null {
  const type = typeof node.type === "string" ? node.type : "";
  const payload = asNode(node.operationPayload) || {};
  const text = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  switch (type) {
    case "Alexa.SmartHome.Batch":
      return describeSmartHome(payload);
    case "Alexa.TextCommand":
    case "Alexa.LLM.CustomTextCommand":
      return `Tells Alexa: "${text("text")}"`;
    case "Alexa.Speak":
      return `Alexa says: "${text("textToSpeak")}"`;
    case "AlexaAnnouncement":
      return "Announcement";
    case "Alexa.System.Wait":
      return `Waits ${payload.waitTimeInSeconds ?? "?"}s`;
    case "DoNothing":
      return "Does nothing";
    default:
      return type ? type.replace(/^Alexa\./, "") : null;
  }
}

function collectSteps(node: unknown, out: string[]): void {
  const n = asNode(node);
  if (!n) {
    if (Array.isArray(node)) node.forEach((c) => collectSteps(c, out));
    return;
  }
  if (n.operationPayload !== undefined && typeof n.type === "string") {
    const d = describeStep(n);
    if (d) out.push(d);
    return;
  }
  if (n.startNode) collectSteps(n.startNode, out);
  if (n.nodesToExecute) collectSteps(n.nodesToExecute, out);
}

export function summarizeRoutine(routine: Routine): RoutineSummary {
  const voicePhrases: string[] = [];
  const otherTriggers: string[] = [];
  for (const t of Array.isArray(routine.raw.triggers) ? routine.raw.triggers : []) {
    const trig = asNode(t);
    if (!trig) continue;
    const payload = asNode(trig.payload) || {};
    const type = String(trig.type ?? "");
    if (type === "CustomUtterance") {
      const list = Array.isArray(payload.utterances) ? payload.utterances : [payload.utterance];
      for (const u of list) if (typeof u === "string" && u.trim() && !voicePhrases.includes(u.trim())) voicePhrases.push(u.trim());
    } else if (type.includes("HomeModes")) {
      otherTriggers.push(`home mode: ${payload.state ?? "?"}`);
    } else if (/geofence/i.test(type)) {
      otherTriggers.push("location");
    } else if (/schedule|time/i.test(type)) {
      otherTriggers.push("schedule");
    } else if (type) {
      otherTriggers.push(type.replace(/^Alexa\.Trigger\./, ""));
    }
  }
  const steps: string[] = [];
  collectSteps(routine.raw.sequence, steps);
  return { name: routine.name, enabled: routine.enabled, voicePhrases, otherTriggers, steps };
}
