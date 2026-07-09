---
name: run-controlevendasgold
description: Build, run, screenshot, and drive the Controle360 Multi app (static HTML/JS + Supabase). Use when asked to run, start, launch, test, or screenshot this app, verify a UI/UX change, or check the mobile bottom-nav / admin vs vendedor views without touching production data.
---

Controle360 Multi is a dependency-free static web app (`index.html` +
`src/*.js`, no build step) backed by a hardcoded **production** Supabase
project (`src/api.js` — `SUPABASE_URL`/`SUPABASE_ANON_KEY`). There is no
local/staging backend and no test account credentials in this repo, so the
driver here **mocks every Supabase request** (REST + Auth) instead of
hitting the real project — this lets an agent log in as admin or vendedor
and see a fully rendered app without a password and without risking real
data.

Drive it with the Playwright REPL at
`.claude/skills/run-controlevendasgold/driver.mjs`. All paths below are
relative to the repo root.

## Prerequisites

Nothing to install — this container already has a global Playwright with
Chromium at `/opt/node22/lib/node_modules/playwright`. The driver resolves
it explicitly (bare `import 'playwright'` does not follow `NODE_PATH` under
ESM — see Gotchas). No `npm install` needed; this repo has no
`package.json` on purpose (see `CLAUDE.md` — "Preferir JavaScript puro").

## Build

None. It's static files. If you changed anything under `src/`,
`styles/main.css`, or `index.html`, regenerate the single-file mobile
build per `CLAUDE.md`:

```bash
node build-mobile.js
```

## Run (agent path)

```bash
tmux new-session -d -s c360 -x 200 -y 50
tmux send-keys -t c360 'node .claude/skills/run-controlevendasgold/driver.mjs' Enter
timeout 15 bash -c 'until tmux capture-pane -t c360 -p | grep -q "driver>"; do sleep 0.3; done'

tmux send-keys -t c360 'launch' Enter
timeout 20 bash -c 'until tmux capture-pane -t c360 -p | grep -q "login form ready"; do sleep 0.3; done'

tmux send-keys -t c360 'login admin' Enter     # or: login vendedor
timeout 15 bash -c 'until tmux capture-pane -t c360 -p | grep -Eq "login OK|TIMEOUT"; do sleep 0.3; done'

tmux send-keys -t c360 'ss hoje' Enter
timeout 10 bash -c 'until tmux capture-pane -t c360 -p | grep -q "screenshot:"; do sleep 0.3; done'
tmux capture-pane -t c360 -p
```

Screenshots land in `/tmp/shots/` (override with `SCREENSHOT_DIR`). Always
open the PNG and actually look at it — a blank page or a stuck spinner
looks identical to success in the terminal log.

**Wait for the prompt between commands.** Sending `launch` before the
`node …driver.mjs` process has attached its readline listener drops the
line into the outer shell instead (observed: `launch` → `-bash: launch:
command not found`, and `login vendedor` got eaten by the real `/bin/login`
binary, which then hangs on a `Password:` prompt — `Ctrl-C` to escape it).

### Commands

| command | what it does |
|---|---|
| `launch` | start the static file server (port 8934) + headless Chromium, navigate to the login screen |
| `mock admin \| mock vendedor` | pick which fixture profile the *next* login returns |
| `login [admin\|vendedor]` | fill + submit the login form, wait for `#appShell` |
| `ss [name]` | full-page screenshot → `/tmp/shots/<name>.png` |
| `tab <tabId>` | jump straight to a tab via `window.C360.app.setTab(tabId)` — see `TAB_ORDER` in `src/app.js` for valid ids (`hoje`, `vendedores`, `meuestoque`, `devolucoes`, `aprovacoes`, …) |
| `click <css-sel>` / `click-text <text>` | click via DOM (`el.click()`), not coordinates |
| `type <text>` / `press <key>` | keyboard input |
| `resize <WxH>` | change viewport, e.g. `resize 390x844` for a phone-sized layout (nav switches to bottom-nav under 720px wide) |
| `wait <css-sel>` | wait up to 10s for a selector |
| `eval <js>` | evaluate JS in the page, print JSON |
| `text [css-sel]` | print `innerText` |
| `quit` | close browser + stop the file server |

## Run (human path)

Open `index.html` directly in a browser (desktop) or
`controle360-mobile.html` (self-contained mobile build) — both talk to the
**real** production Supabase project, so this requires a real login. Not
useful headless.

## Gotchas

- **`confirm()` dialogs silently no-op without a listener.** Playwright
  auto-*dismisses* unhandled `alert`/`confirm`/`prompt` dialogs. The "Sair"
  button (and several delete actions) are gated behind
  `if (!confirm('Sair da sua conta?')) return;` (`src/app.js:1873`) — a
  bare `click-text Sair` looked like it worked (the click resolved
  instantly) but the app never actually logged out. The driver registers
  `page.on('dialog', d => d.accept())` at launch specifically for this.
- **ESM does not honor `NODE_PATH`.** `import 'playwright'` fails even with
  `NODE_PATH=/opt/node22/lib/node_modules` set, because Node's ESM resolver
  ignores it (only the CJS resolver reads `NODE_PATH`). The driver imports
  the global install by absolute path
  (`/opt/node22/lib/node_modules/playwright/index.mjs`) instead, with a
  bare-specifier fallback in case a real `node_modules/playwright` ever
  gets installed in the repo.
- **The app is 100% REST, no RPC/view surprises.** Every `C360.api.list*`
  call resolves to a plain `GET /rest/v1/<table>`, including the
  goals/carts/ledger helpers — so a single catch-all
  `page.route('https://<project>.supabase.co/**', …)` that returns `[]` for
  any unrecognized `/rest/v1/*` table (plus real fixture rows for
  `profiles` and `businesses`) is enough to render every screen with empty
  state. No per-table mock maintenance needed as new tables get added,
  *unless* a screen needs non-empty data to look right (then add a
  table-specific branch next to the `profiles`/`businesses` ones in
  `installMocks()`).
- **The floating calculator button (`.calc-fab`, "R$") overlaps content on
  mobile.** Reproduced live at 390×844: it sits on top of the "Meus
  pedidos" quick-action button on the seller "Hoje" screen, and on top of
  "Metas" inside the "Mais" sheet (see `/tmp/shots/05-*.png` and
  `06-mais-menu.png` from a driver run). `styles/main.css` already has a
  mobile-only bottom offset for the bottom-nav case, but it doesn't account
  for content scrolling underneath or for the "Mais" sheet's own z-index —
  worth revisiting if asked to fix the "overlapping / hard to close UI on
  mobile" complaint.

## Troubleshooting

- **`page.fill` timeout waiting for `#authRoot form input[type="email"]`
  after `login`:** you're not actually on the login screen — either
  `launch` didn't finish, or a previous `confirm()`-gated logout silently
  failed (see Gotchas). Run `ss` and look at the PNG before retrying.
- **Command typed into `-bash` instead of `driver>`:** the driver process
  wasn't ready yet. Always poll `tmux capture-pane … | grep -q "driver>"`
  (or the relevant "done" marker) before sending the next `send-keys`, per
  the Run section above.
- **Port 8934 already in use:** a previous driver run didn't `quit`
  cleanly. `pkill -f run-controlevendasgold/driver.mjs`, or set
  `C360_PORT` to a different port.
