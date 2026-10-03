import os from "node:os";
import path from "node:path";

export const APP_DIR_NAME = ".alexa-echo-mcp";
export const CONFIG_FILE_NAME = "config.json";
/** Login-proxy device identity (deviceId, frc, map-md) kept between sign-ins. Not a credential. */
export const LOGIN_DEVICE_FILE_NAME = "login-device.json";

export const DEFAULT_SERVER_HOST = "0.0.0.0";
export const DEFAULT_SERVER_PORT = 8426;
export const DEFAULT_LOGIN_PORT = 8427;

export interface PathOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}

/** `ALEXA_ECHO_MCP_HOME` is a test/dev override only. */
export function getAppDir(options: PathOptions = {}): string {
  const env = options.env || process.env;
  if (env.ALEXA_ECHO_MCP_HOME && env.ALEXA_ECHO_MCP_HOME.trim()) {
    return path.resolve(env.ALEXA_ECHO_MCP_HOME);
  }
  const homedir = options.homedir || (() => os.homedir());
  return path.join(env.HOME || homedir(), APP_DIR_NAME);
}

export function getConfigPath(options: PathOptions = {}): string {
  return path.join(getAppDir(options), CONFIG_FILE_NAME);
}

export function getLoginDevicePath(options: PathOptions = {}): string {
  return path.join(getAppDir(options), LOGIN_DEVICE_FILE_NAME);
}
