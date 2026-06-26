# WPS PDF 在线服务 API 完整规格（实测版）

> 逆向目标：<https://pdf.wps.cn>（后端 `icdcapi.wps.cn`）
> 抓 bundle 时间：2026-06-16
> 实测时间：2026-06-16
> 仅记**有实测证据**的接口；未跑通的明确标"⚠️未验证"，绝不与已通过的混在一起。

> 权威：以本文档为准；早期 `wps-pdf-conversion-api.md` 含多处静态逆向错误，已被 `NOTES.md` 推翻。
> **本文件是 `NOTES.md` 的扩展**——`NOTES.md` 讲架构、易碎点、签名机制；这里讲每个接口的 spec。

---

## 0. 速查表（每个产品 × 验证状态）

✅ = 已端到端跑通 + 产物校验合法  
⚠️ = 静态逆向拿到路径/字段，但**未在真实跑通**的场景里验证

| 接口（站点 URL） | 内部 API 端点 | 验证 | 样本 / 产物 |
|---|---|---|---|
| PDF→Word /<https://pdf.wps.cn/pdf2word> | `POST /api/v4/commit/pdf2docx` | ✅ | `convert.js` 验证，docx 合法 |
| PDF→PPT /pdf2ppt | `POST /api/v4/commit/pdf2pptx` | ✅ | probe 跑通，产物 Microsoft PowerPoint 2007+ |
| PDF→Excel /pdf2excel | `POST /api/v4/commit/pdf2xlsx` | ✅ | probe，产物 Microsoft Excel 2007+ |
| PDF→HTML /pdf2html | `POST /api/v4/commit/pdf2html` | ✅ | probe，产物 zip（HTML+资源） |
| PDF→图片 /pdf2photo | `POST /api/v4/commit/pdf2pic` | ✅ | probe，产物 zip（含 PNG） |
| Word→PDF /word2pdf | `POST /api/v4/commit/docx2pdf` | ✅ | probe，产物 PDF 1.7 |
| Excel→PDF /excel2pdf | `POST /api/v4/commit/xlsx2pdf` | ✅ | probe，产物 PDF 1.7 |
| PPT→PDF /ppt2pdf | `POST /api/v4/commit/pptx2pdf` | ✅ | probe，产物 PDF 1.7 |
| HTML→PDF /html2pdf | `POST /api/v4/commit/html2pdf` | ⚠️ | bundle 路径已抓到，提交用 text 文件后端未返回 jobId（body 可能需要 `url`/`content` 而非上传文件） |
| 图片→PDF /photo2pdf | `POST /api/v4/multicommit/pic2pdf` | ✅ | probe_multi 多文件，PNG+JPG→PDF 1.7 |
| CAD→PDF /cad2pdf | `POST /api/v4/commit/cad2pdf` | ⚠️ | bundle 路径已抓到，无 DWG 样本 |
| PDF→CAD /pdf2cad | `POST /api/v4/commit/pdf2cad` | ⚠️ | 同上 |
| CAD→图片 /cad2image | `POST /api/v4/commit/cad2image` | ⚠️ | 同上 |
| 图片→Word /photo2word | `POST /api/v4/commit/pic2word` | ✅（单图）/ ⚠️（多图） | probe 单图跑通产物 docx 合法；多图 commit 400，body 结构需进一步确认 |
| 图片→文字 /photo2txt | `POST /api/v4/commit/pic2txt` | ✅ | probe OCR，识别出 "WPS OCR Test Image / Hello.World!1234567890 / …" |
| 图片→Excel /photo2excel | `POST /api/v4/commit/pic2excel` | ✅（单图）| probe 单图，产物 xlsx 合法 |
| Word→长图 /word2longimage | `POST /api/v4/commit/docx2longimage` | ✅ | probe，产物 JPEG 816x1056 |
| PPT→长图 /ppt2longimage | `POST /api/v4/commit/pptx2longimage` | ✅ | probe，产物 JPEG 1279x2880 |
| **PDF 操作类** | | | |
| 合并 /merge2pdf | `POST /api/v4/multicommit/merge` | ✅ | probe_multi 2份 PDF 合并，pages 1+1→2 |
| 拆分 /split | `POST /api/v4/commit/split` | ✅ | probe `--pages "1,2"` 4页 PDF 拆出 2 个 PDF（zip） |
| 压缩 /compress | `POST /api/v4/commit/pdfoptimize` | ✅ | probe，38KB→22KB |
| 加密 /encrypt | `POST /api/v4/commit/encrypt` | ✅ | probe `--newpassword`，pypdf 报"File has not been decrypted" |
| 改密 /changepw | `POST /api/v4/commit/pdfchangepassword` | ✅ | probe 同上加密成功 |
| 解密 /decrypt | `POST /api/v4/commit/pdfdecrypt` | ⚠️ | bundle 路径已抓到，UI 入口当前被注释掉（`// defEvent('navImg24', ...)`）；niche 用例，先未跑通 |
| 删页 /delete | `POST /api/v4/commit/delete` | ✅ | probe `--pages "1"`，4页→3页 |
| 插页 /insert | `POST /api/v4/multicommit/insert` | ✅ | probe_multi 1+1→2页 |
| 加水印 /addwatermark | `POST /api/v4/commit/pdfaddwatermark` | ✅（text） / ⚠️（image） | probe `watermark_type:"text"` 跑通；image 类型需要先用 `image_fileid`，已记录但未跑通 |
| 删水印 /delwatermark | `POST /api/v4/commit/pdfdelwatermark` | ✅ | probe 38KB→16KB |
| 字体修复 /pdf2wordpreview | `POST /api/v4/commit/pdfocrrepair` | ✅ | probe，文字可提取字符数 5021→9961 |
| **辅助接口** | | | |
| 上传 init | `PUT //icdcapi.wps.cn/api/v4/upload?md5=&size=&type=` | ✅ | (见 NOTES.md 流程) |
| 上传 chunk | `POST //icdcapi.wps.cn/api/v4/upload/{jobId}` | ✅ | (见 NOTES.md) |
| 上传 end | `PUT //icdcapi.wps.cn/api/v4/upload/{jobId}` | ✅ | (见 NOTES.md) |
| 上传完成（同源） | `POST /api/v2/job/upload/completed?huidu=2.4.3` | ✅ | (见 NOTES.md) |
| 页数 | `POST //icdcapi.wps.cn/api/v4/commit/numberofpages` | ✅ | (见 NOTES.md) |
| 轮询 | `GET //icdcapi.wps.cn/api/v4/query/{jobId}?time=` | ✅ | (见 NOTES.md) |
| 转换完成（同源） | `POST /api/v2/job/convert/completed?huidu=2.4.3` | ✅ | best-effort |
| 下载 | `GET //icdcapi.wps.cn/api/v4/download/{jobId}/{fileId}` | ✅ | (见 NOTES.md) |
| 取消 | `DELETE //icdcapi.wps.cn/api/v4/cancel/{jobId}` | ⚠️ | 路径已抓到，未实跑 |
| 签到 (V4) | `POST /api/v1/sign?huidu=2.4.3` | ✅ | (见 NOTES.md) |
| 签到 (V5) | `POST /api/v2/sign?huidu=2.4.3` | ⚠️ | 路径已抓到；V5 全套未实跑（NOTES.md 决定只走 V4） |
| 用户信息 | `GET /api/v1/user?huidu=2.4.3` | ✅ | `convert.js` 健康检查隐式使用 |
| 退出登录 | `GET /api/v1/user/logout?huidu=2.4.3` | ⚠️ | 路径已抓到 |
| 用户特权 | `GET /api/v1/user/privilege/pdf2word?huidu=2.4.3` | ⚠️ | 同上 |
| 关注公众号状态 | `GET /api/v1/user/is_wx_subscribe?huidu=2.4.3` | ⚠️ | 同上 |
| 任务状态 | `GET /api/v1/job/status/{jobId}?huidu=2.4.3` | ⚠️ | 同上 |
| 任务汇总 | `GET /api/v1/job/summary?huidu=2.4.3` | ⚠️ | 同上 |

