/**
 * The Amazon session (alexa-cookie2 "registration data": refresh token,
 * cookies, device id) lives only in the macOS Keychain. Never in config, the
 * repo, logs, or tool output.
 *
 * `security -i` (stdin) truncates lines near 4 KB and the session is larger,
 * so the value goes on `security`'s argv, the same way the sibling MCPs write
 * their tokens. Any process that can see that argv could already read the
 * item with /usr/bin/security.
 */
import { execFileSync as defaultExecFileSync } from "node:child_process";

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

export function keychainSessionStore(exec: Exec = defaultExecFileSync): SessionStore {
  return {
    load() {
      let out: string;
      try {
        out = exec(
          "/usr/bin/security",
          ["find-generic-password", "-s", SESSION_KEYCHAIN_SERVICE, "-a", SESSION_KEYCHAIN_ACCOUNT, "-w"],
          { stdio: ["ignore", "pipe", "ignore"] }
        )
          .toString("utf8")
          .trim();
      } catch {
        return null;
      }
      try {
        const parsed = JSON.parse(Buffer.from(out, "base64").toString("utf8")) as unknown;
        return isRegistrationData(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save(data) {
      const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
      exec(
        "/usr/bin/security",
        ["add-generic-password", "-U", "-s", SESSION_KEYCHAIN_SERVICE, "-a", SESSION_KEYCHAIN_ACCOUNT, "-w", encoded],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
    },
    clear() {
      try {
        exec(
          "/usr/bin/security",
          ["delete-generic-password", "-s", SESSION_KEYCHAIN_SERVICE, "-a", SESSION_KEYCHAIN_ACCOUNT],
          { stdio: ["ignore", "ignore", "ignore"] }
        );
        return true;
      } catch {
        return false;
      }
    }
  };
}
