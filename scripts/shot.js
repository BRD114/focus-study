/**
 * shot.js — 用 Chrome DevTools Protocol 打开页面、执行脚本、截图
 * 仅用于开发期自查（不参与 App 运行）
 *
 * 用法： node scripts/shot.js <url> <out.png> [js表达式]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9300 + Math.floor(Math.random() * 500);
const url = process.argv[2];
const out = process.argv[3];
const expr = process.argv[4] || '';
const W = parseInt(process.env.SHOT_W || '390', 10);
const H = parseInt(process.env.SHOT_H || '844', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEndpoint(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* not ready */ }
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

function makeClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method) {
        handlers.forEach((h) => h(msg));
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => {
      resolve({
        send(method, params) {
          id += 1;
          const mid = id;
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        on(fn) { handlers.push(fn); },
        close() { ws.close(); }
      });
    });
  });
}

(async () => {
  const profile = path.join(os.tmpdir(), 'focus-cdp-' + Date.now());
  const proc = spawn(EDGE, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    await waitEndpoint();
    // 找到 blank 页面 target
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('没有可用页面 target');

    const cli = await makeClient(page.webSocketDebuggerUrl);

    await cli.send('Page.enable');
    await cli.send('Runtime.enable');
    await cli.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 2, mobile: true
    });
    await cli.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    let loaded = false;
    cli.on((m) => { if (m.method === 'Page.loadEventFired') loaded = true; });

    await cli.send('Page.navigate', { url });
    for (let i = 0; i < 60 && !loaded; i++) await sleep(100);
    await sleep(900);

    let result = null;
    if (expr) {
      const r = await cli.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      result = r.result && r.result.value;
      if (r.exceptionDetails) result = 'ERROR: ' + JSON.stringify(r.exceptionDetails.text);
      await sleep(500);
    }

    const shot = await cli.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

    if (result !== null && result !== undefined) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    console.log('✓ ' + out);
    cli.close();
  } catch (e) {
    console.error('✗ ' + e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    setTimeout(() => process.exit(), 300);
  }
})();
