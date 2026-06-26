---
name: wps-convert
description: 用 WPS 在线服务做 PDF/Office 文档格式转换（PDF↔Word/PPT/Excel/HTML 等）。当用户要转换文档格式、把 PDF 转成可编辑文件、或反过来导出 PDF 时使用。
---

# WPS 文档格式转换

一条命令把文件转成目标格式。脚本在后台起浏览器**只为维持登录态**，转换直接调 WPS 的 API 完成——不点任何网页 UI，比驱动浏览器逐步操作快且稳。

## 用法

在 `wps-convert/` 目录下：

```bash
node convert.js <输入文件> --to <目标格式> -o <输出文件>
```

例：

```bash
node convert.js 报告.pdf --to docx -o 报告.docx
node convert.js 合同.docx --to pdf  -o 合同.pdf
```

- `--to`：`docx` / `pptx` / `xlsx` / `html` / `pdf`（方向取决于源文件类型，全表见 convert.js 的 `CONVERSIONS`）。
- 成功：结果写到 `-o`，退出码 0；失败：stderr 打印原因，退出码非 0。
- 排查：加 `--dump dump.json` 记录每步请求/响应。

## 首次使用 / 环境未就绪

第一次用，或报 `Cannot find module 'playwright'`、浏览器缺失时，在 skill 目录跑一次：

```bash
npm install && npm run setup
```

`npm run setup` 会下载 chromium 并弹出登录窗口——让用户用手机 WPS 扫一次二维码（登录态存到 `.profile/`，实测约一年有效）。完成后直接用上面的转换命令。

## 报"未登录 / sign 失败"

登录态失效了。让用户跑 `node login.js` 扫码重登（登录态存回 `.profile/`）。`wps_sid` 实测约一年有效，且每次转换会自动续期——不是定时过期；真正失效来自风控踢登录、改密、多端互踢等。

## 转换报错但不是登录问题

多半是 WPS 前端改版。修复地图见 `NOTES.md`：验证过的真实流程、签名机制、"哪里最易碎 / 怎么重新逆向"。
