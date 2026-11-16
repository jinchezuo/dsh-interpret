# dsh-interpret

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DeepSeek Harness 的本地实时英中同传字幕插件：把现场英文讲解（麦克风）或电脑系统音频变成英文原句 + 中文译文双语字幕，面向研究生课堂、学术会议和需要术语准确度的场景。

主面板右侧内置讲义阅读器，可以一边看翻译，一边看 PDF、Word、Excel、PPT、CSV、Markdown 讲义，不必在 DeepSeek Harness 和外部 PDF 阅读器之间来回切换。

> 这是一个 **DSH 插件**，不是独立桌面应用。运行前提见下方“重要声明”。

---

## 重要声明：内置组件与平台前提

本项目是**单插件自包含发布**，不需要安装 dsh-asr-plugin 或其他外部 DSH 插件。

### 内置组件（插件内置，不需要外部安装）

- **系统音频采集 helper**：来自 Apache-2.0 的 @huliux/dsh-asr-plugin，已随插件分发在 assets/system-audio；
- **Silero VAD 模型**：已内置在 assets/models，不需要单独下载；
- **讲义解析**：优先使用 DSH 自带 Python（python-docx、openpyxl、python-pptx），不需要用户 pip install；
- **本地 ASR**：Parakeet 由插件进程内运行；sherpa-onnx-node 由插件安装时自动安装，它不是 DSH 插件。

### 仍需的平台前提

1. **需要 DeepSeek Harness 应用本身**；本插件不能脱离 DSH 运行。
2. **翻译仍依赖 DSH 已配置的 LLM 路由**，无法把翻译大模型打进插件。
3. **Parakeet 和流式模型首次需要联网下载（约 700MB）**。
4. **系统音频 helper 当前是 macOS arm64 构建**，首次从插件内新路径运行可能需要在系统设置里重新授予一次「屏幕录制 / 系统音频」权限。
5. **PPTX 仍是文字+图片近似阅读，不保证像素级版式**。

---

## 功能

- 麦克风同传：浏览器 getUserMedia → 16kHz 单声道 PCM。
- 系统音频同传：内置 ScreenCaptureKit helper，按 1 秒 WAV 分块送入管线。
- 本地 ASR：默认 Parakeet TDT 0.6B v2（英文 int8），适合学术术语与低延迟。
- 实时逐词字幕 + 最终定稿复核：实时行会随句尾校正替换。
- 英译中：使用 DSH 已配置的 LLM 路由，流式显示中文。
- 学术术语 RAG：约 3,000 条八学科术语，含英文释义、UK/US 音标、别名和常见误听；定稿前做术语校验，实时只做高置信纠正。
- 讲义阅读器：PDF、DOC、DOCX、XLSX、CSV、MD、PPTX。
- 会话落盘与历史：查看、重命名、删除、导出双语 SRT/Markdown。
- “保存并刷新”：完整结束后把本次会话写入历史并清空字幕页；同传进行中不可刷新。
- 数据默认在 ~/.dsh/interpret；音频只在本机识别。

## 支持格式

| 格式 | 阅读方式 |
| --- | --- |
| PDF | Chromium 内置 PDF 阅读器，支持翻页/缩放/搜索 |
| DOCX | 保留标题、段落、表格，尽量内嵌图片 |
| DOC | macOS textutil 转文本阅读 |
| XLSX | 按工作表渲染表格，最多 2000 行、80 列 |
| CSV | 表格阅读，支持引号/换行，表头固定 |
| MD | 标题、列表、代码块、表格、链接 |
| PPTX | 幻灯片文字 + 内嵌图片，近似阅读 |

---

## 安装

### 环境要求

- macOS（系统音频当前为 arm64 helper；麦克风路径不受此限制）；
- DeepSeek Harness 0.2.2-rc.3 或兼容版本；
- Node.js 20+ 与 pnpm（从源码安装时）；
- 已配置可用的 DSH LLM 路由；
- 首次使用模型准备需要联网。

> 把下面的 `<owner>` 替换为你的 GitHub 用户名或组织名。

### 方式 A：从 GitHub 源码安装

```bash
git clone https://github.com/<owner>/dsh-interpret.git
cd dsh-interpret
pnpm install
pnpm build
dsh plugin --profile desktop add file:$(pwd)
```

重启 DeepSeek Harness，在左侧栏打开「同传」。

### 方式 B：从 Release tarball 安装

下载 dsh-interpret-1.0.0.tgz 后：

