// convert.js —— WPS 格式转换引擎（方案 A：持久化浏览器 + 页面内 fetch 调 API）
//
// 用法：
//   node convert.js 输入.pdf --to docx -o 结果.docx [--dump dump.json]
//
// 成功 → 结果写到 -o 路径，退出码 0
// 失败 → stderr 报原因，退出码非 0
//
// 实现要点（详见 NOTES.md）：
//   - 登录态来自 login.js 存的持久化 profile（.profile/，含 HTTP-Only wps_sid）
//   - 真正的调用在页面内用 fetch 发：签名接口 /api/v1/sign 同源(pdf.wps.cn)，
//     icdcapi.wps.cn 业务请求跨域带 credentials（站点已配 CORS）
//   - 只有 icdcapi 业务请求要 WPSVASDevToken 签名；两个 completed + download 靠 cookie

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

// 转换映射：key = `${源扩展名}->${目标格式}`
// 只增不删：历史 entry 永远保留，新增项追加在末尾。
// 多文件 / 插页 / 合并 / 图片→PDF 用 probe_multi.js，convert.js 仍只跑单文件 commit。
const CONVERSIONS = {
  // —— 2026-05-28 首次跑通，pdf→docx 单跑通 ——
  'pdf->docx': { product: 'PDF2WORD',  commit: '/api/v4/commit/pdf2docx',  complete: '/api/v2/job/convert/completed' },
  'pdf->pptx': { product: 'PDF2PPTX',  commit: '/api/v4/commit/pdf2pptx',  complete: '/api/v2/job/pdf2pptx/completed' },
  'pdf->xlsx': { product: 'PDF2XLSX',  commit: '/api/v4/commit/pdf2xlsx',  complete: '/api/v2/job/pdf2xlsx/completed' },
  'pdf->html': { product: 'PDF2HTML',  commit: '/api/v4/commit/pdf2html',  complete: '/api/v2/job/pdf2html/completed' },
  'docx->pdf': { product: 'WORD2PDF',  commit: '/api/v4/commit/docx2pdf',  complete: '/api/v2/job/word2pdf/completed' },
  'doc->pdf':  { product: 'WORD2PDF',  commit: '/api/v4/commit/docx2pdf',  complete: '/api/v2/job/word2pdf/completed' },
  'pptx->pdf': { product: 'PPT2PDF',   commit: '/api/v4/commit/pptx2pdf',  complete: '/api/v2/job/ppt2pdf/completed' },
  'ppt->pdf':  { product: 'PPT2PDF',   commit: '/api/v4/commit/pptx2pdf',  complete: '/api/v2/job/ppt2pdf/completed' },
  'xlsx->pdf': { product: 'EXCEL2PDF', commit: '/api/v4/commit/xlsx2pdf',  complete: '/api/v2/job/excel2pdf/completed' },
  'xls->pdf':  { product: 'EXCEL2PDF', commit: '/api/v4/commit/xlsx2pdf',  complete: '/api/v2/job/excel2pdf/completed' },
  // —— 2026-06-16 全量逆向新增，全部 probe.js 实测通过 ——
  'pdf->png':  { product: 'PDF2PHOTO', commit: '/api/v4/commit/pdf2pic',   complete: '/api/v2/job/pdf2pic/completed' },
  'pdf->jpg':  { product: 'PDF2PHOTO', commit: '/api/v4/commit/pdf2pic',   complete: '/api/v2/job/pdf2pic/completed' },
  'docx->png': { product: 'WORD2LONGIMAGE', commit: '/api/v4/commit/docx2longimage', complete: '/api/v2/job/docx2longimage/completed' },
  'docx->jpg': { product: 'WORD2LONGIMAGE', commit: '/api/v4/commit/docx2longimage', complete: '/api/v2/job/docx2longimage/completed' },
  'doc->png':  { product: 'WORD2LONGIMAGE', commit: '/api/v4/commit/docx2longimage', complete: '/api/v2/job/docx2longimage/completed' },
  'doc->jpg':  { product: 'WORD2LONGIMAGE', commit: '/api/v4/commit/docx2longimage', complete: '/api/v2/job/docx2longimage/completed' },
  'pptx->png': { product: 'PPT2LONGIMAGE',  commit: '/api/v4/commit/pptx2longimage', complete: '/api/v2/job/pptx2longimage/completed' },
  'pptx->jpg': { product: 'PPT2LONGIMAGE',  commit: '/api/v4/commit/pptx2longimage', complete: '/api/v2/job/pptx2longimage/completed' },
  'ppt->png':  { product: 'PPT2LONGIMAGE',  commit: '/api/v4/commit/pptx2longimage', complete: '/api/v2/job/pptx2longimage/completed' },
  'ppt->jpg':  { product: 'PPT2LONGIMAGE',  commit: '/api/v4/commit/pptx2longimage', complete: '/api/v2/job/pptx2longimage/completed' },
  'png->word': { product: 'PHOTO2WORD',  commit: '/api/v4/commit/pic2word',  complete: '/api/v2/job/pic2word/completed' },
  'jpg->word': { product: 'PHOTO2WORD',  commit: '/api/v4/commit/pic2word',  complete: '/api/v2/job/pic2word/completed' },
  'png->txt':  { product: 'PHOTO2TXT',   commit: '/api/v4/commit/pic2txt',   complete: '/api/v2/job/pic2txt/completed' },
  'jpg->txt':  { product: 'PHOTO2TXT',   commit: '/api/v4/commit/pic2txt',   complete: '/api/v2/job/pic2txt/completed' },
  'png->xlsx': { product: 'PHOTO2EXCEL', commit: '/api/v4/commit/pic2excel', complete: '/api/v2/job/pic2excel/completed' },
  'jpg->xlsx': { product: 'PHOTO2EXCEL', commit: '/api/v4/commit/pic2excel', complete: '/api/v2/job/pic2excel/completed' },
  // PDF 操作类
  'pdf->optimize':    { product: 'PDFCOMPRESS',       commit: '/api/v4/commit/pdfoptimize',       complete: '/api/v2/job/pdfoptimize/completed' },
  'pdf->delwatermark':{ product: 'PDFDELWATERMARK',   commit: '/api/v4/commit/pdfdelwatermark',   complete: '/api/v2/job/pdfdelwatermark/completed' },
  'pdf->ocrrepair':   { product: 'PDFOCRREPAIR',      commit: '/api/v4/commit/pdfocrrepair',      complete: '/api/v2/job/pdfocrrepair/completed' },
  'pdf->split':       { product: 'PDFSPLIT',          commit: '/api/v4/commit/split',             complete: '/api/v2/job/split/completed' },
  'pdf->delete':      { product: 'PDFDELETEPAGES',    commit: '/api/v4/commit/delete',            complete: '/api/v2/job/delete/completed' },
  'pdf->encrypt':     { product: 'PDFENCRYPT',        commit: '/api/v4/commit/encrypt',           complete: '/api/v2/job/encrypt/completed' },
  'pdf->changepw':    { product: 'PDFCHANGEPASSWORD', commit: '/api/v4/commit/pdfchangepassword', complete: '/api/v2/job/pdfchangepassword/completed' },
  'pdf->addwatermark':{ product: 'PDFADDWATERMARK',   commit: '/api/v4/commit/pdfaddwatermark',   complete: '/api/v2/job/pdfaddwatermark/completed' },
};

