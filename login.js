// login.js —— 扫码登录，把登录态存进持久化 profile（.profile/）
// 用法：node login.js
//
// 启动时先用 healthcheck.js 做端到端验活（真去 WPS 跑一次最小转换），而不是
// 只看本地有没有 wps_sid——旧 sid 是一年期 cookie，光看"存在"会假阳性。
//   验活通过        → 直接返回，不打扰你
//   验活判定登录失效 → 清掉失效登录态（否则残留旧 sid 会让扫码循环误判"已成功"）→ 弹浏览器扫码
//   验活非登录故障   → 不进扫码（扫码也救不了），提示查 NOTES.md 易碎点

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.profile');
const LOGIN_URL = 'https://pdf.wps.cn/';

// wps_sid 是真正的登录凭证（HTTP-Only，JS 读不到，但 context.cookies() 能拿到）
async function getWpsSid(context) {
  const cookies = await context.cookies();
  const c = cookies.find((c) => c.name === 'wps_sid' && c.value);
  return c ? c.value : null;
}

// 端到端验活：跑 healthcheck.js（安静模式），0=有效 2=失效/缺失 其它=非登录故障
function verifyLogin() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'healthcheck.js')], { cwd: __dirname });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out: out.trim() }));
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
  });
}

async function scanLogin() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 860 },
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  console.error('请在弹出的浏览器里扫码登录 WPS 账号……（最长等待 5 分钟）');
  const deadline = Date.now() + 5 * 60 * 1000;
  let sid = null;
  while (Date.now() < deadline) {
    sid = await getWpsSid(context);
    if (sid) break;
    await page.waitForTimeout(2000);
  }
  if (!sid) {
    console.error('超时未检测到登录态，未保存。请重试 node login.js');
    await context.close();
    process.exit(1);
  }
  console.log('登录成功，登录态已保存到 .profile/');
  await page.waitForTimeout(1500); // 让 cookie 落盘
  await context.close();
}

async function main() {
  console.error('正在验证现有登录态（端到端自检，约数秒）……');
  const { code, out } = await verifyLogin();

  if (code === 0) {
    console.log('已登录且有效，无需重新扫码。');
    return;
  }

  if (code === 2) {
    // 登录态失效或缺失：清掉残留的失效登录态，再进扫码
    if (fs.existsSync(path.join(PROFILE_DIR, 'Default'))) {
      console.error('现有登录态已失效，清理后重新扫码……');
      fs.rmSync(path.join(PROFILE_DIR, 'Default'), { recursive: true, force: true });
    } else {
      console.error('未检测到登录态，开始扫码登录……');
    }
    await scanLogin();
    return;
  }

  // 非登录故障（链路异常/环境问题）：扫码解决不了
  console.error('\n自检失败，但疑似非登录原因（WPS 改版 / 网络 / cupsfilter 等），未进入扫码。');
  console.error('诊断：' + out.slice(0, 400));
  console.error('排查见 wps-convert/NOTES.md 的「易碎点地图」。');
  process.exit(1);
}

main().catch((e) => {
  console.error('登录脚本出错：', e);
  process.exit(1);
});
