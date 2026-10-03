#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import { AlexaService } from "./alexa/client.js";
import { runLogin } from "./alexa/login.js";
import { keychainSessionStore, SESSION_KEYCHAIN_ACCOUNT, SESSION_KEYCHAIN_SERVICE } from "./alexa/session.js";
import { resolveConfig } from "./config.js";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, loadOrCreateHttpAuthToken, readKeychainSecret } from "./mcp/httpAuth.js";
import { runHttpStdioProxy } from "./mcp/proxy.js";
import { startHttpServer, startStdioServer } from "./mcp/server.js";
import { echoNames } from "./mcp/tools.js";
import { getAppDir } from "./paths.js";
import { packageVersion } from "./version.js";

const COMMANDS = ["serve", "stdio", "login", "logout", "status", "http-token", "http-proxy", "check-config"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): string {
  return `alexa-echo-mcp v${packageVersion()}
  serve         MCP over bearer-token Streamable HTTP (LaunchAgent; default)
  stdio         MCP over stdio (local clients that spawn the server)
  login         sign in to Amazon in a browser on this Mac; saves the session to the Keychain
  logout        delete the saved Amazon session from the Keychain
  status        check the saved session and list the Echo names it can reach
  http-token    print the HTTP bearer token (creates it on first use)
  http-proxy <url>  stdio->HTTP bridge (token in ALEXA_ECHO_MCP_TOKEN)
  check-config  print the resolved settings and exit

Uses the unofficial Alexa app session (alexa-remote2). Amazon has no official
API for this; it can break whenever Amazon changes things.`;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "-h" || arg === "--help" || arg === "help") {
    console.log(usage());
    return;
  }
  if (arg && !(COMMANDS as readonly string[]).includes(arg)) throw new Error(`Unknown command "${arg}"\n\n${usage()}`);
  const command: Command = (arg as Command) || "serve";
  fs.mkdirSync(getAppDir(), { recursive: true, mode: 0o700 });

  if (command === "http-token") {
    console.log(readKeychainSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) ?? loadOrCreateHttpAuthToken().token);
    return;
  }
  if (command === "http-proxy") {
    const url = process.argv[3];
    if (!url) throw new Error("usage: alexa-echo-mcp http-proxy <http://mini-address:8426/mcp>");
    await runHttpStdioProxy(url, process.env.ALEXA_ECHO_MCP_TOKEN);
    return;
  }

  const config = resolveConfig();
  const store = keychainSessionStore();

  if (command === "check-config") {
    console.log(`config: ${config.configPath}${fs.existsSync(config.configPath) ? "" : " (not present; defaults)"}`);
    console.log(`listen: http://${config.serverHost}:${config.serverPort}/mcp`);
    console.log(`login page: http://127.0.0.1:${config.loginPort}/`);
    console.log(`amazon: ${config.amazonPage}, locale ${config.locale}`);
    console.log(`echo aliases: ${Object.keys(config.echoes).length}`);
    console.log(`session: Keychain ${SESSION_KEYCHAIN_SERVICE}/${SESSION_KEYCHAIN_ACCOUNT} ${store.load() ? "present" : "missing"}`);
    return;
  }
  if (command === "logout") {
    console.log(store.clear() ? "Amazon session deleted from the Keychain." : "No saved Amazon session.");
    return;
  }
  if (command === "login") {
    const names = await runLogin({
      config,
      store,
      onUrl: (url) => {
        console.log(`Open ${url} in a browser on this Mac and sign in to the Amazon account that owns the Echoes.`);
        console.log("Use a browser here (not a phone with the Alexa app). Waiting up to 15 minutes...");
        if (!process.env.ALEXA_ECHO_MCP_NO_OPEN) execFile("/usr/bin/open", [url], () => undefined);
      }
    });
    console.log(`Signed in. Echo devices on this account: ${names.length ? names.join(", ") : "(none found)"}`);
    console.log("If the server LaunchAgent is running it picks the session up on the next call.");
    process.exit(0);
  }
  if (command === "status") {
    const alexa = new AlexaService(config, store);
    const echoes = await alexa.echoes();
    console.log(`Connected. Echo names callers can use: ${echoNames(echoes, config.echoes).join(", ") || "(none)"}`);
    for (const e of echoes) console.log(`  ${e.name}  [${e.family}${e.online ? "" : ", offline"}]`);
    process.exit(0);
  }

  const log = (message: string) => console.error(`${new Date().toISOString()} [server] ${message}`);
  const ctx = { alexa: new AlexaService(config, store, undefined, log), aliases: config.echoes };
  if (command === "stdio") {
    await startStdioServer(ctx);
    return;
  }
  const { token } = loadOrCreateHttpAuthToken({ log });
  await startHttpServer({ ctx, host: config.serverHost, port: config.serverPort, token, log });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
