# 安装与升级

## 环境要求

- macOS（系统音频 helper 当前为 arm64；麦克风路径不依赖 arm64）；
- DeepSeek Harness 0.2.2-rc.3 或兼容版本；
- Node.js 20+、pnpm（从源码安装）；
- 已配置可用的 DSH LLM 路由；
- 首次准备模型需要联网。

## 从源码安装

```bash
git clone https://github.com/jinchezuo/dsh-interpret.git
cd dsh-interpret
pnpm install
pnpm build
dsh plugin --profile desktop add file:$(pwd)
```

重启 DSH，左侧栏出现「同传」后打开主面板。

## 从 Release 安装

```bash
dsh plugin --profile desktop add /path/to/dsh-interpret-1.0.0.tgz
```

DSH 的插件命令会把 npm 依赖一起安装，包括 sherpa-onnx-node。它不是 DSH 插件，不需要另外安装 dsh-asr。

## 首次准备

1. 打开「同传」；
2. 点「准备本机模型」：
   - Parakeet 约 633MB；
   - 流式模型约 73MB，准备 Parakeet 后自动开始；
   - Silero VAD 已内置。
3. 在「翻译」卡片确认 LLM 路由；
4. 点「开始同传」，允许麦克风；
5. 首次系统音频使用，授予屏幕录制/系统音频权限。

模型默认位于 `~/.dsh/interpret/models`。

## 升级

- 源码：`git pull`、`pnpm install`、`pnpm build`，重新加载插件；
- tarball：在 DSH 插件管理中重新安装新版本；
- 客户端 bundle 更新后刷新页面。

历史、设置、已上传讲义不会被删除。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-interpret
```

默认数据目录 `~/.dsh/interpret` 会保留，可手动删除。删除前建议备份历史与设置。

## 回滚

项目保留 0.5.0 备份标签，开发者可按需：

```bash
git checkout backup-v0.5.0
pnpm install
pnpm build
```

普通用户回滚只需重新安装旧版 tarball。
