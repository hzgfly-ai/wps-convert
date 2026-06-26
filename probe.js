// probe.js —— WPS 通用 API 探针
//
// 用法：
//   node probe.js <输入文件> --product <PRODUCT> [--commit <path>] [--complete <path>] [--extra <json>] [-o <输出>] [--dump <json>]
//
// 行为：
//   - 复用 convert.js 方案 A 架构：持久化 profile + 页面内 fetch
//   - 与 convert.js 的区别：commit/complete 路径和 product 可任意指定，支持单文件 PDF 类操作
//   - 不修改 convert.js 已验证的 runFlow；probe 自己实现单文件通用流程
//   - 输出 -o 路径；可选 --dump 把每步请求日志写到 JSON
//
// 已知 PRODUCT 速查（来自 bundle Constants.API_URL.CONVERT_INIT）：
//   PDF2WORD / PDF2PPTX / PDF2XLSX / PDF2PHOTO / PDF2HTML / PDF2CAD
//   WORD2PDF / PPT2PDF / EXCEL2PDF / HTML2PDF
//   CAD2PDF / CAD2IMAGE
//   PHOTO2WORD / PHOTO2TXT / PHOTO2EXCEL
//   WORD2LONGIMAGE / PPT2LONGIMAGE
//   PDFCOMPRESS / PDFMERGE / PDFSPLIT
//   PDFENCRYPT / PDFDECRYPT / PDFCHANGEPASSWORD
//   PDFDELWATERMARK / PDFADDWATERMARK
//   PDFDELETEPAGES / PDFINSERTPAGES
//
// 若 --product 在 V4 CONVERT_INIT 表里没找到、但 --commit 指定了完整 URL，会用 --commit 覆盖

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '.profile');
const ACCESS_KEY = '0faa630de5821d0f0ad9da865adbb80f';
const HUIDU = '2.4.3';
const API = 'https://icdcapi.wps.cn';

// 与 bundle Constants.API_URL 保持一致（2026-06-16 抓的 bundle）
const CONVERT_INIT = {
  PDF2WORD: '/api/v4/commit/pdf2docx',
  PDF2PPTX: '/api/v4/commit/pdf2pptx',
  PDF2XLSX: '/api/v4/commit/pdf2xlsx',
  PDF2PHOTO: '/api/v4/commit/pdf2pic',
  PDF2HTML: '/api/v4/commit/pdf2html',
  PDF2CAD:   '/api/v4/commit/pdf2cad',
  CAD2PDF:   '/api/v4/commit/cad2pdf',
  CAD2IMAGE: '/api/v4/commit/cad2image',
  HTML2PDF:  '/api/v4/commit/html2pdf',
  WORD2PDF:  '/api/v4/commit/docx2pdf',
  PPT2PDF:   '/api/v4/commit/pptx2pdf',
  EXCEL2PDF: '/api/v4/commit/xlsx2pdf',
  WORD2LONGIMAGE: '/api/v4/commit/docx2longimage',
  PPT2LONGIMAGE:  '/api/v4/commit/pptx2longimage',
  PHOTO2WORD:  '/api/v4/commit/pic2word',
  PHOTO2TXT:   '/api/v4/commit/pic2txt',
  PHOTO2EXCEL: '/api/v4/commit/pic2excel',
  PHOTO2PDF:   '/api/v4/multicommit/pic2pdf',
  PDFCOMPRESS:         '/api/v4/commit/pdfoptimize',
  PDFMERGE:            '/api/v4/multicommit/merge',
  PDFSPLIT:            '/api/v4/commit/split',
  PDFENCRYPT:          '/api/v4/commit/encrypt',
  PDFDECRYPT:          '/api/v4/commit/pdfdecrypt',
  PDFCHANGEPASSWORD:   '/api/v4/commit/pdfchangepassword',
  PDFDELWATERMARK:     '/api/v4/commit/pdfdelwatermark',
  PDFADDWATERMARK:     '/api/v4/commit/pdfaddwatermark',
  PDFDELETEPAGES:      '/api/v4/commit/delete',
  PDFINSERTPAGES:      '/api/v4/multicommit/insert',
  PDFOCRREPAIR:        '/api/v4/commit/pdfocrrepair',
};
const CONVERT_COMPLETE = {
  PDF2WORD:  '/api/v2/job/convert/completed',
  PDF2PPTX:  '/api/v2/job/pdf2pptx/completed',
  PDF2XLSX:  '/api/v2/job/pdf2xlsx/completed',
  PDF2PHOTO: '/api/v2/job/pdf2photo/completed',
  PDF2HTML:  '/api/v2/job/pdf2html/completed',
  PDF2CAD:   '/api/v2/job/pdf2cad/completed',
  CAD2PDF:   '/api/v2/job/cad2pdf/completed',
  CAD2IMAGE: '/api/v2/job/cad2image/completed',
  HTML2PDF:  '/api/v2/job/html2pdf/completed',
  WORD2PDF:  '/api/v2/job/word2pdf/completed',
  WORD2LONGIMAGE: '/api/v2/job/word2longimage/completed',
  EXCEL2PDF: '/api/v2/job/excel2pdf/completed',
  PPT2PDF:   '/api/v2/job/ppt2pdf/completed',
  PPT2LONGIMAGE: '/api/v2/job/ppt2longimage/completed',
  PHOTO2WORD:  '/api/v2/job/photo2word/completed',
  PHOTO2TXT:   '/api/v2/job/photo2txt/completed',
  PHOTO2EXCEL: '/api/v2/job/photo2excel/completed',
  PHOTO2PDF:   '/api/v2/job/photo2pdf/completed',
  PDFCOMPRESS:        '/api/v2/job/compress/completed',
  PDFMERGE:           '/api/v2/job/merge/completed',
  PDFSPLIT:           '/api/v2/job/split/completed',
  PDFENCRYPT:         '/api/v2/job/encrypt/completed',
  PDFDECRYPT:         '/api/v2/job/pdfdecrypt/completed',
  PDFCHANGEPASSWORD:  '/api/v2/job/pdfchangepassword/completed',
  PDFDELWATERMARK:    '/api/v2/job/delwatermark/completed',
  PDFADDWATERMARK:    '/api/v2/job/addwatermark/completed',
  PDFDELETEPAGES:     '/api/v2/job/delete/completed',
  PDFINSERTPAGES:     '/api/v2/job/insert/completed',
};

