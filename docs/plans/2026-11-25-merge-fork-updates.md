# DeskPark 分叉功能与修复合并计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 wanghlstar/DeskPark 的现有 main 上合入 Aertox 与 yeyinghai 的全部功能和修复，并验证合并后的项目。

**Architecture:** 保留现有 npm workspaces 和游戏插件接口，通过独立合并提交保存来源历史。按顺序合入两个 main 和 yeyinghai 的旧版 WebView 修复分支；处理 Android、文档及部署配置中与目标仓库相关的差异。

**Tech Stack:** TypeScript、React、Vite、Vitest、npm workspaces、Capacitor、GitHub Actions。

**Workspace:** `/Users/wanghlstar/Mytools/aiwork/DeskPark-merge`，分支 `fix/merge-fork-updates`；原始克隆保留在相邻的 `DeskPark/`。

---

### Task 1: 合并 Aertox

**Files:** `apps/web/src/screens/Home.tsx`、`apps/web/capacitor.config.ts`、`apps/web/package.json`、`package-lock.json`、`.gitignore`、`.prettierignore`、`eslint.config.js`、`docs/ANDROID_APK.md`、`docs/PORTING.md`。

1. 从 `origin/main` 创建 `fix/merge-fork-updates`。
2. 执行 `git merge --no-ff --no-commit aertox/main`，审查首页存档刷新与 Android 打包改动。
3. 执行 `npm ci` 和 `npm run check`，确认安装、lint、类型检查与测试通过。
4. 检查 `git status`、`git diff --cached` 与 `git log --oneline -10` 后，创建保留来源历史的合并提交。

### Task 2: 合并 yeyinghai/main

**Files:** `packages/engine/src/games/{heluo,shuangsheng,xiyouji}/`、对应引擎测试与 Web 牌桌、`apps/web/src/games/index.ts`、`packages/engine/src/index.ts`、`apps/web/src/lib/{appShell,speech,router}.ts`、`apps/web/src/screens/OnlineRoom.tsx`、`mobile/`、`.github/workflows/{android,docker}.yml`、相关文档。

1. 执行 `git merge --no-ff --no-commit yeyinghai/main`。
2. 合并两边的忽略规则与 Android 文档，保留各自打包入口，确认现有四川麻将导师仍然存在。
3. 执行 `npm run check`，验证新玩法的规则、整局模拟、语音及现有功能。
4. 审查并创建合并提交。

### Task 3: 合并 WebView 和 Android 构建修复

**Files:** `apps/web/vite.config.ts`、`apps/web/src/lib/coach/at-polyfill.ts`、`apps/web/src/lib/coach/local.worker.ts`、`apps/web/package.json`、`package-lock.json`、`mobile/package.json`、`.github/workflows/android.yml`、`CHANGELOG.md`、`README.md`。

1. 执行 `git merge --no-ff --no-commit yeyinghai/fix/old-webview`。
2. 保留后续 main 的文档和玩法，合入旧 WebView 语法与 API 兼容、sharp 和 Gradle 下载修复。
3. 审查新增的四川麻将 Worker 是否也需要兼容补丁，按实际运行依赖处理。
4. 检查 Android 服务器地址、应用标识、文档仓库与镜像地址是否适用于 wanghlstar/DeskPark，修正合并引入的配置差异。
5. 执行 `npm ci`、`npm run format:check`、`npm run check`、`npm run build`；针对实际发现的兼容性问题补充回归验证。
6. 检查完整差异、来源分支的祖先关系与工作区状态，创建合并提交并汇报验证结果及 Android 原生构建的实际覆盖范围。
