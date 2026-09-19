// 驾驶冒烟测试：加速、漂移、飞跃、氮气（本地开发辅助脚本，非线上代码）
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: 'new',
    args: ['--use-angle=default', '--window-size=1280,760'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8791/?auto=1&pos=highway', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  await sleep(400);

  // 1) 直线加速 4 秒
  await page.keyboard.down('KeyW');
  await sleep(4000);
  let s = await page.evaluate('window.__game.speed');
  console.log('ACCEL 4s ->', s.toFixed(1), 'km/h', s > 80 ? 'PASS' : 'FAIL');
  await page.screenshot({ path: 'E:/ZCODE/horizon-rush/shots/drive-speed.png' });

  // 2) 高速转向 + 手刹漂移 2 秒
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  await sleep(2000);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  const drift = await page.evaluate('window.__game.drifting');
  s = await page.evaluate('window.__game.speed');
  console.log('DRIFT -> drifting:', drift, 'speed:', s.toFixed(1), drift || s > 30 ? 'PASS' : 'CHECK');
  await page.screenshot({ path: 'E:/ZCODE/horizon-rush/shots/drive-drift.png' });

  // 3) 冲向东大道跳台，飞行中采样最大高度
  await page.evaluate('window.__game.teleport(200, 0, Math.PI / 2)');
  await sleep(200);
  await page.keyboard.down('KeyW');
  let maxY = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const p = await page.evaluate('window.__game.pos');
    if (p.y > maxY) maxY = p.y;
  }
  await page.keyboard.up('KeyW');
  console.log('JUMP maxY ->', maxY.toFixed(2), 'm', maxY > 1.5 ? 'PASS' : 'FAIL');
  await page.screenshot({ path: 'E:/ZCODE/horizon-rush/shots/drive-jump.png' });

  // 4) 海岸路直线氮气
  await page.evaluate('window.__game.teleport(655, -600, 0)');
  await sleep(200);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyW');
  await sleep(3000);
  s = await page.evaluate('window.__game.speed');
  console.log('NITRO ->', s.toFixed(1), 'km/h', s > 150 ? 'PASS' : 'CHECK');
  await page.screenshot({ path: 'E:/ZCODE/horizon-rush/shots/drive-nitro.png' });
  await page.keyboard.up('Shift');
  await page.keyboard.up('KeyW');

  await browser.close();
})();