function parseArgs(argv) {
  const a = { input: null, product: null, commit: null, complete: null, extra: null, out: null, dump: null, pagefrom: null, pageto: null, password: null, editpassword: null, newpassword: null, pages: null, interval: null, targetname: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--product') a.product = rest[++i];
    else if (t === '--commit') a.commit = rest[++i];
    else if (t === '--complete') a.complete = rest[++i];
    else if (t === '--extra') a.extra = JSON.parse(rest[++i]);
    else if (t === '--pagefrom') a.pagefrom = Number(rest[++i]);
    else if (t === '--pageto') a.pageto = Number(rest[++i]);
    else if (t === '--pages') a.pages = rest[++i];
    else if (t === '--interval') a.interval = Number(rest[++i]);
    else if (t === '--password') a.password = rest[++i];
    else if (t === '--editpassword') a.editpassword = rest[++i];
    else if (t === '--newpassword') a.newpassword = rest[++i];
    else if (t === '--targetname') a.targetname = rest[++i];
    else if (t === '-o' || t === '--out') a.out = rest[++i];
    else if (t === '--dump') a.dump = rest[++i];
    else if (!a.input) a.input = t;
  }
  return a;
}

function die(msg) { console.error('错误：' + msg); process.exit(1); }

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.out) die('用法: node probe.js <输入文件> --product <PRODUCT> [-o 输出] [--dump json] [--extra {json}]');
  if (!args.product) die('必须指定 --product');
  if (!fs.existsSync(args.input)) die(`输入文件不存在: ${args.input}`);
  if (!fs.existsSync(PROFILE_DIR)) die('未找到登录态，请先运行 node login.js');

  const buf = fs.readFileSync(args.input);
  const srcType = path.extname(args.input).slice(1).toLowerCase();
  const commitRel = args.commit || CONVERT_INIT[args.product];
  if (!commitRel) die(`未知 product: ${args.product}（用 --commit 覆盖）`);
  const completeRel = args.complete || CONVERT_COMPLETE[args.product] || '/api/v2/job/convert/completed';

  // 拼 commit body 基底
  const filename = path.basename(args.input, path.extname(args.input));
  const baseBody = {
    fileid: '',         // 后面填
    password: args.password || '',
    editpassword: args.editpassword || '',
    filename,
    labels: '',
    ...args.extra,
  };
  // 把 page 相关参数融进去（视各 API 而定）
  if (args.pagefrom != null) baseBody.pagefrom = args.pagefrom;
  if (args.pageto != null) baseBody.pageto = args.pageto;
  if (args.pages != null) baseBody.pages = args.pages;
  if (args.interval != null) baseBody.interval = args.interval;
  if (args.newpassword != null) baseBody.newpassword = args.newpassword;
  if (args.targetname != null) baseBody.targetname = args.targetname;

  const job = {
    fileB64: buf.toString('base64'),
    name: path.basename(args.input),
    filename,
    md5: crypto.createHash('md5').update(buf).digest('hex'),
    size: buf.length,
    srcType,
    product: args.product,
    commitUrl: commitRel.startsWith('http') ? commitRel : API + commitRel,
    completeUrl: completeRel + '?huidu=' + HUIDU,
    baseBody,
    API, ACCESS_KEY, HUIDU,
  };

  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://pdf.wps.cn/pdf2word', { waitUntil: 'domcontentloaded' });

  let result;
  try {
    result = await page.evaluate(runFlow, job);
  } catch (e) {
    await context.close();
    die('页面内流程异常: ' + e.message);
  }
  await context.close();

  if (args.dump) {
    fs.writeFileSync(args.dump, JSON.stringify(result.dump, null, 2));
    console.error(`已 dump 请求日志到 ${args.dump}`);
  }

  if (!result.ok) die(result.error || '转换失败');

  fs.writeFileSync(args.out, Buffer.from(result.fileB64, 'base64'));
  console.error(`完成：${args.out}（${Buffer.from(result.fileB64, 'base64').length} 字节）`);
  process.exit(0);
}

