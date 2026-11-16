# 开发指南

## 目录

```text
src/host/      宿主：服务、API、音频、ASR、术语、reader
src/client/    浏览器：controller、panel、reader、dock
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
node scripts/check-docs.mjs
pnpm pack
```

## 开发模式

```bash
pnpm dev
```

客户端 bundle 改动后需要刷新 DSH 页面；宿主代码改动需要重载插件。

## 测试

- service/live/streaming/terminology/term-e2e/text/audio/reader/standalone；
- 测试不依赖真实麦克风；
- 干净环境可用临时 profile 安装 tarball 验证。

## 发布

1. 更新版本与 CHANGELOG；
2. pnpm install / build / test / verify-package / check-docs；
3. pnpm pack；
4. 创建 v* tag；
5. GitHub Actions Release 上传 tarball 与 sha256。

## 代码约定

- 不修改 DSH core；
- 音频、ASR、翻译、RAG 改动必须补测试；
- 讲义文件读取只通过上传后的 id，不读取任意路径；
- 客户端不直接拼接未转义 HTML。
