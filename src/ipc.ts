// The only place the web view talks to Rust. When the page is opened in a normal browser
// (`npm run dev` without Tauri) a small mock is used so the UI can still be developed.

import { invoke } from "@tauri-apps/api/core";
import type { AuthSpec } from "./pills/types";

export interface MediaState {
  available: boolean;
  app: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  trackKey: string;
}

export type MediaAction = "playPause" | "next" | "previous" | "seek";
export type FileKind = "pips" | "avatars";

export interface FetchRequest {
  url: string;
  method?: "GET" | "POST";
  auth?: AuthSpec;
  body?: unknown;
}

export interface UserFile {
  name: string;
  content: string;
}

export interface Ipc {
  mediaState(): Promise<MediaState>;
  mediaThumbnail(): Promise<string | null>;
  mediaControl(action: MediaAction, positionMs?: number): Promise<void>;
  fetchJson(req: FetchRequest): Promise<unknown>;
  approvedHosts(): Promise<string[]>;
  approveHost(host: string): Promise<void>;
  revokeHost(host: string): Promise<void>;
  secretSet(name: string, value: string): Promise<void>;
  secretExists(name: string): Promise<boolean>;
  secretDelete(name: string): Promise<void>;
  listUserFiles(kind: FileKind): Promise<UserFile[]>;
  saveUserFile(kind: FileKind, name: string, content: string): Promise<string>;
  openConfigDir(): Promise<void>;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const real: Ipc = {
  mediaState: () => invoke<MediaState>("media_get_state"),
  mediaThumbnail: () => invoke<string | null>("media_get_thumbnail"),
  mediaControl: (action, positionMs) => invoke("media_control", { action, positionMs }),
  fetchJson: (req) => invoke("fetch_json", { req }),
  approvedHosts: () => invoke<string[]>("approved_hosts"),
  approveHost: (host) => invoke("approve_host", { host }),
  revokeHost: (host) => invoke("revoke_host", { host }),
  secretSet: (name, value) => invoke("secret_set", { name, value }),
  secretExists: (name) => invoke<boolean>("secret_exists", { name }),
  secretDelete: (name) => invoke("secret_delete", { name }),
  listUserFiles: (kind) => invoke<UserFile[]>("list_user_files", { kind }),
  saveUserFile: (kind, name, content) => invoke<string>("save_user_file", { kind, name, content }),
  openConfigDir: () => invoke("open_config_dir"),
};

// ---- browser mock (development only) -------------------------------------------------------

function createMock(): Ipc {
  const approved = new Set<string>();
  const secrets = new Set<string>();
  const files: Record<FileKind, UserFile[]> = {
    pips: [
      {
        name: "demo-open-tickets.json",
        content: JSON.stringify({
          perch: 1,
          id: "demo-open-tickets",
          name: "Open tickets",
          kind: "rest",
          refreshSeconds: 30,
          request: { url: "https://mock.example.test/tickets" },
          display: {
            layout: "stat",
            value: "count",
            label: "Open tickets (demo data)",
            thresholds: [
              { gte: 10, tone: "danger" },
              { gte: 5, tone: "warn" },
            ],
          },
        }),
      },
    ],
    avatars: [],
  };

  const track = { title: "PPAPTEKK - Super Slowed", artist: "DIPIENS, HRXSTAL", durationMs: 111_000 };
  let playing = true;
  let positionMs = 23_000;
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    if (playing) positionMs = Math.min(track.durationMs, positionMs + (now - last));
    last = now;
  };

  return {
    async mediaState() {
      tick();
      return {
        available: true,
        app: "Spotify.exe",
        title: track.title,
        artist: track.artist,
        album: "",
        playing,
        positionMs,
        durationMs: track.durationMs,
        canPlayPause: true,
        canNext: true,
        canPrevious: true,
        canSeek: true,
        trackKey: `mock|${track.title}`,
      };
    },
    async mediaThumbnail() {
      return null;
    },
    async mediaControl(action, ms) {
      tick();
      if (action === "playPause") playing = !playing;
      if (action === "seek" && ms !== undefined) positionMs = ms;
      if (action === "next" || action === "previous") positionMs = 0;
    },
    async fetchJson(req) {
      const host = new URL(req.url).host;
      if (!approved.has(host)) throw `HOST_NOT_APPROVED:${host}`;
      if (req.auth && !secrets.has(req.auth.secret)) throw `SECRET_MISSING:${req.auth.secret}`;
      return { count: 3 + Math.floor((Date.now() / 5000) % 9), items: [] };
    },
    async approvedHosts() {
      return [...approved];
    },
    async approveHost(host) {
      approved.add(host);
    },
    async revokeHost(host) {
      approved.delete(host);
    },
    async secretSet(name) {
      secrets.add(name);
    },
    async secretExists(name) {
      return secrets.has(name);
    },
    async secretDelete(name) {
      secrets.delete(name);
    },
    async listUserFiles(kind) {
      return files[kind];
    },
    async saveUserFile(kind, name, content) {
      const file = name.endsWith(".json") ? name : `${name}.json`;
      files[kind] = files[kind].filter((f) => f.name !== file).concat({ name: file, content });
      return file;
    },
    async openConfigDir() {
      // nothing to open in a browser
    },
  };
}

export const ipc: Ipc = inTauri ? real : createMock();

/** Rust errors arrive as plain strings. */
export function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
