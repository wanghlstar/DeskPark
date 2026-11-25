# Server Default AI Implementation Plan

> **For Claude:** Use the executing-plans workflow to implement and verify each step.

**Goal:** 飞牛可选配服务器默认 AI，网页明确选择服务器默认或自己的配置。

**Architecture:** 部署者通过安装向导或应用设置填写协议、完整接口地址、Key 和模型。服务端只公开是否配置及协议、模型；默认调用使用服务端固定地址、模型和鉴权。网页保留自定义配置及独立的服务器转发开关，默认模型的 Key 不下发。

**Tech Stack:** TypeScript、React、Node.js、Vitest、飞牛向导、fnpack、GitHub Actions。

---

1. 在 `apps/server/test/aiProxy.test.ts` 添加默认模型配置、真实 HTTP/Anthropic 转发、鉴权保密及禁止覆盖的测试，确认旧实现失败；实现 `apps/server/src/aiProxy.ts` 的只读配置和默认调用路径。
2. 在 `apps/web/test/ai-config.test.ts` 验证来源选择、旧自定义配置、缺省服务配置和请求凭据；更新 AI 设置、客户端与设置页，启动及打开设置时读取服务器配置。
3. 补齐 `packaging/fnos/wizard/install`、`wizard/config` 的可选协议、地址、密码 Key、模型字段，沿用已发布的地址字段；通过生命周期环境变量传递配置，补充真实 FPK 集成验证。
4. 更新应用说明、网页帮助和部署文档，说明应用中心 → 闲亭 DeskPark → 设置的入口，以及转发和配置来源的区别。FPK 升级至 `0.3.2`。
5. 运行 `npm run format:check`、`npm run check`、`npm run build:fpk`，使用浏览器验证服务器默认、自定义和未配置状态，检查包结构与校验文件。
6. 审查并提交改动，通过 Actions 发布 `v0.3.2-alpha.1`，下载 FPK/APK 并核对 SHA-256，不改动已有 Alpha 标签。
