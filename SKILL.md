---
name: wps-convert
description: 用 WPS 在线服务做 PDF/Office 文档格式转换（PDF↔Word/PPT/Excel/HTML 等）。当用户要转换文档格式、把 PDF 转成可编辑文件、或反过来导出 PDF 时使用。
---

# WPS 文档格式转换

传文件路径 + 目标格式，拿到结果文件。脚本会在后台起一个浏览器，
但**只用它维持登录态**，转换是直接调 WPS 的 API 完成的——不点任何网页 UI。
所以比用 Playwright/browser 工具一步步点（选文件、等上传、轮询页面）快且稳。

## 何时用

用户需要在以下格式之间转换文档时：
- PDF → Word(docx) / PPT(pptx) / Excel(xlsx) / HTML
- Word(docx/doc) / PPT(pptx/ppt) / Excel(xlsx/xls) → PDF

## 怎么用

一条命令（在 `wps-convert/` 目录下）：

```bash
node convert.js <输入文件> --to <目标格式> -o <输出文件>
```

例：
```bash
node convert.js 报告.pdf --to docx -o 报告.docx
node convert.js 合同.docx --to pdf -o 合同.pdf
```

- 成功：结果写到 `-o` 路径，退出码 0。
- 失败：stderr 打印原因，退出码非 0。
- 排查时加 `--dump dump.json` 会把每步请求/响应记下来。

支持的 `--to`：`docx` / `pptx` / `xlsx` / `html` / `pdf`（取决于源文件类型，见 convert.js 里的 `CONVERSIONS` 表）。

## 登录过期怎么办

转换报"未登录 / sign 失败"时，登录态过期了（cookie 约 3 天有效）。
让用户运行下面命令，扫码重新登录：

```bash
node login.js
```

会弹出浏览器，扫码后登录态自动存回 `.profile/`，之后 convert 即可恢复。

## 坏了怎么修

WPS 前端改版可能导致脚本失效。修复地图见 `NOTES.md`——
里面有验证过的真实流程、签名机制、以及"哪里最可能变、变了先看哪/怎么重新逆向"的易碎点地图。
