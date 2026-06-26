# WPS PDF 在线服务 API 完整规格（实测版）

> 逆向目标：<https://pdf.wps.cn>（后端 `icdcapi.wps.cn`）。抓 bundle / 实测时间 2026-06-16。
>
> 本文件是 `NOTES.md` 的**接口续集**：架构、完整流程、签名机制、易碎点地图、重新逆向入口都在 `NOTES.md`，这里只列**每个产品的端点与 commit body**。
> 只记**有实测证据**的接口；未跑通的明确标 ⚠️，绝不与已通过的混在一起。表中 `convert.js` 指仓库内脚本；`probe` 指逆向期用过的一次性探针（已不在仓库），保留仅作实测证据。

---

## 0. 速查表（每个产品 × 验证状态）

✅ = 已端到端跑通 + 产物校验合法　|　⚠️ = 拿到路径/字段但未在真实场景验证

| 接口（站点 URL） | 内部 API 端点 | 验证 | 样本 / 产物 |
|---|---|---|---|
| PDF→Word /pdf2word | `POST /api/v4/commit/pdf2docx` | ✅ | `convert.js` 验证，docx 合法 |
| PDF→PPT /pdf2ppt | `POST /api/v4/commit/pdf2pptx` | ✅ | 产物 Microsoft PowerPoint 2007+ |
| PDF→Excel /pdf2excel | `POST /api/v4/commit/pdf2xlsx` | ✅ | 产物 Microsoft Excel 2007+ |
| PDF→HTML /pdf2html | `POST /api/v4/commit/pdf2html` | ✅ | 产物 zip（HTML+资源） |
| PDF→图片 /pdf2photo | `POST /api/v4/commit/pdf2pic` | ✅ | 产物 zip（含 PNG） |
| Word→PDF /word2pdf | `POST /api/v4/commit/docx2pdf` | ✅ | 产物 PDF 1.7 |
| Excel→PDF /excel2pdf | `POST /api/v4/commit/xlsx2pdf` | ✅ | 产物 PDF 1.7 |
| PPT→PDF /ppt2pdf | `POST /api/v4/commit/pptx2pdf` | ✅ | 产物 PDF 1.7 |
| HTML→PDF /html2pdf | `POST /api/v4/commit/html2pdf` | ⚠️ | 路径已抓到，提交文件后端未返回 jobId（body 可能需 `url`/`content` 而非上传文件） |
| 图片→PDF /photo2pdf | `POST /api/v4/multicommit/pic2pdf` | ✅ | 多文件，PNG+JPG→PDF 1.7 |
| CAD→PDF /cad2pdf | `POST /api/v4/commit/cad2pdf` | ⚠️ | 路径已抓到，无 DWG 样本 |
| PDF→CAD /pdf2cad | `POST /api/v4/commit/pdf2cad` | ⚠️ | 同上 |
| CAD→图片 /cad2image | `POST /api/v4/commit/cad2image` | ⚠️ | 同上 |
| 图片→Word /photo2word | `POST /api/v4/commit/pic2word` | ✅（单图）/ ⚠️（多图） | 单图 docx 合法；多图 commit 400，body 待确认 |
| 图片→文字 /photo2txt | `POST /api/v4/commit/pic2txt` | ✅ | OCR 识别出测试图文字 |
| 图片→Excel /photo2excel | `POST /api/v4/commit/pic2excel` | ✅（单图）| 单图 xlsx 合法 |
| Word→长图 /word2longimage | `POST /api/v4/commit/docx2longimage` | ✅ | 产物 JPEG 816x1056 |
| PPT→长图 /ppt2longimage | `POST /api/v4/commit/pptx2longimage` | ✅ | 产物 JPEG 1279x2880 |
| **PDF 操作类** | | | |
| 合并 /merge2pdf | `POST /api/v4/multicommit/merge` | ✅ | 2 份 PDF 合并，pages 1+1→2 |
| 拆分 /split | `POST /api/v4/commit/split` | ✅ | `pages "1,2"` 4 页拆出 2 个 PDF（zip） |
| 压缩 /compress | `POST /api/v4/commit/pdfoptimize` | ✅ | 38KB→22KB |
| 加密 /encrypt | `POST /api/v4/commit/encrypt` | ✅ | `newpassword`，pypdf 报 "not been decrypted" |
| 改密 /changepw | `POST /api/v4/commit/pdfchangepassword` | ✅ | 同上加密成功 |
| 解密 /decrypt | `POST /api/v4/commit/pdfdecrypt` | ⚠️ | 路径已抓到，UI 入口被注释；niche 用例未跑通 |
| 删页 /delete | `POST /api/v4/commit/delete` | ✅ | `pages "1"`，4 页→3 页 |
| 插页 /insert | `POST /api/v4/multicommit/insert` | ✅ | 1+1→2 页 |
| 加水印 /addwatermark | `POST /api/v4/commit/pdfaddwatermark` | ✅（text） / ⚠️（image） | `watermark_type:"text"` 跑通；image 需先传水印图 |
| 删水印 /delwatermark | `POST /api/v4/commit/pdfdelwatermark` | ✅ | 38KB→16KB |
| 字体修复 /pdf2wordpreview | `POST /api/v4/commit/pdfocrrepair` | ✅ | 可提取字符数 5021→9961 |
| **辅助接口** | | | |
| 上传 init | `PUT //icdcapi.wps.cn/api/v4/upload?md5=&size=&type=` | ✅ | 见 NOTES.md 流程 |
| 上传 chunk | `POST //icdcapi.wps.cn/api/v4/upload/{jobId}` | ✅ | 见 NOTES.md |
| 上传 end | `PUT //icdcapi.wps.cn/api/v4/upload/{jobId}` | ✅ | 见 NOTES.md |
| 上传完成（同源） | `POST /api/v2/job/upload/completed?huidu=2.4.3` | ✅ | 见 NOTES.md |
| 页数 | `POST //icdcapi.wps.cn/api/v4/commit/numberofpages` | ✅ | 见 NOTES.md |
| 轮询 | `GET //icdcapi.wps.cn/api/v4/query/{jobId}?time=` | ✅ | 见 NOTES.md |
| 转换完成（同源） | `POST /api/v2/job/convert/completed?huidu=2.4.3` | ✅ | best-effort |
| 下载 | `GET //icdcapi.wps.cn/api/v4/download/{jobId}/{fileId}` | ✅ | 见 NOTES.md |
| 取消 | `DELETE //icdcapi.wps.cn/api/v4/cancel/{jobId}` | ⚠️ | 路径已抓到，未实跑 |
| 签名 (V4) | `POST /api/v1/sign?huidu=2.4.3` | ✅ | 见 NOTES.md §3 |
| 签名 (V5) | `POST /api/v2/sign?huidu=2.4.3` | ⚠️ | 路径已抓到；V5 全套未实跑（只走 V4） |
| 用户信息 | `GET /api/v1/user?huidu=2.4.3` | ✅ | 健康检查隐式使用 |

