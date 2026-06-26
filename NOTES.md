# NOTES —— WPS 转换自动化实战调研笔记

> 用途：前端改版/接口失效时，给修复者（人或 Agent）的地图。
> 只记**动手验证过**的东西。首次端到端跑通：2026-05-28（pdf→docx 成功，产出合法 Word）。
> 2026-06-16 完成**全量接口逆向**：27 个产品端到端验证通过 22 个，详见 `API-FULL.md`（本文档的"接口 spec 续集"，速查表在 `API-FULL.md` §0）。

---

## 0. 一句话架构

`login.js` 扫码存登录态到 `.profile/` → `convert.js` 复用该 profile 打开 `pdf.wps.cn`，
**在页面里用 `fetch` 跑完整 REST 流程**。签名接口同源，业务接口跨域带 cookie。

为什么在页面内跑而不是纯 Node HTTP：核心登录凭证 `wps_sid` 是 HTTP-Only，
只有浏览器上下文能自动带上它。页面内 fetch 天然继承登录态，省掉手动导 cookie。

---

## 1. 逆向文档（wps-pdf-conversion-api.md）的**错误更正**

那份文档是静态读代码推断的，有几处与实测不符，**以本文件为准**：

| 文档说法 | 实测真相 |
|---|---|
| `getFileId()` 生成 base64 的 `file_id`，格式 `{md5}.pdf\|{path}` | **完全错误**。`getFileId()` 只是读 URL query 里的 `fileid` 参数（WebOffice 深链用）。`file_id` 字段 = 服务端上传响应返回的 `fileid` 原值，**没有任何客户端编码**。这是文档里被夸大成"最值钱最易碎"的一块——实际不存在。 |
| 签名接口在 `https://icdcapi.wps.cn/api/v1/sign` | 实际是**相对路径** `/api/v1/sign`，命中**页面同源** `https://pdf.wps.cn/api/v1/sign`（有反向代理）。`ajax()` 只对含 `dcapi` 的 URL 改写域名，sign 是相对路径不改写。 |
| download 要带 `Range: bytes=0-{size}` 头 | 源码里 Range 头**被注释掉了**，不需要。download 是 `GET /api/v4/download/{jobId}/{encodeURIComponent(fileId)}`。 |
| `backupDomains` 有 3 个域名 | 当前 bundle 里 `backupDomain` 只有 `["//icdcapi.wps.cn"]` 一个。 |
| 暗示所有业务请求都要签名 | **download 和两个 completed 不签名**，只靠 cookie。见下表。 |

---

## 2. 验证过的真实流程（pdf→docx，全部 200）

dump.json 实测步骤顺序（`node convert.js sample.pdf --to docx -o x.docx --dump dump.json`）：

```
upload_init      PUT  //icdcapi.wps.cn/api/v4/upload?md5=&size=&type=   签名  → {id:jobId, nextsize, fileid?}
upload_chunk     POST //icdcapi.wps.cn/api/v4/upload/{jobId}            签名  body=二进制分块, → {nextsize}
upload_end       PUT  //icdcapi.wps.cn/api/v4/upload/{jobId}            签名  → {fileid}
upload_completed POST /api/v2/job/upload/completed?huidu=2.4.3          不签名(同源) cookie
numberofpages    POST //icdcapi.wps.cn/api/v4/commit/numberofpages      签名
commit           POST //icdcapi.wps.cn/api/v4/commit/pdf2docx           签名  → {id:convertJobId}
query (轮询)     GET  //icdcapi.wps.cn/api/v4/query/{convertJobId}?time= 签名  → {progress, resp:{files,resultcode}}
convert_completed POST /api/v2/job/convert/completed?huidu=2.4.3        不签名(同源) best-effort
download         GET  //icdcapi.wps.cn/api/v4/download/{convertJobId}/{fileId} 不签名 cookie → arraybuffer
```

- **秒传**：`upload_init` 若直接返回 `fileid`（无 `id`），跳过 chunk/end，直接用该 fileId。
- **下载用的 fileId/size 来自轮询**：`resp.files[0].id` / `.size` / `.type`（不是上传的 fileId）。
- **下载 jobId = 转换 job id**（commit 返回的 `id`），不是上传 jobId。
- `progress===100 && resp.resultcode===0` 才算成功。

---

## 3. 签名机制（只 icdcapi 业务请求需要）

`callAPIBySign` 实测逻辑：
1. `signParams = {method, contentType, date(toUTCString GMT), uriPath(去query), uriQuery(query不含?)}`
2. `POST /api/v1/sign?huidu=2.4.3`，body 是 form-urlencoded 的上面五个字段，→ 响应 `{data: rawToken}`
3. 业务请求加两个头：
   - `WPSVASDevToken: wpsvas:ksowebdcapi:<accessKey>:<rawToken>`
   - `X-Date: <同一个 date>`

**易错点**：sign 里的 `date`/`uriPath`/`uriQuery`/`method`/`contentType` 必须和真实业务请求**完全一致**。
特别是 `X-Date` 头必须等于 sign 时用的 date；uriQuery 顺序要和 URL 里一致（`md5=&size=&type=` 这个顺序）。

