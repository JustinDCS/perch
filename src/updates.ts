// Self-updating. The real work is done by Tauri's updater plugin, which only exists in release builds
// made with src-tauri/tauri.updater.conf.json. Everywhere else (dev, a browser, a local build) the
// calls fail and we say so instead of showing an error.

import { inTauri } from "./ipc";

export interface UpdateResult {
  state: "unsupported" | "current" | "available" | "installed" | "error";
  text: string;
  version?: string;
}

/** Turn a failure into a friendly result. Pure, so it can be tested. */
export function describeFailure(err: unknown): UpdateResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/not found|not allowed|no such plugin|plugin .*not/i.test(message)) {
    return { state: "unsupported", text: "This build has no update support (a developer or local build)." };
  }
  return { state: "error", text: `Could not check for updates: ${message.slice(0, 160)}` };
}

export async function currentVersion(): Promise<string> {
  if (!inTauri) return "dev";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "unknown";
  }
}

/** Look for a newer version. With `install` it downloads, installs and restarts Perch. */
export async function checkForUpdate(install: boolean): Promise<UpdateResult> {
  if (!inTauri) return { state: "unsupported", text: "Updates only work in the installed app." };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { state: "current", text: "You are on the latest version." };
    if (!install) return { state: "available", version: update.version, text: `Version ${update.version} is available.` };
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return { state: "installed", version: update.version, text: `Installed ${update.version}. Restarting…` };
  } catch (err) {
    return describeFailure(err);
  }
}
