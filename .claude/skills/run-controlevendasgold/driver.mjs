// REPL driver for Controle360 Multi (static HTML/JS + Supabase backend).
// Run on headless Linux, no xvfb needed (Playwright launches Chromium
// headless directly — this is a static web app, not Electron).
//
// Serves the repo root over HTTP, launches Chromium, and MOCKS every
// request to the (hardcoded, production) Supabase domain so the app can
// be driven without real credentials and without touching production
// data. See "mock" command to switch role between admin/vendedor.
//
// Designed for agents: wrap in tmux, send-keys commands, capture-pane
// output. See SKILL.md in this directory for the full command reference.
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

// playwright is a *global* npm install in this container, not a repo
// dependency (this is a dependency-free static app — see CLAUDE.md).
// Bare `import 'playwright'` does not resolve via NODE_PATH under ESM,
// so resolve the global install path explicitly with a local fallback.
async function loadChromium() {
  const candidates = [
    'playwright', // repo-local install, if one ever exists
    '/opt/node22/lib/node_modules/playwright/index.mjs', // this container's global install
  ];
  for (const spec of candidates) {
    try { return (await import(spec)).chromium; } catch { /* try next */ }
  }
  throw new Error('playwright not found — see SKILL.md Prerequisites');
}
const chromium = await loadChromium();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../../..'); // repo root
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PORT = Number(process.env.C360_PORT || 8934);
const SUPABASE_ORIGIN = 'https://zcwnfrhtlhjfprsjktlx.supabase.co';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

let server = null;
let browser = null;
let page = null;

// ---------------------------------------------------------------------
// Static file server for the repo root (index.html + src/*.js + styles/).
// ---------------------------------------------------------------------
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(APP_DIR, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

// ---------------------------------------------------------------------
// Mock Supabase backend. Fixtures per role — swap with `mock <role>`.
// ---------------------------------------------------------------------
const FIXTURES = {
  admin: { uid: '11111111-1111-1111-1111-111111111111', email: 'admin@demo.local', role: 'admin' },
  vendedor: { uid: '22222222-2222-2222-2222-222222222222', email: 'vendedor@demo.local', role: 'vendedor' },
};
const BUSINESS_ID = '99999999-9999-9999-9999-999999999999';
let currentFixture = FIXTURES.admin;

function json(route, body, status = 200) {
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(pg) {
  await pg.route(`${SUPABASE_ORIGIN}/**`, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();

    if (p === '/auth/v1/token') {
      return json(route, {
        access_token: 'fake-access-token', refresh_token: 'fake-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: currentFixture.uid, email: currentFixture.email },
      });
    }
    if (p === '/auth/v1/user') {
      return json(route, { id: currentFixture.uid, email: currentFixture.email });
    }
    if (p === '/auth/v1/logout') return json(route, {}, 204);

    if (p === '/rest/v1/profiles') {
      return json(route, [{
        id: currentFixture.uid, role: currentFixture.role, name: currentFixture.role === 'admin' ? 'Admin Demo' : 'Vendedor Demo',
        business_id: BUSINESS_ID, active: true,
      }]);
    }
    if (p === '/rest/v1/businesses') {
      return json(route, [{
        id: BUSINESS_ID, name: 'Negócio Demo', segment: 'geral',
        default_margin_percent: 50, default_tax_percent: 5, created_at: new Date().toISOString(),
      }]);
    }
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null);
    if (p.startsWith('/rest/v1/')) return json(route, []); // every other table: empty, still renders
    if (p.startsWith('/functions/v1/')) return json(route, {});

    return json(route, {}, 404);
  });
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------
const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched');
    await startServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('  [console error]', msg.text()); });
    // Playwright auto-DISMISSES confirm()/alert() with no listener — this app
    // gates "Sair" (and several deletes) behind confirm(), which would
    // otherwise silently no-op every time. Accept everything.
    page.on('dialog', (d) => d.accept());
    await installMocks(page);
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#authRoot form', { timeout: 10_000 });
    console.log('launched. server on port', PORT, '— login form ready.');
  },

  // mock <admin|vendedor> — pick which profile the next login returns.
  async mock(role) {
    const r = (role || '').trim();
    if (!FIXTURES[r]) return console.log('usage: mock admin | mock vendedor. current:', currentFixture.role);
    currentFixture = FIXTURES[r];
    console.log('mock role set to', r, '— now run `login` (or reload) to apply.');
  },

  // login [role] — fills and submits the login form (any password: mocked).
  async login(role) {
    if (!page) return console.log('ERROR: launch first');
    if (role) await COMMANDS.mock(role);
    await page.fill('#authRoot form input[type="email"]', currentFixture.email);
    await page.fill('#authRoot form input[type="password"]', 'anything123');
    await page.click('#authRoot form button[type="submit"]');
    try {
      await page.waitForSelector('#appShell:not([hidden])', { timeout: 10_000 });
      console.log('login OK, role:', currentFixture.role);
    } catch {
      console.log('TIMEOUT waiting for #appShell — check `ss` and `console`');
    }
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f, fullPage: true });
    console.log('screenshot:', f);
  },

  // tab <tabId> — jump straight to a C360 tab (see src/app.js TAB_ORDER),
  // e.g. `tab hoje`, `tab vendedores`, `tab meuestoque`.
  async tab(id) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((tabId) => {
      if (!window.C360 || typeof window.C360.app?.setTab !== 'function') return 'NO_setTab_EXPORT';
      window.C360.app.setTab(tabId);
      return 'OK';
    }, id);
    console.log('tab', id, '→', r);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  async type(text) { if (page) await page.keyboard.type(text, { delay: 20 }); },
  async press(key) { if (page) await page.keyboard.press(key); },

  async resize(spec) {
    if (!page) return console.log('ERROR: launch first');
    const [w, h] = (spec || '1280x900').split('x').map(Number);
    await page.setViewportSize({ width: w, height: h });
    console.log('viewport ->', w, h);
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async console() { console.log('(errors print live as they happen; nothing buffered)'); },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
    browser = null; page = null; server = null;
  },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });

console.log('controlevendasgold driver — "help" for commands, "launch" to start');
rl.prompt();
