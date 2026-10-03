/**
 * Thin promise wrapper over alexa-remote2, which drives Amazon's private
 * Alexa web/app API with the account owner's own session. Amazon publishes no
 * API for this; if Amazon changes that API, these calls break until
 * alexa-remote2 catches up.
 *
 * alexa-remote2's `logger` option prints cookies and tokens, so it is never set.
 */
import { createRequire } from "node:module";
import type { ResolvedConfig } from "../config.js";
import { getLoginDevicePath } from "../paths.js";
import { isRegistrationData, type RegistrationData, type SessionStore } from "./session.js";

const require = createRequire(import.meta.url);

/** Device families that are Echo speakers / Echo Shows (not phones, apps, groups, Fire TV). */
export const ECHO_FAMILIES = new Set(["ECHO", "KNIGHT", "ROOK"]);

export const NOT_SIGNED_IN =
  "Not signed in to Amazon. On the Mini run `alexa-echo-mcp login` and sign in to the Amazon account that owns the Echoes.";

const INIT_TIMEOUT_MS = 90_000;
const COOKIE_REFRESH_MS = 4 * 24 * 60 * 60 * 1000;

export interface EchoDevice {
  /** Name in the Alexa app. */
  name: string;
  serial: string;
  family: string;
  online: boolean;
}

export interface Routine {
  name: string;
  enabled: boolean;
  raw: Record<string, unknown>;
}

/** What the MCP tools need. The real one is AlexaService; tests use a fake. */
export interface AlexaBackend {
  echoes(): Promise<EchoDevice[]>;
  speak(serial: string, text: string): Promise<void>;
  textCommand(serial: string, text: string): Promise<void>;
  routines(): Promise<Routine[]>;
  runRoutine(serial: string, routine: Routine): Promise<void>;
}

type Callback = (err: Error | null | undefined, res?: unknown) => void;

/** The slice of alexa-remote2's AlexaRemote class used here. */
interface AlexaRemoteLike {
  cookieData: unknown;
  serialNumbers: Record<string, Record<string, unknown>>;
  _options?: Record<string, unknown>;
  init(options: Record<string, unknown>, callback: (err?: Error) => void): void;
  on(event: "cookie", listener: () => void): void;
  generateCookie: (email: unknown, password: unknown, callback: Callback) => void;
  createSequenceNode(command: string, value: string, serial: string): Record<string, unknown> | null;
  sendSequenceCommand(serial: string, command: Record<string, unknown>, callback: Callback): void;
  getAutomationRoutines(callback: Callback): void;
  stop(): void;
}

export function newAlexaRemote(): AlexaRemoteLike {
  const AlexaRemote = require("alexa-remote2") as new () => AlexaRemoteLike;
  return new AlexaRemote();
}

/** Options shared by the long-running service and the one-time login. */
export function baseAlexaOptions(config: ResolvedConfig): Record<string, unknown> {
  return {
    amazonPage: config.amazonPage,
    baseAmazonPage: config.amazonPage,
    acceptLanguage: config.locale,
    amazonPageProxyLanguage: config.locale.replace("-", "_"),
    formerDataStorePath: getLoginDevicePath(),
    useWsMqtt: false,
    usePushConnection: false,
    bluetooth: false,
    notifications: false
  };
}

export function toEchoDevices(serialNumbers: Record<string, Record<string, unknown>>): EchoDevice[] {
  const out: EchoDevice[] = [];
  for (const dev of Object.values(serialNumbers || {})) {
    const family = String(dev.deviceFamily ?? "");
    if (!ECHO_FAMILIES.has(family)) continue;
    if (dev.parentDeviceSerialNumber) continue;
    const name = typeof dev.accountName === "string" ? dev.accountName : "";
    const serial = typeof dev.serialNumber === "string" ? dev.serialNumber : "";
    if (!name || !serial) continue;
    out.push({ name, serial, family, online: dev.online === true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Point the routine's "current locale" placeholders at our locale; alexa-remote2 would otherwise default them to de-DE. */
export function localizeRoutine(raw: Record<string, unknown>, locale: string): Record<string, unknown> {
  const json = JSON.stringify(raw).replace(/"locale":"ALEXA_CURRENT_LOCALE"/g, `"locale":${JSON.stringify(locale)}`);
  return JSON.parse(json) as Record<string, unknown>;
}

function promisify<T>(fn: (cb: Callback) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, res) => (err ? reject(err) : resolve(res as T)));
  });
}

function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b401\b|unauthori[sz]ed|no csrf|authentication/i.test(message);
}