---

## 1. 完整流程（来自 NOTES.md + 多类型补充验证）

```
[1] PUT  upload_init     //icdcapi.wps.cn/api/v4/upload?md5=&size=&type=   签名
        → 新文件: {id:jobId, nextsize}
        → 秒传:   {fileid} (直接进入 [4])

[2] POST upload_chunk    //icdcapi.wps.cn/api/v4/upload/{jobId}            签名
        body = application/octet-stream
        → {nextsize}  (nextsize 决定下次分块大小)

[3] PUT  upload_end      //icdcapi.wps.cn/api/v4/upload/{jobId}            签名
        → {fileid}

[4] POST upload_completed  /api/v2/job/upload/completed?huidu=2.4.3         不签名(同源)
        body = {file_id, job_id, completed_status, file_info, server_tag, product_type, client}

[5] POST numberofpages   //icdcapi.wps.cn/api/v4/commit/numberofpages      签名
        body = {filename, fileid, password, editpassword}
        → {id, pages?}  (某些接口在轮询时拿到 pages)

[6] POST commit          //icdcapi.wps.cn/api/v4/commit/{product}          签名
        body = 见 §3 各产品
        → {id:convertJobId}

[7] GET  query 轮询      //icdcapi.wps.cn/api/v4/query/{convertJobId}?time= 签名
        → 进度 < 100 时睡 2.5s 继续
        → progress===100 && resultcode===0: {resp.files[0]}

[8] POST convert_completed /api/v2/job/{product}/completed?huidu=2.4.3     不签名(同源, best-effort)
        body = {job_id, completed_status, files[], resp_files, product_type, server_tag, client}

[9] GET  download        //icdcapi.wps.cn/api/v4/download/{jobId}/{fileId} 不签名(cookie)
        → arraybuffer (Range 头被注释, 真实实现不带)
```

