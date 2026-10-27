// The only place the web view talks to Rust. When the page is opened in a normal browser
// (`npm run dev` without Tauri) a small mock is used so the UI can still be developed.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

export interface InboxStatus {
  enabled: boolean;
  port: number | null;
  key: string;
}

/** A question from a program on this PC (see the README, "Local inbox"). */
export interface InboxAsk {
  id: number;
  title: string;
  detail: string | null;
  buttons: string[];
  source: string | null;
}

export interface InboxHandlers {
  ask(ask: InboxAsk): void;
  cancel(id: number): void;
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
  inboxStatus(): Promise<InboxStatus>;
  inboxSetEnabled(enabled: boolean): Promise<InboxStatus>;
  inboxRegenerateKey(): Promise<InboxStatus>;
  /** The button label the user pressed, or null if they dismissed the question. */
  inboxAnswer(id: number, answer: string | null): Promise<void>;
  /** Start hearing questions; returns a function that stops. */
  onInbox(handlers: InboxHandlers): () => void;
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
  inboxStatus: () => invoke<InboxStatus>("inbox_status"),
  inboxSetEnabled: (enabled) => invoke<InboxStatus>("inbox_set_enabled", { enabled }),
  inboxRegenerateKey: () => invoke<InboxStatus>("inbox_regenerate_key"),
  inboxAnswer: (id, answer) => invoke("inbox_answer", { id, answer }),
  onInbox(handlers) {
    const stops = [
      listen<InboxAsk>("inbox-ask", (event) => handlers.ask(event.payload)),
      listen<number>("inbox-cancel", (event) => handlers.cancel(event.payload)),
    ];
    return () => stops.forEach((stop) => void stop.then((fn) => fn()));
  },
};

// ---- browser mock (development only) -------------------------------------------------------

function createMock(): Ipc {
  const approved = new Set<string>(typeof location !== "undefined" && location.search.includes("approved") ? ["mock.example.test"] : []);
  const secrets = new Set<string>();
  let inbox: InboxStatus = { enabled: false, port: null, key: "0123456789abcdef0123456789abcdef0123456789abcdef" };
  let pending = [
    { id: "dep-41", title: "Deploy my-site to production?", summary: "main · 3 commits since v1.4 · tests passed" },
    { id: "inv-2041", title: "Approve invoice INV-2041?", summary: "Example client · R 12 480.00 · due 31 Oct" },
  ];
  let failedOnce = false;
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
          variables: [{ key: "site", label: "Jira site", type: "host", placeholder: "your-site.atlassian.net", group: "jira" }],
          request: { url: "https://{var.site}/issues" },
          display: {
            layout: "list",
            items: "issues",
            title: "{key} {fields.summary}",
            subtitle: "{fields.status.name}",
            link: "https://{var.site}/browse/{key}",
            limit: 5,
          },
        }),
      },
      {
        name: "demo-gate.json",
        content: JSON.stringify({
          perch: 1,
          id: "demo-gate",
          name: "Deploy gate",
          kind: "rest",
          icon: "🚦",
          accent: "#f2b866",
          refreshSeconds: 20,
          request: { url: "https://mock.example.test/pending" },
          display: {
            layout: "approvals",
            items: "requests",
            title: "{title}",
            detail: "{summary}",
            actions: [
              { label: "Reject", post: "https://mock.example.test/requests/{id}/reject" },
              { label: "Approve", tone: "good", confirm: "This goes live. Deploy now?", post: "https://mock.example.test/requests/{id}/approve" },
            ],
          },
        }),
      },
      {
        name: "demo-commits.json",
        content: JSON.stringify({
          perch: 1,
          id: "demo-commits",
          name: "Commits",
          kind: "rest",
          refreshSeconds: 300,
          request: { url: "https://mock.example.test/repos/x/y/stats/commit_activity" },
          display: { layout: "chart", values: ["[50].days", "[51].days"], unit: "commits", period: "last 14 days", label: "Demo repo (sample data)" },
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
    "Spotify.exe": { title: typeof location !== "undefined" && location.search.includes("longtitle") ? "ALORS ON DANSE (HARDTEKK) - SUPER SLOWED + REVERB (Extended Club Mix, Remastered 2026)" : "PPAPTEKK - Super Slowed", artist: "DIPIENS, HRXSTAL", durationMs: 111_000, playing: !(typeof location !== "undefined" && location.search.includes("quiet")), positionMs: 23_000 },
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
      const path = new URL(req.url).pathname;
      if (path.endsWith("/pending")) return { requests: pending };
      if (path.endsWith("/stats/commit_activity")) {
        const daily = [4, 7, 5, 6, 0, 2, 9, 8, 11, 7, 10, 3, 4, 9];
        const weeks = Array.from({ length: 52 }, () => ({ days: [1, 2, 1, 3, 2, 0, 0] }));
        weeks[50] = { days: daily.slice(0, 7) };
        weeks[51] = { days: daily.slice(7) };
        return weeks;
      }
      const answer = /\/requests\/([^/]+)\/(approve|reject)$/.exec(path);
      if (answer) {
        // the first approve fails once so the failed card can be seen
        if (answer[2] === "approve" && !failedOnce) {
          failedOnce = true;
          throw "HTTP 403";
        }
        pending = pending.filter((r) => r.id !== decodeURIComponent(answer[1]!));
        return null;
      }
      return {
        count: 3 + Math.floor((Date.now() / 5000) % 9),
        items: [],
        issues: [
          { key: "DD-107", fields: { summary: "Perch companion app", status: { name: "In Progress" } } },
          { key: "DD-91", fields: { summary: "Invoice export fix", status: { name: "To Do" } } },
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
    async inboxStatus() {
      return { ...inbox };
    },
    async inboxSetEnabled(enabled) {
      inbox = { ...inbox, enabled, port: enabled ? 47600 : null };
      return { ...inbox };
    },
    async inboxRegenerateKey() {
      inbox = { ...inbox, key: Math.random().toString(16).slice(2).padEnd(48, "0") };
      return { ...inbox };
    },
    async inboxAnswer(id, answer) {
      const w = window as unknown as { __inboxAnswers?: [number, string | null][] };
      (w.__inboxAnswers ??= []).push([id, answer]);
    },
    onInbox(handlers) {
      // the browser mock: call window.__inboxAsk({ id, title, buttons, ... }) from the console
      const w = window as unknown as { __inboxAsk?: (a: InboxAsk) => void; __inboxCancel?: (id: number) => void };
      w.__inboxAsk = (ask) => handlers.ask(ask);
      w.__inboxCancel = (id) => handlers.cancel(id);
      return () => {
        delete w.__inboxAsk;
        delete w.__inboxCancel;
      };
    },
  };
}

export const ipc: Ipc = inTauri ? real : createMock();

/** Rust errors arrive as plain strings. */
export function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
