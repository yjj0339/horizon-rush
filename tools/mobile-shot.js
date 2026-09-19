// 手机宽度触屏验收截图
const puppeteer = require('E:/ZCODE/node_modules/puppeteer-core');
const fs = require('fs');
function findBrowser() {
  for (const c of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('no browser');
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8791/?auto=1&pos=fest&touch=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'E:/ZCODE/horizon-rush/shots/mobile.png' });
  console.log('MOBILE SHOT OK');
  await browser.close();
})();
