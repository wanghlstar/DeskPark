# 飞牛 fnOS 应用包

DeskPark 提供原生 FPK，安装包包含完整网页和联机服务器，依赖飞牛应用中心的 **Node.js 22**（`nodejs_v22`）。服务以专用应用用户运行，同一包可用于 x86 和 ARM 设备。

## 下载与安装

1. 打开仓库的 [fnOS FPK 工作流](https://github.com/wanghlstar/DeskPark/actions/workflows/fnos.yml)，选择一次成功的构建，在 Artifacts 下载 `deskpark-fnos`。
2. 解压后得到 `deskpark-0.3.0.fpk` 和对应的 `.sha256`。构建使用项目版本号，后续版本的文件名会随之更新。
3. 在飞牛应用中心使用手动安装，选择 `.fpk`，按提示安装 Node.js 22 依赖。
4. 在「设置访问端口」步骤填写服务端口，默认 **8787**，可选 **1024–65535** 之间未被占用的端口，完成安装并启动应用。
5. 点击「闲亭 DeskPark」桌面图标，或用浏览器访问 `http://飞牛IP:填写的端口`。例如填写 `18878`，则访问 `http://飞牛IP:18878`。其他设备访问同一地址即可创建、加入联机房间。

FPK 使用官方 fnpack 的 `--nosign` 生成，供手动安装测试，尚未作为签名应用上架应用中心。请在支持第三方应用手动安装的飞牛版本上测试；本项目尚未完成飞牛实机安装验证。

安装向导会校验端口格式与范围，服务启动时还会检查选定端口是否被占用。端口由飞牛保存为向导配置，服务在重启后继续使用该值；桌面入口会打开同一端口的新浏览器标签页。需要 HTTPS 或外网访问时，可将自己的反向代理指向所选端口，并转发 `/ws` 的 WebSocket 连接，详见 [部署指南](./DEPLOY.md)。

## 启停与数据

- 飞牛应用中心的启动、停止和运行状态由 `cmd/main` 管理；启动会检查端口和 `/healthz`。
- 日志写入 `${TRIM_PKGVAR}/deskpark.log`，PID 写入同目录的 `deskpark.pid`。通常可通过 `/var/apps/deskpark/var/` 查找。
- 单人存档、设置和 AI 配置保存在各设备浏览器中；卸载或升级 FPK 不会主动清理这些浏览器数据。
- 联机房间保存在服务进程内存中，停止或升级应用会结束当前联机房间。
- 包内不含运行时安装依赖的步骤；网页和联机服务器随包安装，Node.js 运行时由飞牛管理。

## 构建

仓库的 **fnOS FPK** Actions 工作流支持推送 main、Pull Request、`v*` 标签和手动运行，依次执行格式检查、lint、类型检查、规则测试、生产构建、FPK 服务测试和打包。测试产物包含 FPK 与 SHA-256，可在 Artifacts 下载。

本地打包适用于 macOS / Linux。先安装 Node.js 22 和官方 [fnpack 1.3.3](https://developer.fnnas.com/docs/cli/fnpack/)，再运行：

```bash
npm ci
npm run build:fpk
```

如果 fnpack 不在 PATH 中，可以通过 `FNPACK` 指定可执行文件：

```bash
FNPACK=/你的路径/fnpack npm run build:fpk
```

产物位于 `dist/fnos/`。脚本会构建网页和服务端，将运行文件复制到 `dist/fnos/package/`，执行真实服务的生命周期与 WebSocket 测试后再打包。不会在本机安装飞牛应用或修改系统服务。

首次部署到飞牛后，请检查：安装向导可填写端口、应用能启动、桌面入口打开所填端口、两台设备能加入同一房间、停止后所选端口释放，以及重新启动后仍使用同一端口。
