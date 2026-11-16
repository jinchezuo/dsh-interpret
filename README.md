# dsh-interpret — DSH 实时英中同传字幕

DeepSeek Harness 的本地插件：把现场英文讲解（麦克风）或电脑系统音频变成英文原句 + 中文译文双语字幕，面向研究生课堂、学术会议等需要术语准确度的场景。

## 现在已经能做什么

- 左侧栏「同传」入口 + 主面板；主面板「讲义」按钮在右侧打开内置文件阅读器，可边看翻译边看 PDF、Word、Excel、PPT、CSV、Markdown 讲义。
- 主面板提供开始/停止、双语字幕流、流式灰色草稿、音轨与延迟统计、诊断与历史会话。
- 麦克风采集：浏览器 getUserMedia → 16kHz 单声道 PCM。
- 系统音频采集：插件自带签名的 ScreenCaptureKit 采集助手（来自 Apache-2.0 的 dsh-asr helper），按 1 秒 WAV 分块送入管线；不依赖外部 dsh-asr 插件。
- 本机 ASR：
  - Parakeet TDT 0.6B v2（英文，int8）：默认学术模式，实测 6.9 秒英文句子约 177–186ms 解码，能正确识别 eigenvalue / Hamiltonian / Hermitian 等术语。
  - SenseVoice（如果 DSH 提供 speechToText 服务）：可选备选；未安装 dsh-asr 时只显示本地 Parakeet，不影响使用。
- 英译中：走 DSH 已配置的 LLM 路由（默认优先 flash 模型），流式显示中文草稿，保序串行队列。
- 学术术语：内置约 100 条用户种子术语 + 约 3,000 条八学科术语 RAG（AI、数学、统计、生物、城市规划、建筑、电子信息、通用科技），含英文释义、UK/US 音标、别名和常见误听；定稿前用混合检索 + LLM 校验纠正短语级误听（如 laboratory model → large language model），并做学科门控，避免生物语境的合法 laboratory model 被误改。
- 术语工具：主面板可切换自动/指定学科、开关术语校正、搜索术语并查看 UK/US IPA 与中文；导入 CSV/TSV/TMX/JSON。
- 数据构建：node scripts/build-terminology.mjs（Wikipedia 术语表 + Britfone + CMUdict；构建缓存 .cache/terminology，产物 assets/terminology）。
- 噪声/非英语过滤：内置 Silero VAD 模型 + 自适应噪声底 + 麦克风/系统音频回声去重 + 英文字符/中文占比/重复幻听过滤。
- 会话落盘与历史：JSON/JSONL、历史列表、查看/重命名/删除、按会话导出；英文/中文/双语 SRT、Markdown。
- 数据默认在 ~/.dsh/interpret；音频只在本机识别，只有识别文本会发给你配置的 DSH 模型路由。

## 安装（单插件，无需 dsh-asr）

只需要安装 dsh-interpret。系统音频助手、Silero VAD、讲义解析都已内置或使用 DSH 自带运行时，不再需要安装 dsh-asr-plugin，也不需要 pip install。

1. 安装本插件（GitHub 下载后）：

       cd dsh-interpret
       pnpm install
       pnpm run build
       dsh plugin --profile desktop add file:$(pwd)

   DSH 插件管理器会把 sherpa-onnx-node 等 npm 依赖一起安装；它们不是 DSH 插件。
2. 重启 DeepSeek Harness；或打开 设置 → 插件，启用 dsh-interpret。
3. 左侧栏出现「同传」图标，点开主面板。
4. 在「语音识别」卡片点「准备本机模型」：
   - 默认 Parakeet（约 633MB，一次即可）；
   - 如果启用了逐词流式，插件会自动继续下载流式模型（约 73MB）；
   - Silero VAD 已随插件内置，无需下载。
5. 在「翻译」卡片确认 DSH 的 LLM 路由（deepseek-flash 等）；翻译仍依赖 DSH 的模型服务。
6. 点右上角「开始同传」，允许麦克风。首次使用系统音频时，macOS 可能要求给内置 helper 授予屏幕录制/系统音频权限，授权一次即可。
7. 主面板「讲义」按钮在右侧打开文件阅读器，支持 PDF、DOC/DOCX、XLSX、CSV、MD、PPTX。

## 运行前提

- DeepSeek Harness 桌面版；插件本身不能替代 DSH 应用。
- 翻译需要 DSH 已配置可用的 LLM 路由。
- 系统音频 helper 当前为 macOS arm64 构建；Intel Mac 需要对应构建或保留旧外部 helper。
- Parakeet/流式模型首次需要联网下载，默认保存在 ~/.dsh/interpret/models；离线用户可预置模型目录。
- 讲义 Office 解析使用 DSH 自带 Python（python-docx、openpyxl、python-pptx）；不需要系统 Python。

## 开发

    cd /Users/zuolaptop/Documents/voicy
    pnpm install
    pnpm run build          # 构建 lib/client.js
    node --test test/*.test.mjs

- src/host：ASR、翻译、VAD/分段、系统音频、术语/质检、导出、HTTP/SSE。
- src/client：面板、麦克风采集、SSE/轮询、设置。
- .models/ 是本地开发用的模型缓存（已 gitignore），发布版从 UI 下载到 ~/.dsh/interpret/models。
- 客户端 bundle 使用 window.__ModuleLoader__.load 协议，React 由 DSH 浏览器模块表提供。

## API

同源接口前缀 /interpret/api：/state、/events（SSE）、/session/start、/session/stop、/audio/mic、/audio/system、/prepare、/prepare/cancel、/models、/models/vad/prepare、/models/streaming/prepare、/terminology/stats、/terminology/search、/translate、/config、/glossary、/sessions、/sessions/:id、/export、/client-ready、/session/reset、/reader/files、/reader/files/:id、/reader/files/:id/raw、/reader/files/:id/html。健康检查 /interpret/api/health。

## 已知限制

- 逐词流式英文（约 160–320ms 更新）+ Parakeet 定稿复核；实时行是 provisional，句尾会替换为校正后的定稿。
- 术语库当前约 3,050 条，8 学科；中文名 280 条、UK/US 音标 1,554 条。Wikipedia 分类扩展和批量中文补全受 API 限流影响，可后续用 EXPAND_CATEGORIES=1 / FETCH_LANG=1 重跑构建脚本。
- 术语 RAG 的实时纠正只使用高置信别名/人工误听表；完整 LLM 校正只发生在定稿，避免实时行抖动和误改。
- 系统音频使用插件内置的签名采集助手，只需要 macOS 屏幕/系统音频权限；不再依赖 dsh-asr-plugin。
- 说话人标签、CAIT 直接写入、Agent 操作工具尚未实现；当前用 Markdown/SRT 交接给 CAIT/其他工具。
- 首次下载 Parakeet/流式模型需要网络；Silero VAD 已内置。除 sherpa-onnx-node npm 依赖外，不需要其他 DSH 插件或系统 Python 包。
- 本机 UI 的最终视觉验证需要插件在 DSH 中实际加载后完成（见 docs/acceptance.md）。

## 许可

插件自有代码 MIT。内置的采集助手来自 @huliux/dsh-asr-plugin（Apache-2.0 / 上游 BSD-2-Clause），许可文本见 assets/system-audio；Parakeet 与流式模型权重由用户从 Hugging Face 下载，遵守各自许可。详见 THIRD_PARTY_NOTICES.md。
