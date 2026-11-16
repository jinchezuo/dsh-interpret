# 架构

## 总览

dsh-interpret 是一个单插件自包含的 DSH 插件，由 host 半和 client 半组成：

- **host**：HTTP/SSE、音频分段、ASR、翻译、术语 RAG、会话持久化、讲义文件服务与渲染；
- **client**：主面板、右侧 ReaderPane、设置、历史、字幕列表；
- **DSH core**：提供 webServer、connection、llm、client runtime 等平台能力。

## 数据流

```text
麦克风 / 系统音频
  → Audio capture
  → VAD / segmenter（内置 Silero VAD，缺失回退 energy）
  → 本地 Parakeet / 可选 speechToText
  → 术语 RAG + term corrector
  → 英译中（DSH llm）
  → SSE 推送 / 历史 transcript
```

## 自包含边界

| 能力 | 来源 |
| --- | --- |
| macOS 系统音频 helper | assets/system-audio/recording-helper（来自 @huliux/dsh-asr-plugin，Apache-2.0） |
| Windows 系统音频 helper | assets/system-audio/win32-x64（WASAPI/NAudio，MIT） |
| Silero VAD 模型 | assets/models/silero_vad.onnx |
| Parakeet | 首次下载到 dataDir/models |
| 流式模型 | 首次下载到 dataDir/models |
| Office 解析 | DSH 自带 Python 标准库（zipfile + ElementTree）；.doc 走平台转换或 word-extractor |
| PDF | Chromium 内置阅读器 |
| 翻译 | DSH llm 路由 |

不再要求安装 dsh-asr-plugin。外部 helper 路径仅作为历史兼容兜底。

## 会话状态

`idle → listening → stopping → completed → idle`

- `listening`：采集、ASR、翻译；
- `stopping`：flush、写 transcript；
- `completed`：可查看历史、可保存并刷新；
- `idle`：空白页，可开始新会话。

## 数据目录

`~/.dsh/interpret`：

- sessions/：meta、events.jsonl、transcript.json；
- models/：Parakeet、streaming、VAD；
- reader/：上传讲义、meta、render.html；
- settings.json、startup.log。

## 关键模块

- src/host/service.js：会话、管线、VAD、翻译、持久化；
- src/host/asr.js、parakeet.js、streaming-asr.js；
- src/host/terminology.js、term-corrector.js；
- src/host/system-capture.js（按平台选择 helper）；
- src/win-audio/（Windows WASAPI helper）；
- src/host/reader.js、readers/render.py；
- src/host/api.js；
- src/client/controller.js、panel.js、reader.js、dock.js。

## 兼容性

- 当前验证 DSH 0.2.2-rc.3；
- macOS arm64 使用 ScreenCaptureKit helper；
- Windows x64 使用 WASAPI 环回 helper，需默认播放设备；
- 麦克风路径不依赖系统音频 helper；
- .doc 在 Windows 优先 Word/LibreOffice/antiword，失败时 word-extractor 提取正文；
- 客户端 bundle 改动后需刷新页面。
