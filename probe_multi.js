// probe_multi.js —— WPS 多文件 API 探针（merge / insert / photo2pdf）
//
// 用法：
//   node probe_multi.js --product PDFMERGE --inputs a.pdf,b.pdf --out merged.pdf
//   node probe_multi.js --product PDFINSERTPAGES --inputs a.pdf,b.pdf --pagefrom 1 --pages 1-3 --out inserted.pdf
//   node probe_multi.js --product PHOTO2PDF --inputs 1.png,2.png --out out.pdf
//
// 与 probe.js 的区别：必须先上传多个文件、分别拿到 fileId，然后拼出多文件 commit body。
// 不修改 probe.js / convert.js 已验证路径。

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

const CONVERT_INIT = {
  PDFMERGE:        '/api/v4/multicommit/merge',
  PHOTO2WORD:      '/api/v4/commit/pic2word',
  PHOTO2TXT:       '/api/v4/commit/pic2txt',
  PHOTO2EXCEL:     '/api/v4/commit/pic2excel',
  PDFINSERTPAGES:  '/api/v4/multicommit/insert',
  PHOTO2PDF:       '/api/v4/multicommit/pic2pdf',
};
const CONVERT_COMPLETE = {
  PDFMERGE:       '/api/v2/job/merge/completed',
  PHOTO2WORD:     '/api/v2/job/photo2word/completed',
  PHOTO2TXT:      '/api/v2/job/photo2txt/completed',
  PHOTO2EXCEL:    '/api/v2/job/photo2excel/completed',
  PDFINSERTPAGES: '/api/v2/job/insert/completed',
  PHOTO2PDF:      '/api/v2/job/photo2pdf/completed',
};

