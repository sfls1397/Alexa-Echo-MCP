/**
 * The Amazon session (alexa-cookie2 "registration data": refresh token,
 * cookies, device id) lives only in the macOS Keychain. Never in config, the
 * repo, logs, or tool output.
 *
 * Session bytes are written through stdin with the security utility, never
 * command arguments or logs. Existing Keychain item permissions are retained.
 */
import { execFileSync as defaultExecFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { writeKeychainSecret } from "../keychainWrite.js";

export const SESSION_KEYCHAIN_SERVICE = "alexa-echo-mcp";
export const SESSION_KEYCHAIN_ACCOUNT = "amazon-session";

type Exec = typeof defaultExecFileSync;

/** Shape kept opaque on purpose; alexa-remote2 owns it. `localCookie` marks a complete sign-in. */
export type RegistrationData = Record<string, unknown> & { localCookie?: string };

export function isRegistrationData(value: unknown): value is RegistrationData {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RegistrationData).localCookie === "string" &&
    typeof (value as Record<string, unknown>).refreshToken === "string"
  );
}

export interface SessionStore {
  load(): RegistrationData | null;
  save(data: RegistrationData): void;
  clear(): boolean;
}

// The utility's stdin command buffer is 4096 bytes. Write immutable chunks,
// then switch the root item only after every chunk succeeds.
const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 600;
function manifest(value: string) {
  const match = /^chunked-v1:([a-f0-9]{32}):([1-9][0-9]{0,2}):([a-f0-9]{64})$/.exec(value);
  return match && Number(match[2]) <= MAX_CHUNKS ? { generation: match[1]!, count: Number(match[2]), digest: match[3]! } : null;
}
export function keychainSessionStore(exec: Exec = defaultExecFileSync): SessionStore {
  const read = (account: string) => exec("/usr/bin/security", ["find-generic-password", "-s", SESSION_KEYCHAIN_SERVICE, "-a", account, "-w"], { stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).toString("utf8").trim();
  const remove = (account: string) => {
    try { exec("/usr/bin/security", ["delete-generic-password", "-s", SESSION_KEYCHAIN_SERVICE, "-a", account], { stdio: "ignore", timeout: 15000 }); return true; } catch { return false; }
  };
  const chunkAccount = (generation: string, index: number) => SESSION_KEYCHAIN_ACCOUNT + ":" + generation + ":" + index;
  const clean = (previous: string) => {
    const record = manifest(previous);
    if (record) for (let index = 0; index < record.count; index++) remove(chunkAccount(record.generation, index));
  };
  return {
    load() {
      try {
        let encoded = read(SESSION_KEYCHAIN_ACCOUNT);
        const record = manifest(encoded);
        if (encoded.startsWith("chunked-v1:") && !record) return null;
        if (record) {
          encoded = "";
          for (let index = 0; index < record.count; index++) {
            const chunk = read(chunkAccount(record.generation, index));
            if (!/^[A-Za-z0-9+/=]+$/.test(chunk) || chunk.length > CHUNK_SIZE) return null;
            encoded += chunk;
          }
          if (createHash("sha256").update(encoded).digest("hex") !== record.digest) return null;
        }
        const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
        return isRegistrationData(parsed) ? parsed : null;
      } catch { return null; }
    },
    save(data) {
      const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
      const count = Math.ceil(encoded.length / CHUNK_SIZE);
      if (!count || count > MAX_CHUNKS) throw new Error("Session too large for Keychain storage; credential values omitted.");
      let previous = "";
      try { previous = read(SESSION_KEYCHAIN_ACCOUNT); } catch { /* first sign-in */ }
      const generation = randomUUID().replace(/-/g, "");
      let written = 0;
      try {
        for (let index = 0; index < count; index++) {
          writeKeychainSecret(SESSION_KEYCHAIN_SERVICE, chunkAccount(generation, index), encoded.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), exec);
          written++;
        }
        const digest = createHash("sha256").update(encoded).digest("hex");
        writeKeychainSecret(SESSION_KEYCHAIN_SERVICE, SESSION_KEYCHAIN_ACCOUNT, "chunked-v1:" + generation + ":" + count + ":" + digest, exec);
      } catch {
        for (let index = 0; index < written; index++) remove(chunkAccount(generation, index));
        throw new Error("Keychain session write failed; credential values omitted.");
      }
      clean(previous);
    },
    clear() {
      let previous = "";
      try { previous = read(SESSION_KEYCHAIN_ACCOUNT); } catch { /* already absent */ }
      const removed = remove(SESSION_KEYCHAIN_ACCOUNT);
      if (removed) clean(previous);
      return removed;
    }
  };
}
