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
  /** every app with a media session */
  sources: { id: string; playing: boolean }[];
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
  /** `source` is an app id to look at instead of the one Windows considers current. */
  mediaState(source?: string): Promise<MediaState>;
  mediaThumbnail(source?: string): Promise<string | null>;
  mediaControl(action: MediaAction, positionMs?: number, source?: string): Promise<void>;
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
  /** Open a web address in the default browser. Only for hosts the user has approved. */
  openUrl(url: string): Promise<void>;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const real: Ipc = {
  mediaState: (source) => invoke<MediaState>("media_get_state", { source }),
  mediaThumbnail: (source) => invoke<string | null>("media_get_thumbnail", { source }),
  mediaControl: (action, positionMs, source) => invoke("media_control", { action, positionMs, source }),
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
  openUrl: (url) => invoke("open_url", { url }),
};

// ---- browser mock (development only) -------------------------------------------------------

function createMock(): Ipc {
  const approved = new Set<string>();
  const secrets = new Set<string>();
  const files: Record<FileKind, UserFile[]> = {
    pips: [
      {
        name: "demo-assigned.json",
        content: JSON.stringify({
          perch: 1,
          id: "demo-assigned",
          name: "Assigned to me",
          kind: "rest",
          icon: "🎫",
          accent: "#a9c4ff",
          refreshSeconds: 60,
          request: { url: "https://mock.example.test/issues" },
          display: {
            layout: "list",
            items: "issues",
            title: "{key} {fields.summary}",
            subtitle: "{fields.status.name}",
            link: "https://mock.example.test/browse/{key}",
            limit: 5,
          },
        }),
      },
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

  // two pretend apps; add ?mock2 to the address to have the second one playing as well
  const mockApps = {
    "Spotify.exe": { title: typeof location !== "undefined" && location.search.includes("longtitle") ? "ALORS ON DANSE (HARDTEKK) - SUPER SLOWED + REVERB (Extended Club Mix, Remastered 2026)" : "PPAPTEKK - Super Slowed", artist: "DIPIENS, HRXSTAL", durationMs: 111_000, playing: true, positionMs: 23_000 },
    "chrome.exe": { title: "lofi hip hop radio", artist: "Lofi Girl", durationMs: 3_600_000, playing: typeof location !== "undefined" && location.search.includes("mock2"), positionMs: 600_000 },
  };
  type MockId = keyof typeof mockApps;
  const pick = (source?: string): MockId => (source && source in mockApps ? (source as MockId) : "Spotify.exe");
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    for (const app of Object.values(mockApps)) if (app.playing) app.positionMs = Math.min(app.durationMs, app.positionMs + (now - last));
    last = now;
  };

  return {
    async mediaState(source) {
      tick();
      const id = pick(source);
      const app = mockApps[id];
      return {
        available: true,
        app: id,
        title: app.title,
        artist: app.artist,
        album: "",
        playing: app.playing,
        positionMs: app.positionMs,
        durationMs: app.durationMs,
        canPlayPause: true,
        canNext: true,
        canPrevious: true,
        canSeek: true,
        trackKey: `mock|${app.title}`,
        sources: Object.entries(mockApps).map(([name, a]) => ({ id: name, playing: a.playing })),
      };
    },
    async mediaThumbnail() {
      return null;
    },
    async mediaControl(action, ms, source) {
      tick();
      const app = mockApps[pick(source)];
      if (action === "playPause") app.playing = !app.playing;
      if (action === "seek" && ms !== undefined) app.positionMs = ms;
      if (action === "next" || action === "previous") app.positionMs = 0;
    },
    async fetchJson(req) {
      const host = new URL(req.url).host;
      if (!approved.has(host)) throw `HOST_NOT_APPROVED:${host}`;
      if (req.auth && !secrets.has(req.auth.secret)) throw `SECRET_MISSING:${req.auth.secret}`;
      return {
        count: 3 + Math.floor((Date.now() / 5000) % 9),
        items: [],
        issues: [
          { key: "DD-107", fields: { summary: "Perch companion app", status: { name: "In Progress" } } },
          { key: "DD-91", fields: { summary: "Invoice export for JAE", status: { name: "To Do" } } },
          { key: "DD-88", fields: { summary: "Review the SEO scan results page", status: { name: "In Review" } } },
        ],
      };
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
    async openUrl(url) {
      const host = new URL(url).host;
      if (!approved.has(host)) throw `HOST_NOT_APPROVED:${host}`;
      (window as unknown as { __lastOpened?: string }).__lastOpened = url;
    },
  };
}

export const ipc: Ipc = inTauri ? real : createMock();

/** Rust errors arrive as plain strings. */
export function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
