# 安装与升级

## 环境要求

- macOS arm64 或 Windows x64；
- DeepSeek Harness 0.2.2-rc.3 或兼容版本；
- Node.js 20+、pnpm（从源码安装时）；
- 已配置可用的 DSH LLM 路由；
- 首次准备模型需要联网；
- 不需要安装系统 Python；使用 DSH 自带 Python 解释器，Office 依赖随插件分发；
- Windows 源码构建需要 .NET 8 SDK。

## macOS 安装

### 从源码

```bash
git clone https://github.com/jinchezuo/dsh-interpret.git
cd dsh-interpret
pnpm install
pnpm build
dsh plugin --profile desktop add file:$(pwd)
```

### 从 Release

```bash
dsh plugin --profile desktop add /path/to/dsh-interpret-1.1.2.tgz
```

内置 arm64 ScreenCaptureKit helper，首次系统音频使用需要授予「屏幕录制 / 系统音频」权限。

## Windows x64 安装

Windows 必须使用带 WASAPI helper 的 win32-x64 包：

```powershell
dsh plugin --profile desktop add C:\path\to\dsh-interpret-1.1.2-win32-x64.tgz
```

不要使用通用 tarball 或源码目录直接安装；通用包不含 Windows exe，系统音频不可用。

从源码构建：

```powershell
git clone https://github.com/jinchezuo/dsh-interpret.git
cd dsh-interpret
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File scripts/build-win-audio.ps1
dsh plugin --profile desktop add file:$((Get-Location).Path)
```

`build-win-audio.ps1` 需要 .NET 8 SDK，生成：

```text
assets/system-audio/win32-x64/dsh-asr-capture-system.exe
```

Windows helper 使用默认播放设备的 WASAPI 环回，不需要屏幕录制权限。

## 首次准备

1. 打开「同传」；
2. 点「准备本机模型」：
   - Parakeet 约 633MB；
   - 流式模型约 73MB，准备 Parakeet 后自动开始；
   - Silero VAD 已内置。
3. 在「翻译」卡片确认 LLM 路由；
4. 点「开始同传」，允许麦克风；
5. macOS 授予屏幕录制/系统音频权限；Windows 确认默认播放设备可用。

模型默认位于 `~/.dsh/interpret/models`。

## 升级

- 源码：`git pull`、`pnpm install`、`pnpm build`，Windows 还须重新运行 `powershell -ExecutionPolicy Bypass -File scripts/build-win-audio.ps1`；
- tarball：在 DSH 插件管理中重新安装对应平台的新版本；
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