// ====== 页面内流程（单文件通用）======
async function runFlow(job) {
  const dump = [];
  const log = (step, extra) => dump.push({ step, t: Date.now(), ...extra });

  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };

  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  const bytesToB64 = (bytes) => {
    let bin = '';
    const arr = new Uint8Array(bytes);
    const CH = 0x8000;
    for (let i = 0; i < arr.length; i += CH) bin += String.fromCharCode.apply(null, arr.subarray(i, i + CH));
    return btoa(bin);
  };

  const CLIENT = { 'Client-Chan': 'wps-web', 'Client-Lang': 'cn', 'Client-Type': 'wps-web', 'Client-Ver': '1.0.0' };

  async function sign(method, contentType, uriPath, uriQuery) {
    const date = new Date().toUTCString();
    const body = new URLSearchParams({ method, contentType: contentType || '', date, uriPath, uriQuery }).toString();
    const r = await fetch('/api/v1/sign?huidu=' + job.HUIDU, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      credentials: 'include',
    });
    const j = await r.json();
    if (!j || !j.data) throw new Error('sign 失败: ' + JSON.stringify(j));
    return { token: 'wpsvas:ksowebdcapi:' + job.ACCESS_KEY + ':' + j.data, date };
  }

  async function callSigned(step, method, fullUrl, opts = {}) {
    const u = new URL(fullUrl);
    const { token, date } = await sign(method, opts.contentType, u.pathname, u.search.slice(1));
    const headers = { ...CLIENT, WPSVASDevToken: token, 'X-Date': date };
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    const r = await fetch(fullUrl, { method, headers, body: opts.body, credentials: 'include' });
    if (opts.raw) {
      const ab = await r.arrayBuffer();
      log(step, { method, url: fullUrl, status: r.status, bytes: ab.byteLength });
      return { status: r.status, ab };
    }
    const text = await r.text();
    let jsonv = null;
    try { jsonv = JSON.parse(text); } catch (_) {}
    log(step, { method, url: fullUrl, status: r.status, resp: (jsonv ?? text)?.toString?.().slice?.(0, 800) ?? jsonv, json: jsonv });
    return { status: r.status, json: jsonv, text };
  }

  async function callPlain(step, relPath, dataObj) {
    const r = await fetch(relPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CLIENT },
      body: JSON.stringify(dataObj),
      credentials: 'include',
    });
    const text = await r.text();
    let jsonv = null;
    try { jsonv = JSON.parse(text); } catch (_) {}
    log(step, { url: relPath, status: r.status, resp: text.slice(0, 500) });
    return { status: r.status, json: jsonv };
  }

  try {
    const bytes = b64ToBytes(job.fileB64);

    // [1] upload init
    const initUrl = `${job.API}/api/v4/upload?md5=${job.md5}&size=${job.size}&type=${job.srcType}`;
    const init = await callSigned('upload_init', 'PUT', initUrl, { contentType: 'application/json' });
    if (!init.json) return { ok: false, error: 'upload init 无响应', dump };

    let fileId, jobId;
    if (init.json.fileid && !init.json.id) {
      fileId = init.json.fileid;
      log('miaochuan', { fileId });
    } else {
      jobId = init.json.id;
      let chunkSize = init.json.nextsize || job.size;
      let offset = 0;
      while (offset < job.size) {
        const end = Math.min(offset + chunkSize, job.size);
        const chunk = bytes.subarray(offset, end);
        const res = await callSigned('upload_chunk', 'POST', `${job.API}/api/v4/upload/${jobId}`, {
          contentType: 'application/octet-stream',
          body: chunk,
        });
        offset = end;
        const nextsize = res.json && res.json.nextsize;
        if (nextsize && nextsize > 0) chunkSize = nextsize;
        else break;
      }
      const endRes = await callSigned('upload_end', 'PUT', `${job.API}/api/v4/upload/${jobId}`, { contentType: 'application/json' });
      fileId = (endRes.json && endRes.json.fileid) || fileId;
    }
    if (!fileId) return { ok: false, error: '未拿到 fileId', dump };

    // [2] upload_completed
    await callPlain('upload_completed', '/api/v2/job/upload/completed?huidu=' + job.HUIDU, {
      file_id: fileId,
      job_id: jobId || fileId,
      completed_status: 'success',
      file_info: { name: job.name, password: '', md5: job.md5, size: job.size, type: job.srcType, id: fileId },
      server_tag: getCookie('servertag') || '',
      product_type: job.product,
      client: { ctype: 'wps-web', chan: 'wps-web', lang: 'cn', ver: '1.0.0' },
    });

    // [3] numberofpages
    await callSigned('numberofpages', 'POST', `${job.API}/api/v4/commit/numberofpages`, {
      contentType: 'application/json',
      body: JSON.stringify({ filename: job.filename, fileid: fileId, password: '', editpassword: '' }),
    });

    // [4] 发起转换
    const body = { ...job.baseBody, fileid: fileId };
    const commit = await callSigned('commit', 'POST', job.commitUrl, {
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    const convertJobId = commit.json && commit.json.id;
    if (!convertJobId) return { ok: false, error: '发起转换未返回 jobId: ' + JSON.stringify(commit.json), dump };

    // [5] 轮询
    let resFile = null;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const q = await callSigned('query', 'GET', `${job.API}/api/v4/query/${convertJobId}?time=${Date.now()}`, {
        contentType: 'application/json',
      });
      const d = q.json || {};
      if (d.progress === 100) {
        const resp = d.resp || {};
        if (resp.resultcode === 0 && resp.files && resp.files[0]) {
          resFile = resp.files[0];
          break;
        }
        return { ok: false, error: '转换失败 resultcode=' + resp.resultcode + ' msg=' + resp.resultmsg, dump };
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!resFile) return { ok: false, error: '轮询超时未完成', dump };

    // [6] convert_completed (best-effort)
    try {
      await callPlain('convert_completed', job.completeUrl, {
        job_id: convertJobId,
        completed_status: 'success',
        files: [{ name: job.name, size: job.size, type: job.srcType, md5: job.md5, domain: job.API.replace('https:', ''), password: '', editpassword: '' }],
        resp_files: [resFile],
        product_type: job.product,
        server_tag: getCookie('servertag') || 'wps-web',
        client: { ctype: 'wps-web', chan: 'wps-web', lang: 'cn', ver: '1.0.0' },
      });
    } catch (e) {
      log('convert_completed_err', { err: e.message });
    }

    // [7] download
    const dlUrl = `${job.API}/api/v4/download/${convertJobId}/${encodeURIComponent(resFile.id)}`;
    const dl = await callSigned('download', 'GET', dlUrl, { raw: true });
    if (dl.status !== 200) return { ok: false, error: 'download 状态 ' + dl.status, dump };

    return { ok: true, fileB64: bytesToB64(dl.ab), resFile, dump };
  } catch (e) {
    return { ok: false, error: 'flow 异常: ' + e.message + '\n' + (e.stack || ''), dump };
  }
}

main().catch((e) => die(e.stack || e.message));
