# 开发指南

## 目录

```text
src/host/      宿主：服务、API、音频、ASR、术语、reader
src/client/    浏览器：controller、panel、reader、dock
src/win-audio/ Windows WASAPI helper（C#/NAudio）
lib/           构建产物 client.js
assets/        术语、内置 helper、VAD、图标
test/          Node 测试
scripts/       构建、术语、打包校验、文档检查
docs/          文档
```

## 命令

```bash
pnpm install
pnpm build
pnpm test
pnpm verify-package
pnpm verify-python
node scripts/check-docs.mjs
pnpm pack
```

## Windows helper

Windows 系统音频 helper 使用 C#/.NET 8 + NAudio WASAPI loopback，源码在 src/win-audio。

```powershell
pnpm build:win-audio
```

等价于：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-win-audio.ps1
```

要求：
- .NET 8 SDK；
- Windows x64；
- 生成的 dsh-asr-capture-system.exe 位于 assets/system-audio/win32-x64。

GitHub CI 的 windows-helper job 会构建并运行 standalone 测试；Release 的 package-windows job 会把它打进 win32-x64 tarball。

## 开发模式

```bash
pnpm dev
```

客户端 bundle 改动后需要刷新 DSH 页面；宿主代码改动需要重载插件。

## 测试

- service/live/streaming/terminology/term-e2e/text/audio/reader/standalone/platform；
- reader-render：DOCX/XLSX/PPTX 与 .doc 兜底，macOS/Windows 需要 Python 3.12；
- 测试不依赖真实麦克风；
- 无 .models 时模型测试自动跳过；
- 干净环境可用临时 profile 安装 tarball 验证。

## 发布

1. 更新版本与 CHANGELOG；
2. pnpm install / build / test / verify-package / check-docs；
3. macOS/generic：pnpm pack；
4. Windows：build:win-audio 后 pnpm pack，并重命名为 win32-x64；
5. 创建 v* tag；
6. GitHub Actions Release 上传双平台包与 sha256。

## 代码约定

- 不修改 DSH core；
- 音频、ASR、翻译、RAG 改动必须补测试；
- 讲义文件读取只通过上传后的 id，不读取任意路径；
- 客户端不直接拼接未转义 HTML；
- Windows helper 保持与 macOS helper 相同的输出契约：1 秒 *-system.wav、PCM16。