> 其余只抓到路径、未实跑的只读接口（logout / privilege / job status / summary 等）略，需要时按 §3 重新逆向入口自查。

---

## 1. 各产品 commit body 结构

> 共用基底字段：`fileid` / `password` / `editpassword` / `filename` / `labels`。下表只列**附加**字段（通过 `convert.js --extra '<json>'` 注入到 commit body 顶层）。

### 1.1 单文件产品

| PRODUCT | commit body 附加字段 |
|---|---|
| PDF2WORD | 可选 `engineid`（1004/1012），默认不传 |
| PDF2PPTX / PDF2HTML | （无附加） |
| PDF2XLSX | 可选 `toformat` + `export_params:{xlexport:{multi_sheet:true}}` |
| PDF2PHOTO | `toformat: 'png' \| 'jpg' \| ...` |
| PDF2CAD / CAD2IMAGE | `toformat`（UI 选 dxf/dwg） |
| CAD2PDF / WORD2PDF / PPT2PDF / EXCEL2PDF | （无附加） |
| HTML2PDF | ⚠️ 实际可能接 URL 而非上传文件，未实跑确认 |
| WORD2LONGIMAGE / PPT2LONGIMAGE | `toformat` |
| PHOTO2WORD / PHOTO2EXCEL | `toformat` |
| PHOTO2TXT | （无附加） |
| PDFENCRYPT / PDFCHANGEPASSWORD | `newpassword` |
| PDFDECRYPT | ⚠️ 后端报错未跑通，推断同 encrypt（`newpassword=''`） |
| PDFDELWATERMARK / PDFCOMPRESS / PDFOCRREPAIR | （无附加） |
| PDFSPLIT / PDFDELETEPAGES / PDFADDWATERMARK | 见 §1.2 |

