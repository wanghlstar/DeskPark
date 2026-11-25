# Android APK 打包指南

本文介绍如何通过 Capacitor 在本地生成 Android 工程并构建调试 APK。Android 工程不提交到仓库；Capacitor 配置和依赖保留在项目中。Web 资源会随 APK 打包；普通单人对局不需要联机服务器，联机对局和云端 AI 功能需要相应的网络服务。

## 使用已发布的 APK

在 [Releases](https://github.com/wanghlstar/DeskPark/releases) 下载 APK，安装后：

1. 打开 **大厅 → 设置 → 联机服务器**。
2. 填写完整的 DeskPark 服务地址，例如 `http://192.168.2.8:8787`。飞牛自定义端口如为 `18878`，填写 `http://192.168.2.8:18878`；这是游戏地址，不是模型的 `/v1` 接口地址。
3. 点击「测试服务器」，成功后「保存并刷新」。也支持只填 `192.168.2.8:18878` 或粘贴 `ws://192.168.2.8:18878/ws`。
4. 联机创建房间，好友在自己的 APK 中填写同一地址、输入房间号，或在浏览器打开邀请链接。选择「服务器默认」AI 时，会读取这个服务器后台设置的模型。

地址保存在本机，重启 APK 后继续使用。保存会关闭旧联机连接并刷新页面，单人存档、昵称和个人 AI 配置保留。留空并保存可恢复安装包预设；没有预设时仍可使用内置单人游戏。手机和好友必须能访问所选服务器（同局域网、组网或可访问的域名）。

运行时选择的服务器优先于构建参数，并继续使用 APK 内置页面；更新内置游戏需更新 APK。Android 网络配置支持自建局域网的 HTTP / WS，保留原有 HTTPS 本地页面 origin；有域名与证书时可直接填 HTTPS。

背景音乐也内置在 APK 中，离线可播放。首次点击后小音量播放，在大厅「设置」或牌桌「外观」里可单独关闭、调节音量；切到后台暂停，回到前台恢复。出牌音效与报牌语音仍由原来的「音效」开关控制。

## 准备环境

- Node.js 22 和 npm：仓库的 `.nvmrc` 指定了 Node.js 22。运行 `node -v` 和 `npm -v` 确认当前终端使用的版本。
- Android Studio 和 Android SDK：安装 Android SDK Platform 36、Build Tools 和 Platform-Tools。首次运行 Gradle 时可能需要下载 Gradle、构建依赖和缺失的 SDK 组件，并接受 SDK 许可证。
- JDK 21：可使用 Android Studio 自带的 JDK。运行 `java -version` 确认版本，并确保 Gradle 使用相同的 JDK。
- Android 设备或模拟器：当前工程的最低版本为 Android 7.0（API 24）。

以下命令以 macOS / Linux 终端为例，除特别说明外均在仓库根目录执行。macOS 如需指定 Android Studio 自带的 JDK，可在当前终端运行：

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

如 Gradle 找不到 Android SDK，请设置 `ANDROID_HOME` 指向实际 SDK 目录，或在 Android Studio 中配置 SDK 路径。例如 macOS 的常见位置：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

## 生成工程并构建调试 APK

首次安装或更新依赖：

```bash
npm ci
```

首次使用时，在仓库根目录生成 Android 工程：

```bash
cd apps/web
npx cap add android
cd ../..
```

这一步仅在 `apps/web/android` 不存在时执行。已生成的工程不要重复执行 `cap add`；其中的原生改动只保存在本机。

构建 Web 资源并同步到 Android 工程：

```bash
npm run android:sync -w @park/web
```

安装后可在设置里指定服务器，无需重打包。若希望给测试包提供默认地址，可在**同步之前**指定完整的 WebSocket 地址；用户设置优先于此构建默认值：

```bash
VITE_SERVER_URL=wss://你的域名/ws npm run android:sync -w @park/web
```

构建 APK：

```bash
cd apps/web/android
./gradlew assembleDebug
```

成功后，APK 位于仓库内：

```text
apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

每次修改 Web 代码后，都要重新执行 `android:sync`，再执行 Gradle 构建；否则 APK 中仍是上次同步的资源。Android Studio 中也可以打开 `apps/web/android` 工程进行构建和调试。

## 安装到设备

在手机上启用开发者选项和 USB 调试，连接电脑并在手机上确认授权。在仓库根目录执行：

```bash
adb devices -l
adb install -r apps/web/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.deskpark/.MainActivity
```

`adb devices -l` 应显示设备状态为 `device`；如果是 `unauthorized`，请解锁手机并确认 USB 调试授权。连接多台设备时，在 `adb` 后加 `-s 设备序列号`，例如 `adb -s 设备序列号 install -r ...`。`-r` 会尝试保留应用数据并覆盖安装；如果设备上已有相同应用 ID 但签名不同的应用，安装会失败，需要先确认如何处理现有应用及其数据。

## 当前测试包的边界

- 应用 ID 为 `com.example.deskpark`，显示名称为「闲亭」。新生成的工程使用 Capacitor 默认图标和启动画面；本机现有工程中的亭子标识不会随源码提交或自动恢复，需要自行保存并重新配置。
- `assembleDebug` 使用调试签名，仅供开发和测试。正式发布需要确定唯一的应用 ID、版本号、图标、签名及发布渠道要求。
- 未设置 `VITE_SERVER_URL` 时，可在大厅设置中填写服务器地址；尚未填写时仍可单人游戏。单人功能、棋类引擎、横竖屏、局域网连接和后台恢复仍应在目标设备上实际验证。
- 修改应用 ID、签名或安装来源可能影响覆盖安装和本地数据的保留；正式发布前应确定这些配置。
- 因 Android 工程不纳入版本控制，图标、启动画面、插件和签名等原生修改需要单独备份并在新工程中重新配置；不要提交签名密钥或密码。
