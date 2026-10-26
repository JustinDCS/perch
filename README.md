# Perch

A small always-on-top desktop companion for Windows. It sits at the top of your screen with an
avatar and a stack of **pills**: little cards that show what you want to glance at, like the song
that is playing or a number from one of your APIs.

Pills and avatars are **user-defined**. They are small JSON files, not code, so one person can have
a now-playing pill and a ticket counter, and someone else a different avatar and a different API.

> Tracked in Jira as **DD-107** (research: DD-98).

## Status: MVP scaffold

What is in this first slice:

| Piece | State |
|---|---|
| Transparent, always-on-top overlay window with tray icon | written, **verified on Windows 11** (overlay, tray build, window sizing) |
| **Now-playing pill** (Windows media session: Spotify, Apple Music, browsers…) with title, artist, artwork, previous / play-pause / next, progress and seek | **verified on Windows 11 with Spotify** (metadata, artwork, play/pause, previous/next, progress) |
| **REST/JSON pill** driven by a manifest (poll an API, map fields, colour by thresholds, secrets from Credential Manager, host approval) | **verified on Windows 11** with the public GitHub API (host approval, polling, stat layout); auth headers and secrets not yet tried live |
| **Avatar** (Perch's own amber default, or an uploaded file) reacting to idle / music / attention / asleep | working in a browser; not yet seen on Windows |
| Settings: toggle pills, set secrets, review approved hosts, import avatars | working (tested in a browser) |

Verified so far, on Linux and in a headless browser: the safety rules in Rust (`cargo test -p perch-core`),
all manifest / avatar / path validation (`npm test`), the type-check, the production build, and the UI
flows (approval prompt, thresholds driving the avatar, avatar import) against a built-in mock.

**Not yet verified:** seek dragging, Apple Music / browser sources, REST pills with a secret, the list layout, and the tray menu items.

## Run it

Prerequisites on Windows 10/11: [Node 20+](https://nodejs.org), [Rust](https://rustup.rs) with the
MSVC build tools, and the WebView2 runtime (already on Windows 11).

```powershell
npm install
npm run tauri dev      # the overlay, with hot reload
npm run tauri build    # installers in target\release\bundle\
```

Preview just the UI in any browser, with fake media and API data (no Windows needed):

```powershell
npm run dev            # then open http://localhost:1420
```

Tests:

```powershell
npm test               # validators, paths, tones, every file in examples/
npm run test:core      # Rust safety rules
npm run typecheck
```

## Your config folder

Right-click the tray icon → **Open config folder** (it is `%APPDATA%\co.za.dyncomp.perch`):

```
pips\       one JSON file per pill
avatars\    one JSON file per avatar (or import one from Settings)
approved-hosts.json   hosts you have allowed (managed by Perch)
```

Copy anything from [`examples/`](examples) to get started. `examples/pips/tauri-stars.json` needs no secret.
Files with mistakes never crash Perch: they are listed with the exact problems under **Settings → Files with problems**.

## The island

Perch hangs from the top edge of your screen like a notch, with the avatar perched on its lower lip:

* **Hidden**: when nothing is happening it shrinks to a sliver with two eyes peeking out (switch this off in the Library).
* **Small**: while music plays or a pill needs attention it shows one chip per pill (♪ track, ★ value, count).
* **Home**: rest the pointer on it for about a second (a ring fills beside the pointer; Library → Behaviour changes the wait) or click the avatar to keep it open. Brushing past it does nothing, so it will not cover things at the top of your screen. A pill that turns red opens it by itself, and it stays open until you have been over it and left.
* **Moving it**: drag the avatar. The island slides along the top edge of whichever screen the pointer is on, and remembers where you dropped it. Library → Behaviour → *Centre on this screen* resets it.
* A line along the lip takes the worst tone: green, amber or coral.

Each pill file may set an `"accent": "#rrggbb"` colour for its chip and card.

## Life

The scripted poses sit under a small "alive" layer (`src/avatar/life.ts`): the eyes follow the pointer anywhere on screen while the island is open (Library → Behaviour: always or never) and wander when nobody is there, the body breathes, blinks are irregular (the odd double or slow one), and each loop runs on a slightly varying clock so it never repeats in lockstep. It ignores the pointer while asleep and is switched off by the system's reduced-motion setting.

**Dancing.** While music plays it bounces and sways with a tempo that drifts, and every 7 to 16 seconds it moves to a different dance (the built-in avatar has bounce, sway, cheer and laugh; an imported avatar uses whichever of `happy`, `excited`, `playful`, `celebrate` and `laughing` it defines).

**Reactions.** It responds to things: it hops when music starts or the track changes (and glances at the card), is startled when you grab it and squashes when you drop it, and leans back with wide eyes just before an alert opens. While the island is hidden it occasionally slides out, looks left and right, winks and slides back (Library → Behaviour switches this off).

## Pill manifest

```json
{
  "perch": 1,
  "id": "jira-open-tickets",
  "name": "Open tickets",
  "kind": "rest",
  "icon": "🎫",
  "refreshSeconds": 120,
  "request": {
    "url": "https://your-site.atlassian.net/rest/api/3/search/approximate-count",
    "method": "POST",
    "auth": { "type": "basic", "user": "you@example.com", "secret": "jira-token" },
    "body": { "jql": "project = DD AND statusCategory != Done" }
  },
  "display": {
    "layout": "stat",
    "value": "count",
    "label": "Not done",
    "thresholds": [
      { "gte": 25, "tone": "danger" },
      { "gte": 10, "tone": "warn" },
      { "lte": 9, "tone": "good" }
    ]
  }
}
```

* `kind`: `"rest"` or `"now-playing"` (the built-in now-playing pill is always available; it needs no file).
* `request.auth`: `bearer`, `header` (with a header `name`) or `basic` (with a `user`). The `secret` is only
  the **name** of an entry in Windows Credential Manager. Set its value in **Settings → Secrets**. Never put a token in a manifest.
* `request.method`: `GET` (default) or `POST` (`body` is only allowed with `POST`). `refreshSeconds`: 5 to 86400, default 60.
* `display.layout: "stat"`: `value` (path), optional `label`, `unit`, and `thresholds`. The first matching rule wins; each rule has
  `gte` / `lte` / `equals` and a `tone` of `neutral`, `good`, `warn` or `danger`.
* `display.layout: "list"`: `items` (path to an array), `title` and optional `subtitle` (paths inside each item), `limit` (1 to 20).
* Paths use names, dots and `[0]` indexes, e.g. `fields.summary` or `issues[0].key`. `.length` works on arrays.

A pill whose tone is `danger` makes the avatar switch to its **attention** state.

## Avatar format

An avatar is a body shape, eyes and a mouth, plus how they look in each state. See
[`examples/avatars/blob.json`](examples/avatars/blob.json). `idle` is required; `attention` and `music` default to `idle`.

* `body.shape`: `squircle`, `circle` or `pill`. Colours are `#rrggbb` only.
* Per state: `eyeOpen` (0 to 1.4), `eyeOffsetX/Y`, `mouth` (-1 frown to 1 smile), optional `bodyColor`,
  `animation` (`none`, `breathe`, `bounce`, `wiggle`, `pulse`) and `speed`.

### Avatars from Bible Strong Avatar Lab

Perch also reads the `.avatar.json` files exported by [Bible Strong Avatar Lab](https://github.com/smontlouis/bible-strong-avatar-lab)
(schema `bible-strong/avatar-definition`, version 1). Make an avatar in their Studio, open its **Export** tab, and import
the `.avatar.json` from **Settings → Avatar → Import avatar JSON**. Perch plays one of the avatar's own animations for
each state:

| Perch state | Animations tried, in order |
|---|---|
| idle | `idle`, `listening`, `bored` |
| music | `happy`, `excited`, `playful`, `celebrate`, `laughing` |
| attention | `surprised`, `scared`, `curious`, `angry` |
| asleep (after 10 quiet minutes) | `sleeping`, `drowsy`, `bored` |

If none exist, the avatar's first animation is used. Perch's own default avatar is written in this same format, so it can be used as a starting point. Perch draws a flat 2D version of the face (the Studio draws a lit 3D
shape), so it will look close to, not identical to, the Studio preview. Reduced-motion settings in Windows show a still face.

This is a **file format reader only**. The checks (`src/avatar/bibleStrong/schema.ts`) and the player are Perch's own
code; no code from the Studio or its `@bible-strong/*` packages is used, which is what keeps Perch's licence a free choice.

## Security model

User files are data, never code. Several layers keep it that way:

* **Strict validation.** Every pill and avatar file is checked against a schema. Unknown fields, bad ranges and
  non-`#rrggbb` colours are rejected with a clear message.
* **No markup from files.** The avatar is built with DOM calls and API text is set with `textContent`. Nothing user- or
  server-supplied is ever turned into HTML or SVG markup.
* **Requests are made in Rust**, not in the web view, so API keys never enter the page. Responses are capped at 1 MB with a 10 s timeout, and redirects are not followed.
* **Secrets** live in Windows Credential Manager. The page can save and delete one, but no command reads one back.
* **Host approval.** A pill cannot contact a host until you approve it in a prompt; you can revoke it in Settings.
  Plain `http` is only allowed for `localhost` and private-network addresses, and link-local addresses (including cloud metadata
  endpoints) are always refused.
* **Files** are only read from and saved to the two config folders, with sanitised names and a 256 KB limit.

This is a defence against a careless or malicious *file*. It is not a sandbox against malicious *code*: anything that can
already run code as you does not need Perch.

## Layout

```
src/                 TypeScript UI (no framework)
  pills/             manifest validation, now-playing and REST pills
  avatar/            schema, built-in avatar, SVG renderer
  ui/                app shell, settings, dialogs
  ipc.ts             the only bridge to Rust (plus a browser mock for development)
src-tauri/           Tauri shell: media (Windows), net, secrets, files
crates/perch-core/   platform-independent safety rules, unit-tested anywhere
examples/            sample pills and avatars (all validated by the test suite)
```

## Not in the MVP

* Obsidian pill (note create via `obsidian://` / vault files, note search)
* Shuffle, repeat, volume and "add to library" controls
* Button actions on pills (re-run, redeploy) with confirmation
* Avatar configurator, extra avatar parts
* Agent approvals from the overlay (hook to socket), as in Coucou
* Signed installer and auto-update for non-developer users

## Licence

Not chosen yet; it will be decided before the repository goes public. Perch contains **no code from**
`bible-strong-avatar-lab` (AGPL-3.0): the avatar format and renderer here are original.