function parseArgs(argv) {
  const a = { input: null, to: null, out: null, dump: null, extra: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--to') a.to = rest[++i];
    else if (t === '-o' || t === '--out') a.out = rest[++i];
    else if (t === '--dump') a.dump = rest[++i];
    else if (t === '--extra') a.extra = rest[++i];
    else if (!a.input) a.input = t;
  }
  return a;
}

function die(msg) {
  console.error('错误：' + msg);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.to || !args.out) {
    die('用法: node convert.js 输入文件 --to <格式> -o 输出文件 [--dump dump.json] [--extra <json>]');
  }
  if (!fs.existsSync(args.input)) die(`输入文件不存在: ${args.input}`);
  if (!fs.existsSync(PROFILE_DIR)) die('未找到登录态，请先运行 node login.js 扫码登录');

  const buf = fs.readFileSync(args.input);
  const srcType = path.extname(args.input).slice(1).toLowerCase();
  const to = args.to.toLowerCase();
  const conv = CONVERSIONS[`${srcType}->${to}`];
  if (!conv) die(`暂不支持的转换: ${srcType} -> ${to}（支持: ${Object.keys(CONVERSIONS).join(', ')}）`);

  // --extra 解析为 commit body 的附加字段（向后兼容：不传则空对象）
  // 例：--extra '{"watermark_type":"text","content":"CONFIDENTIAL"}'
  //     --extra '{"newpassword":"abc123"}'
  //     --extra '{"pages":"1,3-5","toformat":"jpg"}'
  let extra = {};
  if (args.extra) {
    try { extra = JSON.parse(args.extra); }
    catch (e) { die('--extra 必须是合法 JSON：' + e.message); }
  }

  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const job = {
    fileB64: buf.toString('base64'),
    name: path.basename(args.input),
    filename: path.basename(args.input, path.extname(args.input)),
    md5,
    size: buf.length,
    srcType,
    product: conv.product,
    commitUrl: API + conv.commit,
    completeUrl: conv.complete + '?huidu=' + HUIDU,
    extra,
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

// ====== 以下函数整体被序列化送进页面执行（不能引用外部作用域）======
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

  // 调 icdcapi 业务接口（带签名）
  async function callSigned(step, method, fullUrl, { contentType, body, raw } = {}) {
    const u = new URL(fullUrl);
    const { token, date } = await sign(method, contentType, u.pathname, u.search.slice(1));
    const headers = { ...CLIENT, WPSVASDevToken: token, 'X-Date': date };
    if (contentType) headers['Content-Type'] = contentType;
    const r = await fetch(fullUrl, { method, headers, body, credentials: 'include' });
    if (raw) {
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

  // 调同源接口（completed，不签名，靠 cookie）
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

    // [1] PUT upload init
    const initUrl = `${job.API}/api/v4/upload?md5=${job.md5}&size=${job.size}&type=${job.srcType}`;
    const init = await callSigned('upload_init', 'PUT', initUrl, { contentType: 'application/json' });
    if (!init.json) return { ok: false, error: 'upload init 无响应', dump };

    let fileId, jobId;
    if (init.json.fileid && !init.json.id) {
      // 秒传
      fileId = init.json.fileid;
      log('miaochuan', { fileId });
    } else {
      jobId = init.json.id;
      let chunkSize = init.json.nextsize || job.size;
      let offset = 0;
      // [2] POST 分块二进制
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
      // [3] PUT 标记完成
      const endRes = await callSigned('upload_end', 'PUT', `${job.API}/api/v4/upload/${jobId}`, { contentType: 'application/json' });
      fileId = (endRes.json && endRes.json.fileid) || fileId;
    }
    if (!fileId) return { ok: false, error: '未拿到 fileId', dump };

    // [4] POST upload/completed（同源，不签名）
    await callPlain('upload_completed', '/api/v2/job/upload/completed?huidu=' + job.HUIDU, {
      file_id: fileId,
      job_id: jobId || fileId,
      completed_status: 'success',
      file_info: { name: job.name, password: '', md5: job.md5, size: job.size, type: job.srcType, id: fileId },
      server_tag: getCookie('servertag') || '',
      product_type: job.product,
      client: { ctype: 'wps-web', chan: 'wps-web', lang: 'cn', ver: '1.0.0' },
    });

    // [5] POST numberofpages（签名）
    await callSigned('numberofpages', 'POST', `${job.API}/api/v4/commit/numberofpages`, {
      contentType: 'application/json',
      body: JSON.stringify({ filename: job.filename, fileid: fileId, password: '', editpassword: '' }),
    });

    // [6] POST 发起转换（签名）
    // job.extra（来自 --extra）会被展开到 commit body 顶层，支持 watermark_type / newpassword / pages / toformat 等
    const commitBody = Object.assign(
      { fileid: fileId, password: '', editpassword: '', filename: job.filename, labels: '' },
      job.extra || {}
    );
    const commit = await callSigned('commit', 'POST', job.commitUrl, {
      contentType: 'application/json',
      body: JSON.stringify(commitBody),
    });
    const convertJobId = commit.json && commit.json.id;
    if (!convertJobId) return { ok: false, error: '发起转换未返回 jobId: ' + JSON.stringify(commit.json), dump };

    // [7] 轮询 query（签名）
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

    // [8] POST convert/completed（同源，不签名，best-effort）
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

    // [9] GET download（不签名，靠 cookie）
    const dlUrl = `${job.API}/api/v4/download/${convertJobId}/${encodeURIComponent(resFile.id)}`;
    const dl = await callSigned('download', 'GET', dlUrl, { raw: true }); // raw 不会加 contentType；download 不需要签名头但带上无害
    if (dl.status !== 200) return { ok: false, error: 'download 状态 ' + dl.status, dump };

    return { ok: true, fileB64: bytesToB64(dl.ab), resFile, dump };
  } catch (e) {
    return { ok: false, error: 'flow 异常: ' + e.message + '\n' + (e.stack || ''), dump };
  }
}

main().catch((e) => die(e.stack || e.message));
