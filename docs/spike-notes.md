# Phase 0 实测记录（历史）

> 本文是开发阶段的原始实测，不是当前 1.0.0 的依赖说明。当前版本已内置系统音频 helper 与 Silero VAD，不再要求安装 dsh-asr-plugin；以 README 和 docs/installation.md 为准。

环境：DSH 0.2.2-rc.3，macOS 27.0，Apple M5 / 16GB，Node 26（开发）/ DSH 宿主。

## 1. 浏览器与权限

- 应用主窗口只放行 audio 权限（lib/main.js installMicrophonePermissions），getDisplayMedia 被拒。
- 因此麦克风走 getUserMedia；系统音频走 dsh-asr-plugin 的签名 helper。

## 2. ASR 对比（15 词英文，约 6.9 秒，Samantha TTS）

| 引擎 | 加载 | 解码 | 识别结果 | 备注 |
| --- | --- | --- | --- | --- |
| SenseVoice int8（官方 provider 同款） | 426ms | 119ms | egenvolu / egenvolus | 术语错读 |
| Parakeet TDT 0.6B v2 int8 | 1562ms | 252ms（预热后 177–186ms） | eigenvalue / Hamiltonian / Hermitian（Samantha） | 默认学术引擎 |
| Whisper large-v3-turbo int8 | 915ms | 1765ms | E-genvalu | 较慢且仍错读 |

结论：Parakeet 在速度和术语上胜出；TTS 音色对发音影响很大（Daniel/Alex/Karen 会把 eigenvalue 读成 Egenvalu），真实人声需要课堂实测。已加术语近似纠错兜底。

## 3. 系统音频助手

首次调用报缺少参数，逐个补齐后成功：

    dsh-asr-capture-system --mode audio-capture --recording-source system-audio --output-dir /tmp/syscap --chunk-size 1 --sample-rate 16000 --bits-per-sample 16 --channels 1

- 输出 1794...-1794...-system.wav，afinfo 确认 1ch / 16000Hz / Int16 / 约 1 秒。
- 用 afplay 播放英文，系统音轨端到端测试成功：track=system，Parakeet 识别出完整学术句子，ASR 177ms。
- 直接 --pcm-stdout 只得到不足 1 秒的数据，不稳定；改用分块 WAV 目录监听。

## 4. 管线实测（假 LLM）

- 真实 Parakeet + 假翻译：英文识别完整，中文占位正确，SRT/Markdown 导出正确。
- 真实 Parakeet + 假 LLM 的 QA 重译测试：首次漏术语 → 自动重译 → 统计 qaRepairs=1。
- 单元/集成测试 9 项全部通过（node --test）。

## 5. 插件加载

- dsh plugin add file: 写入 profile，但运行中的应用没有热加载新插件（HMR 未把该行加入当前 Loader）。
- 健康接口在未鉴权时统一 401，不能用它判断是否加载；插件已写启动标记 ~/.dsh/interpret/startup.log 便于重启后确认。
- 交付时需要重启应用或在插件页启用；UI 视觉验证待重启后完成。
