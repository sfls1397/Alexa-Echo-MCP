import fs from "node:fs";
import { DEFAULT_LOGIN_PORT, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, getConfigPath } from "./paths.js";

/**
 * Everything specific to one household lives here, in
 * ~/.alexa-echo-mcp/config.json, never in the repo. The Amazon session itself
 * is in the Keychain (see alexa/session.ts), not in this file.
 */
export interface ResolvedConfig {
  configPath: string;
  serverHost: string;
  serverPort: number;
  /** Loopback port for the one-time Amazon sign-in page (`alexa-echo-mcp login`). */
  loginPort: number;
  /** Amazon storefront the account belongs to, e.g. amazon.com, amazon.co.uk, amazon.de. */
  amazonPage: string;
  /** Alexa locale for spoken text and text commands, e.g. en-US. */
  locale: string;
  /**
   * Optional aliases: the name callers use -> the device's name in the Alexa
   * app (or its serial number). Use when your own names for the Echoes differ
   * from the Alexa app's. Names not listed here must match the Alexa app.
   */
  echoes: Record<string, string>;
}

export function resolveConfig(configPath = getConfigPath()): ResolvedConfig {
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    const text = fs.readFileSync(configPath, "utf8");
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${configPath} must hold a JSON object`);
  }
  const str = (key: string, fallback: string): string => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v !== "string" || !v.trim()) throw new Error(`config ${key} must be a non-empty string`);
    return v.trim();
  };
  const port = (key: string, fallback: number): number => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65535) {
      throw new Error(`config ${key} must be an integer from 1 to 65535`);
    }
    return v;
  };
  const echoes: Record<string, string> = {};
  if (raw.echoes !== undefined) {
    if (!raw.echoes || typeof raw.echoes !== "object" || Array.isArray(raw.echoes)) {
      throw new Error("config echoes must be an object of { \"your name\": \"Alexa app name or serial\" }");
    }
    for (const [alias, target] of Object.entries(raw.echoes as Record<string, unknown>)) {
      if (typeof target !== "string" || !target.trim() || !alias.trim()) {
        throw new Error(`config echoes["${alias}"] must map a non-empty name to a non-empty Alexa name or serial`);
      }
      echoes[alias.trim()] = target.trim();
    }
  }
  return {
    configPath,
    serverHost: str("serverHost", DEFAULT_SERVER_HOST),
    serverPort: port("serverPort", DEFAULT_SERVER_PORT),
    loginPort: port("loginPort", DEFAULT_LOGIN_PORT),
    amazonPage: str("amazonPage", "amazon.com"),
    locale: str("locale", "en-US"),
    echoes
  };
}