### 1.2 分页 / 水印参数

**PDFSPLIT** (`/api/v4/commit/split`)：
- type 0（按页数均分）：`interval=N` + `pagefrom=1` + `pageto=<total>`
- type 1（按区间）：`pages="1,3-5,8"`（区间逗号分隔）

**PDFDELETEPAGES** (`/api/v4/commit/delete`)：`pages` 支持单页 `"5"` / 范围 `"1-3"` / 多区间 `"1,3-5,8"`。

**PDFADDWATERMARK** (`/api/v4/commit/pdfaddwatermark`)：
- 文字水印：`{ "watermark_type": "text", "content": "CONFIDENTIAL" }`
- 图片水印（⚠️ 未实跑）：`{ "watermark_type": "image", "image_fileid": "<已上传图片的 fileId>" }`，需先把水印图走一遍 upload 拿 fileId。

### 1.3 多文件产品（convert.js 不支持，body 在此备查）

`convert.js` 只跑单文件 commit。合并 / 插页 / 图片→PDF 走 `multicommit`，body 用 `files:[...]` 数组：

**PDFMERGE** (`/api/v4/multicommit/merge`)：
```json
{ "targetname": "merged", "files": [
  {"fileid":"...","password":"","editpassword":"","pagefrom":1,"pageto":10}
]}
```

**PDFINSERTPAGES** (`/api/v4/multicommit/insert`)：
```json
{ "targetname":"...", "files": [
  {"fileid":"<主文件>","password":"","editpassword":"","pagefrom":1},
  {"fileid":"<被插入>","password":"","editpassword":"","pages":"1-3"}
]}
```

**PHOTO2PDF** (`/api/v4/multicommit/pic2pdf`)：
```json
{ "targetname":"...", "files": [
  {"fileid":"img1","password":"","editpassword":""},
  {"fileid":"img2","password":"","editpassword":""}
]}
```

每个文件先各自走完整上传流程拿 `fileid`，再只跑一次 commit→query→download。

⚠️ **PHOTO2WORD / PHOTO2EXCEL / PHOTO2TXT 多图**：单图 ✅；多图用上面 `files` 数组 commit 返回 400，后端可能期望单 `fileid` + `toformat` + 多次 upload，需真实多图上传抓一次请求确认。

---

## 2. 下载响应 / 文件名

`/api/v4/download/{convertJobId}/{fileId}` 返回 `arraybuffer`。文件实际类型/大小/MD5 在 query 响应的 `resp.files[0]` 里（**下载用的是这里的 fileId，不是上传的**）：

```json
{ "id":"...", "name":"sample.docx", "size":37491, "type":"docx", "md5":"...", "domain":"//icdcapi.wps.cn" }
```

产物形态：
- `PDF2PHOTO` → zip（含 PNG），`file.type` 为 `zip`
- `PDFSPLIT` → zip（多个 PDF，名如 `multipage_1.pdf`）
- `PDFMERGE` → 单 PDF
- `WORD2LONGIMAGE` / `PPT2LONGIMAGE` → 单张 JPEG/PNG

---

## 3. 已知未完成 / 留白

- **CAD** 三种（cad2pdf / pdf2cad / cad2image）：需 DWG 样本，本机无 AutoCAD 无法验证。
- **HTML2PDF**：后端可能需传 `url` 字段，未确认；提交文件返 400/不返 id。
- **V5 API**：全套未实跑。V4 全功能覆盖，无迁移驱动。
- **PDFADDWATERMARK image 类型**：需先上传水印图拿 fileid，未实跑。
- **PDFDECRYPT**：UI 入口被注释（`navImg24`），niche 用例未跑通。
- **PHOTO2WORD / EXCEL / TXT 多图**：commit 400，body 结构待更多样本（见 §1.3）。
