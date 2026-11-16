# 配置

设置保存在 `~/.dsh/interpret/settings.json`（如存在）；模型和历史在 `~/.dsh/interpret` 下。

## 语音识别

- `asrProvider`：默认 `parakeet-local`；DSH 提供 speechToText 时可选择 SenseVoice；
- `finalAsrProvider`：定稿引擎；
- `streamingMode`：auto/on/off；
- `liveAsrMode`：fast/balanced/accurate。

## 翻译

- `autoTranslate`：是否自动翻译；
- `mtProvider` / `mtModel` / `mtEffort`：DSH LLM 路由；
- `liveTranslate`：实时中文草稿。

## 音频与切句

- `systemAudio`：auto/helper/off；
- `vadMode`：auto/silero/energy；
- `vadProfile`：sensitive/standard/robust；
- `vadThreshold`、`minSpeechMs`、`silenceMs`、`maxSegmentMs`；
- `preRollMs`、`postRollMs`、`mergeGapMs`；
- `audioProfile`：auto/clean/raw。

## 术语

- `terminologyMode`：auto/on/off；
- `terminologyDomains`：指定学科；
- `terminologyTopK`；
- `termCorrection`、`termCorrectionTimeoutMs`、`termCorrectionMaxEdits`；
- `showPronunciation`。

## 数据目录

默认 `~/.dsh/interpret`：
- `sessions/`：历史；
- `models/`：模型；
- `reader/`：上传的讲义；
- `settings.json`：设置；
- `startup.log`：宿主启动记录。

备份时复制整个数据目录；不要在插件运行时手工修改 session transcript。
