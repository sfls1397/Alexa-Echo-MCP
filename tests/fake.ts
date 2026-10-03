import type { AlexaBackend, EchoDevice, Routine } from "../src/alexa/client.js";

// Placeholder devices only; real names live in the user's local config.
export const ECHOES: EchoDevice[] = [
  { name: "Den Echo", serial: "SERIAL-A", family: "ECHO", online: true },
  { name: "Porch Echo", serial: "SERIAL-B", family: "KNIGHT", online: true }
];
export const ALIASES = { "Echo - Den": "Den Echo" };

export function fakeAlexa(routines: Routine[] = []) {
  const calls: string[] = [];
  const backend: AlexaBackend = {
    echoes: async () => ECHOES,
    speak: async (serial, text) => void calls.push(`speak ${serial} ${text}`),
    textCommand: async (serial, text) => void calls.push(`command ${serial} ${text}`),
    routines: async () => routines,
    runRoutine: async (serial, routine) => void calls.push(`routine ${serial} ${routine.name}`)
  };
  return { backend, calls };
}