function parseArgs(argv) {
  const a = { inputs: [], product: null, out: null, dump: null, targetname: null, pagefrom: null, pages: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--product') a.product = rest[++i];
    else if (t === '--inputs') a.inputs = rest[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--out' || t === '-o') a.out = rest[++i];
    else if (t === '--dump') a.dump = rest[++i];
    else if (t === '--targetname') a.targetname = rest[++i];
    else if (t === '--pagefrom') a.pagefrom = Number(rest[++i]);
    else if (t === '--pages') a.pages = rest[++i];
  }
  return a;
}

function die(msg) { console.error('错误：' + msg); process.exit(1); }

async function main() {
  const args = parseArgs(process.argv);
  if (!args.product || args.inputs.length < 1 || !args.out) die('用法: node probe_multi.js --product <PRODUCT> --inputs <f1,f2,...> --out <output>');
  if (!fs.existsSync(PROFILE_DIR)) die('未找到登录态，请先运行 node login.js');
  for (const f of args.inputs) if (!fs.existsSync(f)) die(`输入不存在: ${f}`);

  const commitRel = CONVERT_INIT[args.product];
  if (!commitRel) die(`不支持的 product: ${args.product}`);
  const completeRel = CONVERT_COMPLETE[args.product];

  const job = {
    files: args.inputs.map(f => {
      const buf = fs.readFileSync(f);
      return {
        path: f,
        buf,
        b64: buf.toString('base64'),
        name: path.basename(f),
        ext: path.extname(f).slice(1).toLowerCase(),
        filename: path.basename(f, path.extname(f)),
        md5: crypto.createHash('md5').update(buf).digest('hex'),
        size: buf.length,
      };
    }),
    product: args.product,
    commitUrl: API + commitRel,
    completeUrl: completeRel + '?huidu=' + HUIDU,
    targetname: args.targetname,
    pagefrom: args.pagefrom,
    pages: args.pages,
    API, ACCESS_KEY, HUIDU,
  };

  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://pdf.wps.cn/pdf2word', { waitUntil: 'domcontentloaded' });

  let result;
  try {
    result = await page.evaluate(runMulti, job);
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

async function runMulti(job) {
  const dump = [];
  const log = (step, extra) => dump.push({ step, t: Date.now(), ...extra });
  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const b64ToBytes = (b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
  };
  const bytesToB64 = (bytes) => {
    let bin = ''; const arr = new Uint8Array(bytes); const CH = 0x8000;
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
      body, credentials: 'include',
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
      body: JSON.stringify(dataObj), credentials: 'include',
    });
    const text = await r.text();
    let jsonv = null; try { jsonv = JSON.parse(text); } catch (_) {}
    log(step, { url: relPath, status: r.status, resp: text.slice(0, 500) });
    return { status: r.status, json: jsonv };
  }

  try {
    // 第一步：每个文件先走 upload_init + (分块) + upload_end + numberofpages
    const uploaded = [];
    for (let i = 0; i < job.files.length; i++) {
      const f = job.files[i];
      const bytes = b64ToBytes(f.b64);
      const initUrl = `${job.API}/api/v4/upload?md5=${f.md5}&size=${f.size}&type=${f.ext}`;
      const init = await callSigned(`upload_init_${i}`, 'PUT', initUrl, { contentType: 'application/json' });
      if (!init.json) return { ok: false, error: `file ${i} upload init 无响应`, dump };
      let fileId, jobId;
      if (init.json.fileid && !init.json.id) {
        fileId = init.json.fileid; log(`miaochuan_${i}`, { fileId });
      } else {
        jobId = init.json.id;
        let chunkSize = init.json.nextsize || f.size;
        let offset = 0;
        while (offset < f.size) {
          const end = Math.min(offset + chunkSize, f.size);
          const chunk = bytes.subarray(offset, end);
          const res = await callSigned(`upload_chunk_${i}`, 'POST', `${job.API}/api/v4/upload/${jobId}`, {
            contentType: 'application/octet-stream', body: chunk,
          });
          offset = end;
          const ns = res.json && res.json.nextsize;
          if (ns && ns > 0) chunkSize = ns; else break;
        }
        const endRes = await callSigned(`upload_end_${i}`, 'PUT', `${job.API}/api/v4/upload/${jobId}`, { contentType: 'application/json' });
        fileId = (endRes.json && endRes.json.fileid) || fileId;
      }
      if (!fileId) return { ok: false, error: `file ${i} 未拿到 fileId`, dump };
      await callPlain(`upload_completed_${i}`, '/api/v2/job/upload/completed?huidu=' + job.HUIDU, {
        file_id: fileId, job_id: jobId || fileId, completed_status: 'success',
        file_info: { name: f.name, password: '', md5: f.md5, size: f.size, type: f.ext, id: fileId },
        server_tag: getCookie('servertag') || '',
        product_type: job.product,
        client: { ctype: 'wps-web', chan: 'wps-web', lang: 'cn', ver: '1.0.0' },
      });
      const np = await callSigned(`numberofpages_${i}`, 'POST', `${job.API}/api/v4/commit/numberofpages`, {
        contentType: 'application/json',
        body: JSON.stringify({ filename: f.filename, fileid: fileId, password: '', editpassword: '' }),
      });
      const totalPages = (np.json && np.json.pages) || 0;
      uploaded.push({ ...f, fileId, jobId, totalPages });
    }

    // 第二步：拼 commit body
    let body;
    if (job.product === 'PDFMERGE') {
      body = {
        targetname: job.targetname || uploaded[0].filename + '_merged',
        files: uploaded.map(f => ({
          fileid: f.fileId, password: '', editpassword: '',
          pagefrom: 1, pageto: f.totalPages || 999,
        })),
      };
    } else if (job.product === 'PDFINSERTPAGES') {
      // insert: files[0] = 主文件 + pagefrom, files[1] = 插入文件 + pages
      body = {
        targetname: job.targetname || uploaded[0].filename + '_inserted',
        files: [
          { fileid: uploaded[0].fileId, password: '', editpassword: '',
            pagefrom: job.pagefrom || 1 },
          { fileid: uploaded[1].fileId, password: '', editpassword: '',
            pages: job.pages || '1' },
        ],
      };
    } else if (job.product === 'PHOTO2WORD' || job.product === 'PHOTO2TXT' || job.product === 'PHOTO2EXCEL') {
      // pic2word/excel/txt: files 是 fileid 列表, targetname 是输出文件名
      body = {
        targetname: job.targetname || uploaded[0].filename,
        files: uploaded.map(f => ({
          fileid: f.fileId, password: '', editpassword: '',
        })),
        // toformat 字段（用于图片转图片类型等）
      };
    } else if (job.product === 'PHOTO2PDF') {
      // 图片合并到 PDF: 用 files 数组
      body = {
        targetname: job.targetname || uploaded[0].filename + '_photos',
        files: uploaded.map(f => ({
          fileid: f.fileId, password: '', editpassword: '',
        })),
      };
    } else {
      return { ok: false, error: '未实现的 product: ' + job.product, dump };
    }

    const commit = await callSigned('commit', 'POST', job.commitUrl, {
      contentType: 'application/json', body: JSON.stringify(body),
    });
    const convertJobId = commit.json && commit.json.id;
    if (!convertJobId) return { ok: false, error: '发起转换未返回 jobId: ' + JSON.stringify(commit.json), dump };

    // 轮询
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
          resFile = resp.files[0]; break;
        }
        return { ok: false, error: '转换失败 resultcode=' + resp.resultcode + ' msg=' + resp.resultmsg, dump };
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (!resFile) return { ok: false, error: '轮询超时未完成', dump };

    try {
      await callPlain('convert_completed', job.completeUrl, {
        job_id: convertJobId, completed_status: 'success',
        files: uploaded.map(f => ({
          name: f.name, size: f.size, type: f.ext, md5: f.md5,
          domain: job.API.replace('https:', ''), password: '', editpassword: '',
        })),
        resp_files: [resFile],
        product_type: job.product,
        server_tag: getCookie('servertag') || 'wps-web',
        client: { ctype: 'wps-web', chan: 'wps-web', lang: 'cn', ver: '1.0.0' },
      });
    } catch (e) { log('convert_completed_err', { err: e.message }); }

    const dlUrl = `${job.API}/api/v4/download/${convertJobId}/${encodeURIComponent(resFile.id)}`;
    const dl = await callSigned('download', 'GET', dlUrl, { raw: true });
    if (dl.status !== 200) return { ok: false, error: 'download 状态 ' + dl.status, dump };

    return { ok: true, fileB64: bytesToB64(dl.ab), resFile, dump };
  } catch (e) {
    return { ok: false, error: 'flow 异常: ' + e.message + '\n' + (e.stack || ''), dump };
  }
}

main().catch((e) => die(e.stack || e.message));
