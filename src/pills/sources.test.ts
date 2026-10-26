import { describe, expect, it } from "vitest";
import { badge, nextSource, ordered, playingCount, validChoice } from "./sources";

const spotify = { id: "Spotify.exe", playing: true };
const chrome = { id: "chrome.exe", playing: true };
const vlc = { id: "vlc.exe", playing: false };

describe("ordered", () => {
  it("sorts by id regardless of input order", () => {
    expect(ordered([vlc, spotify, chrome]).map((s) => s.id)).toEqual(["chrome.exe", "Spotify.exe", "vlc.exe"]);
  });
});

describe("validChoice", () => {
  it("keeps a choice that is still playing", () => {
    expect(validChoice("chrome.exe", [spotify, chrome], true)).toBe("chrome.exe");
  });
  it("drops a choice that has gone away", () => {
    expect(validChoice("chrome.exe", [spotify], true)).toBeNull();
    expect(validChoice("chrome.exe", [spotify], false)).toBeNull();
  });
  it("drops a choice that was playing and has paused while something else plays", () => {
    expect(validChoice("vlc.exe", [spotify, vlc], true)).toBeNull();
  });
  it("keeps a paused app the user just switched to on purpose", () => {
    expect(validChoice("vlc.exe", [spotify, vlc], false)).toBe("vlc.exe");
  });
  it("keeps a paused choice when nothing at all is playing", () => {
    expect(validChoice("vlc.exe", [{ ...spotify, playing: false }, vlc], true)).toBe("vlc.exe");
  });
  it("is null with no choice", () => {
    expect(validChoice(null, [spotify], true)).toBeNull();
  });
});

describe("nextSource", () => {
  it("cycles and wraps", () => {
    const all = [spotify, chrome, vlc];
    expect(nextSource(all, "chrome.exe")).toBe("Spotify.exe");
    expect(nextSource(all, "Spotify.exe")).toBe("vlc.exe");
    expect(nextSource(all, "vlc.exe")).toBe("chrome.exe");
  });
  it("has nowhere to go with one source", () => {
    expect(nextSource([spotify], "Spotify.exe")).toBeUndefined();
    expect(nextSource([], "x")).toBeUndefined();
  });
  it("moves to a sensible source if the current one is not in the list", () => {
    expect(nextSource([spotify, chrome], "gone.exe")).toBe("chrome.exe");
  });
});

describe("badge", () => {
  it("is hidden with a single source", () => {
    expect(badge([spotify], "Spotify.exe")).toBeNull();
  });
  it("counts the others that are playing", () => {
    expect(badge([spotify, chrome, vlc], "Spotify.exe")).toEqual({ text: "+1 playing", busy: true });
    expect(badge([spotify, chrome, { ...vlc, playing: true }], "Spotify.exe")).toEqual({ text: "+2 playing", busy: true });
  });
  it("just says how many sources there are when the others are paused", () => {
    expect(badge([spotify, vlc], "Spotify.exe")).toEqual({ text: "2 sources", busy: false });
  });
});

describe("playingCount", () => {
  it("counts playing sources", () => {
    expect(playingCount([spotify, chrome, vlc])).toBe(2);
  });
});
