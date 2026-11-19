# 配置

设置保存在 `~/.dsh/interpret/settings.json`（如存在）；模型和历史在 `~/.dsh/interpret` 下。Windows 对应用户目录下的 `.dsh\interpret`。

## 语音识别

- `asrProvider`：默认 `parakeet-local`；DSH 提供 speechToText 时可选择 SenseVoice；
- `finalAsrProvider`：定稿引擎；
- `streamingMode`：auto/on/off；
- `liveAsrMode`：fast/balanced/accurate。

## 翻译

- `autoTranslate`：是否自动翻译；
- `mtProvider` / `mtModel` / `mtEffort`：DSH LLM 路由；
- `liveTranslate`：实时中文草稿。

### 翻译模型选择

设置栏的「翻译模型」卡片通过 `GET /translate/routes` 读取当前 DSH 已配置的 provider/model，写入上面两个字段：

- 留空 `mtProvider` / `mtModel` 表示自动；
- 只设置 provider 时使用该 provider 的第一个模型；
- 已保存的模型被移除时，插件会回退到自动策略，并在界面显示 `mtWarning`；
- 「省钱优先」「高质量」「开源系」只是按模型家族和命名做相对分档，不读取价格；实际费用以 DSH 账单为准；
- 插件不新增 API Key、不绕过 DSH 路由，也不自动关闭翻译或术语校正。

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

默认 `~/.dsh/interpret`（Windows 为 `%USERPROFILE%\.dsh\interpret`）：
- `sessions/`：历史；
- `models/`：模型；
- `reader/`：上传的讲义；
- `settings.json`：设置；
- `startup.log`：宿主启动记录。

备份时复制整个数据目录；不要在插件运行时手工修改 session transcript。