硬编码常量（来自 bundle，发版可能变）：
- `accessKey = 0faa630de5821d0f0ad9da865adbb80f`
- `huidu = 2.4.3`
- `serviceName = ksowebdcapi`（拼在 token 里）
- Client 头：`Client-Type/Chan: wps-web`, `Client-Lang: cn`, `Client-Ver: 1.0.0`（不参与签名，值不敏感）

---

## 4. 易碎点地图（改版时先看这里）

| 易碎处 | 位置 | 变了的症状 | 怎么修 |
|---|---|---|---|
| bundle URL | `https://ic-resources.wpscdn.cn/wps_statics/wps_pdf2word/web/<日期>/main.<时间戳>.js` | 常量过期 | 用 `inspect.js` 重新抓页面里实际加载的 `main.*.js` |
| accessKey / huidu | bundle 里 `accessKey =` / `huidu =` | sign 报错/403 | curl 下 bundle，grep 这两个值，更新 convert.js 顶部常量 |
| 签名字段 | bundle `callAPIBySign` | 签名一直失败 | grep `callAPIBySign`，看 signParams 怎么拼、token 怎么拼 |
| 接口路径 | bundle `API_URL:` / `CONVERT_INIT:` / `CONVERT_COMPLETE:` 对象 | 404 | grep 这几个对象，更新 `CONVERSIONS` 表 |
| 请求体字段 | bundle 各 `var data = {` 处 | 接口返回参数错误 | grep `editpassword` 等找到 commit/completed body |
| wps_sid 失效 | **非定时过期**（见下）| sign/业务返回未登录 | 重新 `node login.js` 扫码（已带验活，失效自动清理后扫） |

**重新逆向的入口命令**（bundle 不压缩、带注释，可读性好）：
```bash
curl -s "<bundle_url>" -o bundle.js
# 关键函数都能直接 grep：callAPIBySign / getWPSVASDevToken / API_URL / CONVERT_INIT
node -e 'const s=require("fs").readFileSync("bundle.js","utf8"); const i=s.indexOf("callAPIBySign = function"); console.log(s.slice(i-30,i+2000))'
```

---

## 5. 还没验证 / 不确定的

- **大文件分片**：只验证了 25KB（单 chunk）。`nextsize` 驱动的多分块循环写了但没测过 >50MB。
- **V5 接口**：完全没碰。当前走 V4，全功能覆盖且验证可用，没必要上 V5。
- **会员次数上限**：当前账号会员有效期到 2027-06-04，转换无限次；过期后行为未知。
- **servertag cookie**：`upload_completed` body 里的 `server_tag` 从 `document.cookie` 读，若它是 HttpOnly 则读到空字符串——实测空值也能跑通，似乎不强依赖。

> **2026-06-16 全量逆向已完成**：上面四项之外，原"只验证过 pdf→docx"已扩展到 22 个产品。详见 `API-FULL.md`：
> - ✅ PDF→Word/PPT/Excel/HTML/图片、Word/Excel/PPT→PDF、图片→Word/Excel/TXT、Word/PPT→长图、图片→PDF
> - ✅ PDF 合并/拆分/压缩/加密/改密/删页/插页/删水印/字体修复
> - ✅ PDF 加水印（text 类型）
> - ⚠️ 仍留白：CAD 三种（无 DWG 样本）、HTML2PDF（body 结构需重抓）、PDF 加水印 image 类型（需先上传水印图）、PDF 解密（UI 入口被注释）、PHOTO2WORD/EXCEL/TXT 多图 body（多文件 commit 400）、V5 全套（V4 够用没必要上）

---

## 6. 测试方法

```bash
# 造一个真实多页 PDF（太小的文件会卡在"分析中"，必须有真实内容）
cupsfilter sample.txt > sample.pdf
node convert.js sample.pdf --to docx -o out.docx --dump dump.json
# 验证：file out.docx 应为 "Microsoft Word 2007+"；unzip -p out.docx word/document.xml 看正文
```

---

## 7. 登录态寿命与保活（2026-06-15 实测更正）

**"wps_sid 3 天过期"是误传，实测不成立。** `wps_sid` 是一年期 cookie（建立日 +1 年，实测到期 2027-05-28），且每成功转换一次就被回写续期——**只要有人用就自然保鲜**，闲置 17 天后仍能转换，不会自己死。

真正的失效来自**不可预测**事件：WPS 风控踢登录、改密/手动登出/多端互踢、或一年后绝对到期。定时"续命"救不了这些，关键是**主动探活**：

`node healthcheck.js [--notify]` 造最小 PDF → 调 convert.js 转 docx → 据结果判健康度，一次覆盖登录态 + 签名常量 + 接口未改版，并顺带续期。退出码 **0**=健康 / **2**=登录态失效 / **1**=非登录故障（疑似改版）；失败隔 20s 重试一次抗抖动。挂 launchd/cron 每天跑 `--notify` 即可失效预警；`login.js` 启动也复用它做端到端验活（光看 sid 是否存在会假阳性）。