**多文件变体**（merge / insert / photo2pdf / pic2word-excel-txt）：
- 对每个文件走 [1]–[5] 拿到 `{fileid, pages}` 列表
- 然后只跑一次 [6]–[9]，body 用 `files: [...]` 数组（结构见 §3.2）

---

## 2. 签名（同 NOTES.md 第三节）

```
POST /api/v1/sign?huidu=2.4.3
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
Body: method=...&contentType=...&date=...&uriPath=...&uriQuery=...

→ {data: rawToken}

WPSVASDevToken = "wpsvas:ksowebdcapi:" + accessKey + ":" + rawToken
X-Date         = sign 时用的 date (UTC GMT 字符串)
```

硬编码常量（来自 bundle，发版可能变）：
- `accessKey = 0faa630de5821d0f0ad9da865adbb80f`
- `huidu = 2.4.3`
- `serviceName = ksowebdcapi`
- `backupDomain = ["//icdcapi.wps.cn", "//dcapi3.wps.cn", "//dcapi3backup1.wps.cn"]`（cookie `ajax_domain` 切换）

`getWPSVASDevToken()` 实现（实测一致）：

```js
function getWPSVASDevToken(token) {
  return 'wpsvas:ksowebdcapi:' + accessKey + ':' + token;
}
```

---

## 3. 各产品 commit body 结构

### 3.1 单文件产品（用 `probe.js`）

| PRODUCT | commit body 关键字段（不含 fileid/password/editpassword/filename/labels 共用基底） |
|---|---|
| PDF2WORD | 可选 `engineid`（1004/1012），默认不传 |
| PDF2PPTX | (无附加) |
| PDF2XLSX | 可选 `toformat` + `export_params: {xlexport: {multi_sheet: true}}`（按 UI 选项）|
| PDF2PHOTO | `toformat: 'png' \| 'jpg' \| ...` |
| PDF2HTML | (无附加) |
| PDF2CAD | `toformat` (UI 选 dxf/dwg) |
| CAD2PDF | (无附加) |
| CAD2IMAGE | `toformat` |
| HTML2PDF | ⚠️ 实际是接 URL，可能不是上传文件 —— 未实跑确认 |
| WORD2PDF | (无附加) |
| PPT2PDF | (无附加) |
| EXCEL2PDF | (无附加) |
| WORD2LONGIMAGE | `toformat` |
| PPT2LONGIMAGE | `toformat` |
| PHOTO2WORD | `toformat` |
| PHOTO2TXT | (无附加) |
| PHOTO2EXCEL | `toformat` |
| PDFSPLIT | 见下 |
| PDFDELETEPAGES | 见下 |
| PDFENCRYPT | `newpassword` |
| PDFCHANGEPASSWORD | `newpassword` |
| PDFDECRYPT | (后端报错未跑通, bundle 也没专门 body, 推断与 encrypt 相同, newpassword='') |
| PDFADDWATERMARK | 见下 |
| PDFDELWATERMARK | (无附加) |
| PDFCOMPRESS | (无附加) |
| PDFOCRREPAIR | (无附加) |

