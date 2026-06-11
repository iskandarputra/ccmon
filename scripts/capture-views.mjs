/**
 * @file capture-views.mjs
 * @brief Dev utility — screenshots every view of a running ccmon instance.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

// Dev utility: drives the running Electron app over CDP (port 9222) and
// captures a PNG of every view into /tmp/ccmon-shots/. Used for design review.
import WebSocket from 'ws';
import fs from 'fs';

const OUT = '/tmp/ccmon-shots';
const VIEWS = [
  ['1', 'overview'],
  ['2', 'activity'],
  ['3', 'insights'],
  ['4', 'spatial'],
  ['5', 'sessions'],
  ['6', 'blocks'],
  ['7', 'models'],
  ['8', 'projects'],
  ['9', 'settings'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
if (!page) {
  console.error('no app page target found; targets:', targets.map((t) => `${t.type} ${t.url}`));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

let nextId = 1;
const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');

// the window may be occluded — compositor animations freeze mid-flight and
// staggered panels would screenshot at opacity 0. Capture final states.
await send('Runtime.evaluate', {
  expression: `(() => {
    const s = document.createElement('style');
    s.textContent = '* { animation: none !important; transition: none !important; }';
    document.head.appendChild(s);
  })()`,
});

// wait until the snapshot has rendered (a stat value shows up)
for (let i = 0; i < 40; i++) {
  const { result } = await send('Runtime.evaluate', {
    expression: `!!document.querySelector('.stat-value')?.textContent`,
    returnByValue: true,
  });
  if (result.value) break;
  await sleep(500);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [key, name] of VIEWS) {
  // occluded windows stop compositing — raise the window so frames are fresh
  await send('Page.bringToFront');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`,
  });
  await sleep(name === 'spatial' ? 5000 : 1300); // lazy three.js chunk needs longer
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`captured ${name}`);
}

ws.close();
console.log(`done → ${OUT}`);
