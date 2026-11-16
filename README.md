# dsh-interpret — DSH 实时英中同传字幕

DeepSeek Harness 的本地插件：把现场英文讲解（麦克风）或电脑系统音频变成英文原句 + 中文译文双语字幕，面向研究生课堂、学术会议等需要术语准确度的场景。

## 现在已经能做什么

- 左侧栏「同传」入口 + 主面板；右侧栏提供可停靠的「同传字幕」标签页（不可用时降级到主面板）。
- 主面板提供开始/停止、双语字幕流、流式灰色草稿、音轨与延迟统计、诊断与历史会话。
- 麦克风采集：浏览器 getUserMedia → 16kHz 单声道 PCM。
- 系统音频采集：复用已安装 dsh-asr-plugin 的签名采集助手（ScreenCaptureKit），按 1 秒 WAV 分块送入管线。
- 本机 ASR：
  - Parakeet TDT 0.6B v2（英文，int8）：默认学术模式，实测 6.9 秒英文句子约 177–186ms 解码，能正确识别 eigenvalue / Hamiltonian / Hermitian 等术语。
  - SenseVoice（官方 speechToText provider）：轻量多语种备选，首次约 239MB。
- 英译中：走 DSH 已配置的 LLM 路由（默认优先 flash 模型），流式显示中文草稿，保序串行队列。
- 学术术语：内置约 100 条用户种子术语 + 约 3,000 条八学科术语 RAG（AI、数学、统计、生物、城市规划、建筑、电子信息、通用科技），含英文释义、UK/US 音标、别名和常见误听；定稿前用混合检索 + LLM 校验纠正短语级误听（如 laboratory model → large language model），并做学科门控，避免生物语境的合法 laboratory model 被误改。
- 术语工具：主面板可切换自动/指定学科、开关术语校正、搜索术语并查看 UK/US IPA 与中文；导入 CSV/TSV/TMX/JSON。
- 数据构建：node scripts/build-terminology.mjs（Wikipedia 术语表 + Britfone + CMUdict；构建缓存 .cache/terminology，产物 assets/terminology）。
- 噪声/非英语过滤：Silero VAD（缺失时自动回退能量 VAD）+ 自适应噪声底 + 麦克风/系统音频回声去重 + 英文字符/中文占比/重复幻听过滤。
- 会话落盘与历史：JSON/JSONL、历史列表、查看/重命名/删除、按会话导出；英文/中文/双语 SRT、Markdown。
- 数据默认在 ~/.dsh/interpret；音频只在本机识别，只有识别文本会发给你配置的 DSH 模型路由。

## 安装

插件已经写入 desktop profile（dsh-interpret），但运行中的应用需要重载一次：

1. 重启 DeepSeek Harness；或打开 设置 → 插件，在列表里启用/重新启用 dsh-interpret。
2. 左侧栏出现「同传」图标，点开主面板。
3. 在「语音识别」卡片确认引擎：
   - 默认 Parakeet（学术/低延迟）；如果模型未下载，点「准备本机模型」（约 633MB，一次即可）。
   - 想用官方 SenseVoice：在下拉框切换，再点准备（约 239MB）。
4. 在「翻译」卡片确认路由（应该自动选中 deepseek-flash 等）；可用「试翻译」验证。
5. 点右上角「开始同传」，允许麦克风；系统音频会自动尝试用采集助手。
6. 说完一句英文后，会先出现灰色英文草稿；句尾定稿后英文原句出现，中文译文随后出现。
7. 主面板「右栏显示」可把字幕停靠到右侧栏；「历史会话」可查看/导出/删除已完成会话。

如果插件页报错或列表里没有它，用插件页的「添加插件」选择本目录 /Users/zuolaptop/Documents/voicy，或执行：

    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' plugin --profile desktop add file:/Users/zuolaptop/Documents/voicy

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

同源接口前缀 /interpret/api：/state、/events（SSE）、/session/start、/session/stop、/audio/mic、/audio/system、/prepare、/prepare/cancel、/models、/models/vad/prepare、/models/streaming/prepare、/terminology/stats、/terminology/search、/translate、/config、/glossary、/sessions、/sessions/:id、/export、/client-ready。健康检查 /interpret/api/health。

## 已知限制

- 逐词流式英文（约 160–320ms 更新）+ Parakeet 定稿复核；实时行是 provisional，句尾会替换为校正后的定稿。
- 术语库当前约 3,050 条，8 学科；中文名 280 条、UK/US 音标 1,554 条。Wikipedia 分类扩展和批量中文补全受 API 限流影响，可后续用 EXPAND_CATEGORIES=1 / FETCH_LANG=1 重跑构建脚本。
- 术语 RAG 的实时纠正只使用高置信别名/人工误听表；完整 LLM 校正只发生在定稿，避免实时行抖动和误改。
- 系统音频依赖 dsh-asr-plugin 的采集助手与 macOS 屏幕/系统音频权限；没有该插件时仅麦克风可用。
- 说话人标签、CAIT 直接写入、Agent 操作工具尚未实现；当前用 Markdown/SRT 交接给 CAIT/其他工具。
- 首次下载模型需要网络；模型权重不随插件分发。
- 本机 UI 的最终视觉验证需要插件在 DSH 中实际加载后完成（见 docs/acceptance.md）。

## 许可

插件自有代码 MIT。运行时可选依赖 @huliux/dsh-asr-plugin 的采集助手（Apache-2.0 / 上游 BSD-2-Clause）；Parakeet 与 SenseVoice 模型权重由用户从 Hugging Face 下载，遵守各自许可。详见 THIRD_PARTY_NOTICES.md。