### 3.2 多文件 / 分页参数产品

**PDFMERGE** (`/api/v4/multicommit/merge`)：
```json
{
  "targetname": "merged_filename",
  "files": [
    {"fileid": "...", "password": "", "editpassword": "", "pagefrom": 1, "pageto": 10},
    ...
  ]
}
```

**PDFINSERTPAGES** (`/api/v4/multicommit/insert`)：
```json
{
  "targetname": "...",
  "files": [
    {"fileid": "<主文件>", "password": "", "editpassword": "", "pagefrom": 1},
    {"fileid": "<被插入文件>", "password": "", "editpassword": "", "pages": "1-3"}
  ]
}
```

**PHOTO2PDF** (`/api/v4/multicommit/pic2pdf`)：
```json
{
  "targetname": "...",
  "files": [
    {"fileid": "img1", "password": "", "editpassword": ""},
    {"fileid": "img2", "password": "", "editpassword": ""}
  ]
}
```

**PDFSPLIT** (`/api/v4/commit/split`)：
- type 0 (按页数均分): `interval=N` + `pagefrom=1` + `pageto=<total>`
- type 1 (按区间): `pages="1,3-5,8"` （区间用逗号分隔）

**PDFDELETEPAGES** (`/api/v4/commit/delete`)：
- `pages` 支持：
  - 单页：字符串 `"5"`
  - 范围：字符串 `"1-3"`
  - 多区间：字符串 `"1,3-5,8"` （逗号分隔）

**PDFADDWATERMARK** (`/api/v4/commit/pdfaddwatermark`)：
- 文字水印：
  ```json
  { "watermark_type": "text", "content": "CONFIDENTIAL" }
  ```
- 图片水印（⚠️ 未实跑）：
  ```json
  { "watermark_type": "image", "image_fileid": "<已上传图片的 fileId>" }
  ```
  图片水印需要先把水印图通过 `uploadFile` 走一遍拿到 fileId（bundle line 10681-10683）。

### 3.3 跑通的多文件 pic2word/Excel/TXT 数据结构

**PHOTO2WORD / PHOTO2TXT / PHOTO2EXCEL**（多图）：
⚠️ 单图 ✅ 跑通；多图 commit 400，body 结构还需确认。**初步尝试**的 body：
```json
{
  "targetname": "...",
  "files": [{"fileid": "...", "password": "", "editpassword": ""}, ...]
}
```
被后端拒。后端可能期望用 `toformat` 或 `fileid` 单字段而不是 `files` 数组，需要在浏览器里多图上传一次抓真实请求。

---

## 4. 下载响应 / 文件名

`/api/v4/download/{convertJobId}/{fileId}` 返回 `arraybuffer`，**不是** zip 包装（除非本身是 PDF 拆/合并的 zip 输出）。

文件实际类型 / 大小 / MD5 在 query 响应的 `resp.files[0]` 里：
```json
{
  "id": "...",
  "name": "sample.docx",
  "size": 37491,
  "type": "docx",
  "md5": "...",
  "domain": "//icdcapi.wps.cn"
}
```

**特殊情形**：
- `PDF2PHOTO` 产物是 **zip 包含 PNG**（如 `sample.png` 列表里就一份），`file.type` 是 `zip`
- `PDFSPLIT` 产物是 **zip 包含多个 PDF**，文件名形如 `multipage_1.pdf`, `multipage_2.pdf`
- `PDFMERGE` 产物是单 PDF
- `WORD2LONGIMAGE` / `PPT2LONGIMAGE` 产物是单张 JPEG/PNG（`file.type` 是图片格式）

---

