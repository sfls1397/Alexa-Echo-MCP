import fs from "node:fs";
import type { ResolvedConfig } from "../config.js";
import { getAppDir, getLoginDevicePath } from "../paths.js";
import { baseAlexaOptions, newAlexaRemote, toEchoDevices } from "./client.js";
import { isRegistrationData, type SessionStore } from "./session.js";

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

export interface LoginOptions {
  config: ResolvedConfig;
  store: SessionStore;
  onUrl: (url: string) => void;
  log?: (m: string) => void;
}

export async function runLogin(opts: LoginOptions): Promise<string[]> {
  const log = opts.log || ((m: string) => console.error(m));
  fs.mkdirSync(getAppDir(), { recursive: true, mode: 0o700 });
  const remote = newAlexaRemote();
  const url = `http://127.0.0.1:${opts.config.loginPort}/`;
  let urlShown = false;

  return new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        remote.stop();
      } catch {}
      reject(new Error("Sign-in not finished within 15 minutes. Run login again."));
    }, LOGIN_TIMEOUT_MS);

    remote.init(
      {
        ...baseAlexaOptions(opts.config),
        proxyOnly: true,
        setupProxy: true,
        proxyOwnIp: "127.0.0.1",
        proxyListenBind: "127.0.0.1",
        proxyPort: opts.config.loginPort,
        cookieRefreshInterval: 0
      },
      (err?: Error) => {
        if (err) {
          if (/Please open http/.test(err.message)) {
            if (!urlShown) {
              urlShown = true;
              opts.onUrl(url);
            }
            return;
          }
          clearTimeout(timer);
          reject(new Error(`Amazon sign-in failed: ${err.message}`));
          return;
        }
        clearTimeout(timer);
        const data = remote.cookieData;
        if (!isRegistrationData(data)) {
          reject(new Error("Amazon sign-in finished but returned no usable session."));
          return;
        }
        opts.store.save(data);
        try {
          fs.chmodSync(getLoginDevicePath(), 0o600);
        } catch {}
        const names = toEchoDevices(remote.serialNumbers).map((d) => d.name);
        log("Amazon session saved to the Keychain.");
        try {
          remote.stop();
        } catch {}
        resolve(names);
      }
    );
  });
}