```bash
dsh plugin --profile desktop add /path/to/dsh-interpret-1.0.0.tgz
```

DSH 的插件命令会把 npm 依赖（包括 sherpa-onnx-node）一起安装。

### 首次启动

1. 打开「同传」主面板；
2. 在「语音识别」卡片点「准备本机模型」：
   - 下载 Parakeet（约 633MB）；
   - 如果启用逐词流式，插件会自动继续下载流式模型（约 73MB）；
   - Silero VAD 已内置，无需下载。
3. 在「翻译」卡片确认 DSH LLM 路由；
4. 点「开始同传」，允许麦克风；
5. 首次使用系统音频时，按系统提示授予屏幕录制/系统音频权限。

### 升级

重新拉取代码并 build，或在 DSH 插件管理里重新安装新 tarball；数据目录和历史不会删除。

### 卸载

在 DSH 插件管理中移除 dsh-interpret，或：

```bash
dsh plugin --profile desktop remove dsh-interpret
```

历史与模型默认保留在 ~/.dsh/interpret，可按需手动删除。

---

## 使用

- 点右上角「开始同传」/「停止」控制采集；
- 主列表显示最终双语字幕，实时行显示逐词草稿；
- 点「讲义」在右侧打开文件阅读器，支持打开/拖入/最近文件/删除；
- 点「保存并刷新」把刚结束的会话写入历史并清空页面；
- 历史区域可查看、重命名、删除、导出 SRT/Markdown；
- 设置区域可调整 ASR、翻译、VAD、术语、音频配置。

详细说明：[安装](docs/installation.md) · [使用](docs/usage.md) · [配置](docs/configuration.md) · [故障排查](docs/troubleshooting.md)

## 隐私

- 音频只在本机进行 VAD/ASR，不上传音频；
- 只有识别后的英文文本会发送到你在 DSH 中配置的 LLM 路由用于翻译/术语校验；
- 讲义文件保存在本机 ~/.dsh/interpret/reader，不发送到第三方；
- 插件不包含遥测、统计上报或远程日志服务。

详见 [隐私与安全](docs/privacy.md)。

## 架构

```text
麦克风 / 系统音频
        ↓
音频分段（Silero VAD / 能量 VAD）
        ↓
本地 ASR（Parakeet / 可选 speechToText）
        ↓
术语 RAG 检索 + 定稿校正
        ↓
英译中（DSH LLM 路由）
        ↓
双语字幕（主面板 / 历史 / 导出）
        ↕
讲义阅读器（PDF / Office / CSV / Markdown）
```

插件由 host 半（HTTP/SSE、音频、ASR、翻译、持久化、讲义渲染）和 client 半（主面板、右栏阅读器、设置、历史）组成。详见 [架构](docs/architecture.md) 与 [API](docs/api.md)。

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm verify-package
node scripts/check-docs.mjs
```

发布包：

```bash
pnpm pack
```

更多见 [开发指南](docs/development.md)；发布到 GitHub 见 [发布指南](docs/publishing.md)。

## 故障排查

- 模型未准备：点「准备本机模型」，确认网络；
- 系统音频无声音：检查系统设置中的屏幕录制/系统音频权限；
- 翻译为空：检查 DSH 的 LLM 路由与「试翻译」；
- PDF 空白：用「新标签」打开，或检查文件是否损坏；
- Office 解析失败：确认 DSH 自带 Python 可用；同传本身不受影响。

详见 [故障排查](docs/troubleshooting.md)。

## 贡献

欢迎提交 Issue/PR。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可与第三方

插件自有代码采用 MIT。内置系统音频 helper 来自 @huliux/dsh-asr-plugin（Apache-2.0，上游 BSD-2-Clause）；Silero VAD 为 MIT；模型权重按上游许可，首次由用户下载。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Citation

如果本项目对研究有帮助，可按 [CITATION.cff](CITATION.cff) 引用。

## English quick start

1. Install DeepSeek Harness and configure an LLM route.
2. Clone this repository, run `pnpm install && pnpm build`, then `dsh plugin --profile desktop add file:$(pwd)`.
3. Restart DSH, open **同传**, and click **准备本机模型** to download Parakeet (~633MB) and the streaming model (~73MB).
4. Grant macOS screen/system-audio permission on first system-audio use.
5. This is a single plugin; no dsh-asr-plugin is required. PDF/DOCX/XLSX/CSV/MD/PPTX handouts open in the right-side reader. PPTX is approximate (text + images).
