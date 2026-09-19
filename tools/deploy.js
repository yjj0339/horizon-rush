// 通过 gh api contents 接口上传仓库文件（git push 网络不通时的备用部署）
// 用法：node tools/deploy.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'yjj0339/horizon-rush';
const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', '.mimosa', 'node_modules', 'shots', 'server.log', '.gitignore']);

// 带根目录边界校验的读取（防路径穿越）
function readWithinRoot(rel) {
  const target = path.resolve(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new Error('path escapes root');
  return fs.readFileSync(target);
}

function listFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(name.name)) continue;
    const full = path.join(dir, name.name);
    if (full !== ROOT && !full.startsWith(ROOT + path.sep)) continue;
    if (name.isDirectory()) out.push(...listFiles(full));
    else out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

function putFile(fp, tries) {
  const b64 = readWithinRoot(fp).toString('base64');
  for (let i = 1; i <= (tries || 4); i++) {
    try {
      execFileSync('gh', ['api', '-X', 'PUT', 'repos/' + REPO + '/contents/' + fp,
        '-f', 'message=deploy: ' + fp, '-f', 'branch=main',
        '-f', 'content=' + b64], { maxBuffer: 64 * 1024 * 1024 });
      return true;
    } catch (e) {
      const msg = String((e && e.stderr) || e.message || e);
      if (msg.includes('422')) return true;   // 已存在且内容相同
      console.log('  retry', fp, i, msg.slice(0, 120));
      if (i === (tries || 4)) return false;
      const spinStart = Date.now();
      while (Date.now() - spinStart < 3000 * i) { /* 退避等待 */ }
    }
  }
  return false;
}

(function main() {
  const files = listFiles(ROOT);
  console.log('uploading', files.length, 'files...');
  let ok = 0;
  const fail = [];
  for (const fp of files) {
    if (putFile(fp)) { ok++; process.stdout.write('.'); }
    else fail.push(fp);
  }
  console.log('\nok=' + ok, 'fail=' + fail.length);
  if (fail.length) { console.log(fail.join('\n')); process.exit(1); }
  console.log('DEPLOY DONE');
})();