## 5. 客户端常量（必带，不参与签名）

```
Client-Chan: wps-web
Client-Lang: cn
Client-Type: wps-web
Client-Ver: 1.0.0
```

---

## 6. 复用与扩展点

### 6.1 已存在
- `convert.js`：方案 A 持久化 profile + 页面内 fetch，**仅**支持 `pdf2word` 等 `CONVERSIONS` 表里那 10 项（截至 2026-06-16）。
- `healthcheck.js`：跑最小 `convert.js` 自检登录态。
- `login.js`：扫码登录，登录态写到 `.profile/`。

### 6.2 本次新加（不影响 convert.js 已验证路径）
- `probe.js` —— **通用单文件探针**。任意 `PRODUCT`（包括 `PDF2WORD/PPT/XLSX/HTML/PHOTO/...`、`PDFSPLIT/DELETE/ENCRYPT/...`、`PDFADDWATERMARK/DELWATERMARK/...`、`WORD2LONGIMAGE/PPT2LONGIMAGE`、`PDFOCRREPAIR`）都能跑。
- `probe_multi.js` —— **多文件探针**。`PDFMERGE / PDFINSERTPAGES / PHOTO2PDF` 实测通过；`PHOTO2WORD/EXCEL/TXT` 多图记录但 body 需进一步确认。
- `/tmp/wps-probe-samples/` —— 标准测试样本（`sample.pdf` 多页，`sample.docx/xlsx/pptx`，`sample.png/jpg`，`sample-watermarked.pdf`，`multipage.pdf`）。

### 6.3 上层接入（pdf-portal）
- 已验证的 21 个产品用 `probe.js` 调；3 个多文件产品用 `probe_multi.js` 调。
- 入参 file 走 Node `fs.readFileSync` 喂 base64 字符串；在页面里转 `Uint8Array` 后上传。
- 所有产品都走相同的 `[1]–[9]` 骨架，差异只在 [6] commit body 的 `extra` 字段。
- 文档里所有 ⚠️ 项不要在生产用——只在确认无误后再启用。

---

## 7. 已知未完成 / 留白

- **CAD** 三种产品（cad2pdf / pdf2cad / cad2image）需要 DWG 样本才能跑通；本机无 AutoCAD，无法验证。
- **HTML2PDF** 后端可能需要传 `url` 字段（站点用 url 输入框），未确认；提交文件后端返 400/不返 id。
- **V5 API** 全套（`/api/v5/...`、`/api/v3/job/.../completed`）未实跑，V4 全功能覆盖且 V4 → V5 是渐进迁移，没有驱动需求。
- **PDFADDWATERMARK image 类型** 需要先上传水印图拿 fileid，未实跑。
- **PDFDECRYPT** UI 入口当前被注释（`navImg24` 在 `header.html` 里被 `<!-- -->` 包），是 niche 用例，未跑通。
- **PHOTO2WORD / EXCEL / TXT 多图** commit 400，body 结构需要更多样本（先单图）。后端可能期望的是单 fileId + `toformat` 字段 + 多次 upload（参考 bundle 中 `uploadFile` 多文件调用），需要真实跑一次抓请求。

---

## 8. 重新逆向入口（bundle 改版时）

```bash
# 1. 抓当前 bundle
curl -sL "https://ic-resources.wpscdn.cn/wps_statics/wps_pdf2word/web/2024071210/main.<时间戳>.js" -o bundle.js

# 2. 验证常量（accessKey / huidu）
grep -E 'accessKey|huidu' bundle.js | head -10

# 3. 列出所有 commit 端点
node -e 'const s=require("fs").readFileSync("bundle.js","utf8"); const i=s.indexOf("CONVERT_INIT:"); console.log(s.slice(i, i+3000))'

# 4. 列签名实现
node -e 'const s=require("fs").readFileSync("bundle.js","utf8"); const i=s.indexOf("callAPIBySign = function"); console.log(s.slice(i-30, i+1500))'
```

发现新端点时，往本文件 §3.1 加一行；同时根据 body 字段在 `probe.js` 顶部 `CONVERT_INIT/CONVERT_COMPLETE` 表里补 PRODUCT，再加 `--extra` 参数即可跑。
