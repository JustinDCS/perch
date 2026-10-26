export type Tone = "neutral" | "good" | "warn" | "danger";

export type AuthSpec =
  | { type: "bearer"; secret: string }
  | { type: "header"; name: string; secret: string }
  | { type: "basic"; user: string; secret: string };

export interface Threshold {
  gte?: number;
  lte?: number;
  equals?: string | number;
  tone: Tone;
}

/** A blank the user fills in (Settings → Pills), used as {var.key} in the request. */
export interface PillVariable {
  key: string;
  label: string;
  placeholder?: string;
  default?: string;
  /** "host" accepts a pasted web address and keeps just the host name */
  type?: "text" | "host";
  /** pills with the same group share one value (two Jira pills, one site name) */
  group?: string;
}

export interface RestRequest {
  url: string;
  method: "GET" | "POST";
  auth?: AuthSpec;
  body?: unknown;
}

export interface StatDisplay {
  layout: "stat";
  value: string;
  label?: string;
  unit?: string;
  thresholds: Threshold[];
}

/** A bar per number, e.g. commits per day. `values` are paths to number arrays, joined in order. */
export interface ChartDisplay {
  layout: "chart";
  values: string[];
  label?: string;
  unit?: string;
  /** small caption next to the total, e.g. "last 14 days" */
  period?: string;
}

export interface ListDisplay {
  layout: "list";
  items: string;
  title: string;
  subtitle?: string;
  /** a template for a web address; the row opens it when clicked */
  link?: string;
  limit: number;
}

export interface ApprovalAction {
  label: string;
  tone: "neutral" | "good" | "danger";
  /** true: ask "are you sure?" first; a string is the question (it may use {path} holes) */
  confirm?: boolean | string;
  /** where to POST when the button is pressed; {path} holes come from the item, {var.x} from settings */
  post: string;
  /** optional JSON body; string values may use the same holes */
  body?: unknown;
}

/** Questions waiting for the user, each with one to three buttons. */
export interface ApprovalsDisplay {
  layout: "approvals";
  items: string;
  title: string;
  detail?: string;
  actions: ApprovalAction[];
  limit: number;
}

export interface RestPill {
  perch: 1;
  id: string;
  name: string;
  kind: "rest";
  icon?: string;
  /** #rrggbb colour for this pill's chip and card */
  accent?: string;
  refreshSeconds: number;
  variables?: PillVariable[];
  request: RestRequest;
  display: StatDisplay | ListDisplay | ApprovalsDisplay | ChartDisplay;
}

export interface NowPlayingPill {
  perch: 1;
  id: string;
  name: string;
  kind: "now-playing";
  icon?: string;
  accent?: string;
}

/** What a pill shows when the island is small: an icon or short label and a value. */
export interface Chip {
  icon?: string;
  text: string;
}

export type PillManifest = RestPill | NowPlayingPill;

/** What a pill view needs from the app around it. */
export interface PillHost {
  reportTone(id: string, tone: Tone): void;
  reportMusic(playing: boolean): void;
  /** How many apps are playing media right now (so the avatar can notice a second one). */
  reportSources(playing: number): void;
  /** Set (or with null, clear) the chip shown for this pill in the small island. */
  reportChip(id: string, chip: Chip | null): void;
  /** The user's values for this pill's variables (defaults filled in; "" when unset). */
  variables(id: string): Record<string, string>;
  /** How many questions this pill has waiting for the user (counted in "N need you"). */
  reportNeeds(id: string, count: number): void;
  /** A new request is waiting: the island should notice (avatar, sound, opens for a moment). */
  reportArrival(id: string): void;
  /** Open the Library so the user can fill in a pill's variables. */
  openSettings(): void;
  /** Ask the user to allow a host; resolves true if they agreed and it was saved. */
  requestHostApproval(host: string): Promise<boolean>;
}

export interface PillView {
  id: string;
  el: HTMLElement;
  start(): void;
  stop(): void;
}