export class AlexaService implements AlexaBackend {
  private remote: AlexaRemoteLike | null = null;
  private ready: Promise<AlexaRemoteLike> | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly store: SessionStore,
    private readonly factory: () => AlexaRemoteLike = newAlexaRemote,
    private readonly log: (m: string) => void = (m) => console.error(m)
  ) {}

  /** Connect lazily, so `login` can happen while the server is already running. */
  private connect(): Promise<AlexaRemoteLike> {
    if (this.ready) return this.ready;
    const attempt = this.startRemote();
    this.ready = attempt;
    attempt.catch(() => {
      if (this.ready === attempt) this.ready = null;
    });
    return attempt;
  }

  private startRemote(): Promise<AlexaRemoteLike> {
    const session = this.store.load();
    if (!session) return Promise.reject(new Error(NOT_SIGNED_IN));
    const remote = this.factory();
    // Never fall back to the interactive sign-in proxy from the server.
    remote.generateCookie = (_email, _password, callback) => callback(new Error(NOT_SIGNED_IN));
    remote.on("cookie", () => this.persist(remote));

    return new Promise<AlexaRemoteLike>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          remote.stop();
        } catch {
          /* ignore */
        }
        reject(new Error("Timed out connecting to Amazon's Alexa service."));
      }, INIT_TIMEOUT_MS);
      remote.init(
        {
          ...baseAlexaOptions(this.config),
          cookie: session,
          formerRegistrationData: session,
          macDms: session.macDms,
          cookieRefreshInterval: COOKIE_REFRESH_MS
        },
        (err?: Error) => {
          // init calls back again after each scheduled cookie refresh; only the first one settles.
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) {
            try {
              remote.stop();
            } catch {
              /* ignore */
            }
            const message = err.message.includes(NOT_SIGNED_IN)
              ? `Amazon session no longer works. ${NOT_SIGNED_IN}`
              : `Could not connect to Amazon's Alexa service: ${err.message}`;
            reject(new Error(message));
            return;
          }
          this.persist(remote);
          this.remote = remote;
          this.log(`Connected to Alexa (${toEchoDevices(remote.serialNumbers).length} Echo devices).`);
          resolve(remote);
        }
      );
    });
  }

  private persist(remote: AlexaRemoteLike): void {
    const data = remote.cookieData;
    if (!isRegistrationData(data)) return;
    try {
      this.store.save(data as RegistrationData);
    } catch (err) {
      this.log(`Could not save the refreshed Amazon session to the Keychain: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Drop the connection so the next call reconnects (and refreshes the session). */
  reset(): void {
    if (this.remote) {
      try {
        this.remote.stop();
      } catch {
        /* ignore */
      }
    }
    this.remote = null;
    this.ready = null;
  }

  private async withRemote<T>(fn: (remote: AlexaRemoteLike) => Promise<T>): Promise<T> {
    const remote = await this.connect();
    try {
      return await fn(remote);
    } catch (err) {
      if (isAuthError(err)) this.reset();
      throw err;
    }
  }

  async echoes(): Promise<EchoDevice[]> {
    return this.withRemote(async (remote) => toEchoDevices(remote.serialNumbers));
  }

  private async sendNode(command: "speak" | "textCommand", serial: string, text: string): Promise<void> {
    await this.withRemote(async (remote) => {
      const node = remote.createSequenceNode(command, text, serial);
      if (!node) throw new Error(`alexa-remote2 could not build a ${command} request`);
      const payload = node.operationPayload as Record<string, unknown> | undefined;
      if (payload && "locale" in payload) payload.locale = this.config.locale;
      const sequence = { "@type": "com.amazon.alexa.behaviors.model.Sequence", startNode: node };
      await promisify((cb) => remote.sendSequenceCommand(serial, sequence, cb));
    });
  }

  speak(serial: string, text: string): Promise<void> {
    return this.sendNode("speak", serial, text);
  }

  textCommand(serial: string, text: string): Promise<void> {
    return this.sendNode("textCommand", serial, text);
  }

  async routines(): Promise<Routine[]> {
    return this.withRemote(async (remote) => {
      const list = await promisify<unknown>((cb) => remote.getAutomationRoutines(cb));
      if (!Array.isArray(list)) throw new Error("Amazon returned no routine list");
      const out: Routine[] = [];
      for (const item of list as Record<string, unknown>[]) {
        if (!item || typeof item.name !== "string" || !item.name.trim()) continue;
        out.push({ name: item.name, enabled: item.status === "ENABLED", raw: item });
      }
      return out;
    });
  }

  async runRoutine(serial: string, routine: Routine): Promise<void> {
    await this.withRemote(async (remote) => {
      const localized = localizeRoutine(routine.raw, this.config.locale);
      await promisify((cb) => remote.sendSequenceCommand(serial, localized, cb));
    });
  }
}
