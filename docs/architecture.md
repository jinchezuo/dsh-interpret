# 架构

## 数据流

    DSH 浏览器页面
      同传主面板（React）
        ├─ getUserMedia 16kHz → ScriptProcessor 256ms → POST /interpret/api/audio/mic
        └─ EventSource /interpret/api/events（失败时 1.2s 轮询 /state）
    Host 插件
      webServer 路由 + 同源校验
        ├─ AudioHub：麦克风 PCM 入 EnergySegmenter
        ├─ SystemCapture：spawn dsh-asr-capture-system
        │    → 输出目录 1s *-system.wav → decodeWav → SystemSegmenter
        ├─ AsrClient：Parakeet 本地 / speechToText 官方 provider
        ├─ Glossary：种子/用户术语、命中、ASR 近似纠错
        ├─ Translator：ctx.llm.stream（术语 + 场景说明 + 前文）
        ├─ QA：数字/单位/术语/中文比例；失败重译一次
        ├─ SessionStore：meta.json / events.jsonl / transcript.json
        └─ Export：SRT / Markdown
    数据目录 ~/.dsh/interpret
      config/settings.json、glossary.json、models/parakeet、sessions/<id>/

## 会话状态机

idle → listening → stopping → completed；start 期间会等待 settings/glossary 加载与 ASR/翻译路由检查。单活动会话；麦克风与系统音轨各自分段，共享翻译队列，按 seq 保序。

## 关键参数

- 采样：16k mono PCM16。
- VAD：能量阈值 0.008（可配），最短语音 350ms，句尾静音 500ms，单段上限 12s，预卷 300ms。
- ASR：Parakeet TDT 0.6B v2 int8，CPU 4 线程；官方 SenseVoice 由 speechToText 子进程推理。
- 翻译：temperature 0.2，maxTokens 1200，reasoningEffort low（若模型支持），流式 text-delta。
- 过滤：CJK > 10% 拒绝；拉丁字母 < 55% 拒绝；n-gram 重复/幻听短语拒绝。
- 术语：最长优先、词边界匹配，单段最多 40 条；ASR 近似纠错仅处理长度 >=5、首字母相同的术语，编辑距离阈值 30%。

## 兼容性说明

- 目标 DSH 0.2.2-rc.3。
- 主窗口权限只允许 audio，因此不能用 getDisplayMedia 抓系统音频；必须走外部助手或环回设备。
- 系统音频助手 CLI 是 dsh-asr-plugin 的私有实现，参数为：
  --mode audio-capture --recording-source system-audio --output-dir <dir> --chunk-size 1 --sample-rate 16000 --bits-per-sample 16 --channels 1
  如果其版本变化，插件会报 SYSTEM_CAPTURE_* 错误并保留麦克风链路。
