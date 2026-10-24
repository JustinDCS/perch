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

export interface ListDisplay {
  layout: "list";
  items: string;
  title: string;
  subtitle?: string;
  limit: number;
}

export interface RestPill {
  perch: 1;
  id: string;
  name: string;
  kind: "rest";
  icon?: string;
  refreshSeconds: number;
  request: RestRequest;
  display: StatDisplay | ListDisplay;
}

export interface NowPlayingPill {
  perch: 1;
  id: string;
  name: string;
  kind: "now-playing";
  icon?: string;
}

export type PillManifest = RestPill | NowPlayingPill;

/** What a pill view needs from the app around it. */
export interface PillHost {
  reportTone(id: string, tone: Tone): void;
  reportMusic(playing: boolean): void;
  /** Ask the user to allow a host; resolves true if they agreed and it was saved. */
  requestHostApproval(host: string): Promise<boolean>;
}

export interface PillView {
  id: string;
  el: HTMLElement;
  start(): void;
  stop(): void;
}
