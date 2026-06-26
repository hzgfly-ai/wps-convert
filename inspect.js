// inspect.js —— 临时探针：打开页面，抓取当前 bundle URL，下载主 bundle 到 ./bundle.js
// 用于逆向 getFileId 等关键函数。用完即弃。
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.profile');

async function main() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
  });
  const page = context.pages()[0] || (await context.newPage());

  const scriptUrls = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.endsWith('.js') && (u.includes('main.') || u.includes('wps_pdf2word') || u.includes('chunk'))) {
      scriptUrls.push(u);
    }
  });

  await page.goto('https://pdf.wps.cn/pdf2word', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 收集页面里所有 <script src>
  const srcs = await page.$$eval('script[src]', (els) => els.map((e) => e.src));
  console.log('=== script[src] ===');
  srcs.forEach((s) => console.log(s));
  console.log('=== responses (.js) ===');
  scriptUrls.forEach((s) => console.log(s));

  // 找主 bundle：含 main. 的最大者
  const candidates = [...new Set([...srcs, ...scriptUrls])].filter((u) => u.includes('main.'));
  console.log('=== main candidates ===');
  candidates.forEach((s) => console.log(s));

  // 下载所有候选 + 任何含 getFileId 的脚本
  const allJs = [...new Set([...srcs, ...scriptUrls])];
  for (const u of allJs) {
    try {
      const txt = await page.evaluate(async (url) => {
        const r = await fetch(url);
        return await r.text();
      }, u);
      if (txt.includes('getFileId') || u.includes('main.')) {
        const fname = 'bundle_' + u.split('/').pop().split('?')[0];
        fs.writeFileSync(path.join(__dirname, fname), txt);
        console.log(`saved ${fname} (${txt.length} bytes) hasGetFileId=${txt.includes('getFileId')}`);
      }
    } catch (e) {
      console.log('fetch fail', u, e.message);
    }
  }

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
