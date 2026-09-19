// 截图工具：node tools/shot.js [pos...]
const path = require('path');
const fs = require('fs');
const puppeteer = require('E:/ZCODE/node_modules/puppeteer-core');

// 找 Chrome/Edge
function findBrowser() {
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('no browser');
}

(async () => {
  const poses = process.argv.slice(2);
  const list = poses.length ? poses : ['fest', 'city', 'highway', 'coast'];
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--use-angle=default', '--enable-unsafe-webgpu', '--window-size=1280,760'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true });
  for (const pos of list) {
    const q = pos === 'menu' ? '' : `?auto=1&pos=${pos}`;
    await page.goto(`http://localhost:8791/${q}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    } catch (e) {
      console.log(pos, 'TIMEOUT waiting __ready');
    }
    await new Promise(r => setTimeout(r, 800));
    const file = path.join(__dirname, '..', 'shots', `${pos}.png`);
    await page.screenshot({ path: file });
    console.log('SHOT', file);
  }
  await browser.close();
})();
