// healthcheck.js —— 登录态 / 转换链路保活探针（端到端最小转换自检）
//
// 造一个最小 PDF → 调 convert.js 转 docx → 据结果判定整条链路健康度。
// 一次自检同时覆盖：WPS 登录态有效性 + 签名常量 + 接口未改版，并顺带给 cookie 续期。
// 既给 launchd 每日保活用（--notify），也给 login.js 启动时验活复用（安静模式）。
//
// 退出码：0=健康  2=登录态失效/缺失  1=其他失败（转换链路异常/环境问题）
//
// 用法：
//   node healthcheck.js            # 安静：只给退出码 + 日志/stderr 诊断（login.js 验活用）
//   node healthcheck.js --notify   # 失效时额外弹 macOS 通知（launchd 每日保活用）

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync, execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONVERT = path.join(__dirname, 'convert.js');
const PROFILE = path.join(__dirname, '.profile');
const LOG = path.join(os.homedir(), 'Library/Logs/wps-convert-healthcheck.log');
const NOTIFY = process.argv.includes('--notify');

// 登录失效识别（与 convert.js / login.js 的报错文案对齐）
const LOGIN_ERR = /sign\s*失败|未找到登录态|未登录|登录态|not\s*login/i;
// profile 被占用（worker 正在转换）——不是故障，本次跳过即可
const BUSY = /SingletonLock|ProcessSingleton|already (in use|running)|EBUSY|user data directory is already/i;

const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logLine(s) {
  const line = `[${ts()}] ${s}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
  process.stderr.write(line);
}

function notify(title, msg) {
  if (!NOTIFY) return;
  execFile('osascript', ['-e',
    `display notification "${msg}" with title "${title}" sound name "Basso"`], () => {});
}

// 造一个带时间戳、有真实内容的最小 PDF（太小的空文件会卡在"分析中"，见 NOTES.md）
function makeProbePdf() {
  const txt = path.join(os.tmpdir(), `pdfportal-probe-${process.pid}.txt`);
  const pdf = path.join(os.tmpdir(), `pdfportal-probe-${process.pid}.pdf`);
  fs.writeFileSync(txt,
    `PDF Portal healthcheck\nWPS login-state probe @ ${ts()}\n保活自检：中文一行确保有真实内容。\n`);
  const out = execFileSync('/usr/sbin/cupsfilter', [txt], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  fs.writeFileSync(pdf, out);
  fs.rmSync(txt, { force: true });
  return pdf;
}

// 跑一次端到端转换，返回 {ok, code, out}
function probe(inPdf) {
  return new Promise((resolve) => {
    const outDocx = path.join(os.tmpdir(), `pdfportal-probe-${process.pid}.docx`);
    const p = spawn(process.execPath, [CONVERT, inPdf, '--to', 'docx', '-o', outDocx], { cwd: __dirname });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => (buf += d));
    p.on('close', (code) => {
      const ok = code === 0 && fs.existsSync(outDocx);
      fs.rmSync(outDocx, { force: true });
      resolve({ ok, code, out: buf.trim() });
    });
    p.on('error', (e) => resolve({ ok: false, code: -1, out: e.message }));
  });
}

async function main() {
  if (!fs.existsSync(PROFILE)) {
    logLine('✗ 登录态缺失：未找到 .profile/，需先 node login.js 扫码登录');
    notify('WPS 登录态缺失', '运行 node wps-convert/login.js 扫码登录');
    process.exit(2);
  }

  let pdf;
  try {
    pdf = makeProbePdf();
  } catch (e) {
    logLine('✗ 造测试 PDF 失败（cupsfilter 不可用？）：' + e.message);
    process.exit(1); // 环境问题，不误判为登录失效
  }

  // 跑一次；失败且非"占用"则隔 20s 重试一次，以第二次为准（抗偶发抖动）
  let r = await probe(pdf);
  if (!r.ok && !BUSY.test(r.out)) {
    await sleep(20000);
    r = await probe(pdf);
  }
  fs.rmSync(pdf, { force: true });

  if (r.ok) {
    logLine('✓ 健康：端到端转换成功，登录态有效（已顺带续期）');
    process.exit(0);
  }
  if (BUSY.test(r.out)) {
    logLine('· 跳过：profile 被占用（worker 正在转换 = 登录态显然有效）');
    process.exit(0);
  }
  if (LOGIN_ERR.test(r.out)) {
    logLine('✗ 登录态失效：' + r.out.slice(0, 240));
    notify('WPS 登录态失效', '运行 node wps-convert/login.js 扫码重新登录');
    process.exit(2);
  }
  logLine('✗ 转换链路异常（非登录）：' + r.out.slice(0, 240));
  notify('PDF 转换自检失败', '非登录问题，疑似 WPS 改版，查 healthcheck 日志');
  process.exit(1);
}

main();
