# wps-convert

用命令行调用 WPS 在线服务做文档格式转换：PDF ↔ Word / PPT / Excel / HTML。

```bash
node convert.js 报告.pdf --to docx -o 报告.docx
node convert.js 合同.docx --to pdf  -o 合同.pdf
```

## 它是怎么工作的（以及没做什么）

核心思路是 **借壳，而不是破解**：

- 起一个 Playwright 浏览器，**只用来维持登录态**（扫码登录后持久化到 `.profile/`）；
- 真正的转换是在已登录页面里直接 `fetch` 调 WPS 的 REST API 完成的，**不点任何网页按钮**——比一步步驱动 UI（选文件、等上传、轮询页面）更快也更稳；
- **不破解签名算法**：请求签名是调 WPS 自己同源的 `/api/v1/sign` 接口让服务端帮算的。所以 WPS 哪天改了签名算法，这里也不用动。

这套"绕过而非破解"的取舍，逆向过程、验证过的完整流程、以及"哪里最易碎、变了先看哪"的修复地图，都记在 [`NOTES.md`](NOTES.md) 里——那是这个项目最值钱的部分。接口字段细节见 [`API-FULL.md`](API-FULL.md)。

## 前置条件

- Node.js 18+
- 一个 **WPS 会员账号**（转换额度由账号决定；免费账号能力受限）
- 首次使用需扫码登录

## 用法

```bash
npm install                 # 装 playwright
npx playwright install chromium

node login.js               # 扫码登录，登录态存到 .profile/
node convert.js <输入文件> --to <目标格式> -o <输出文件>
```

- 成功：结果写到 `-o` 路径，退出码 0；失败：stderr 打印原因，退出码非 0。
- 排查加 `--dump dump.json`，会把每步请求/响应记下来。
- `--extra '<json>'` 可向 commit 体注入附加字段（水印、加密、页码范围等），见 `convert.js` 注释。

支持的方向取决于源文件类型，见 `convert.js` 里的 `CONVERSIONS` 表。

## 登录过期

报"未登录 / sign 失败"时重新扫码：`node login.js`。`healthcheck.js` 是配套的登录态探活脚本，可挂到 launchd/cron 做主动预警（`wps_sid` 实测约一年期，但风控踢登录、改密、多端互踢等会随时失效，见 NOTES §7）。

## 声明

仅供学习与自动化**你自己的、已授权的 WPS 账号**使用。请遵守 WPS 服务条款；不要用于抓取或转换他人数据。本项目不含任何账号凭证——`.profile/` 等登录态文件已被 `.gitignore` 排除，请勿提交。

## License

[MIT](LICENSE)
