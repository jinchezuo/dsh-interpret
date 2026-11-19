# HTTP API

所有接口前缀：`/interpret/api`，只接受本机同源请求。

## 会话

- `GET /health`：健康检查（无需同源校验）；
- `GET /state`：当前状态 + 字幕；
- `GET /events`：SSE 实时事件；
- `POST /session/start`：开始；
- `POST /session/stop`：停止并写 transcript；
- `POST /session/reset`：completed 后保存并清空；
- `GET /sessions`：历史列表；
- `GET /sessions/:id`：历史详情；
- `PATCH /sessions/:id`：重命名；
- `DELETE /sessions/:id?confirm=1`：删除；
- `GET /export?format=srt-bilingual|md&session=...`：导出。

## 音频与模型

- `POST /audio/mic`、`POST /audio/system`：PCM 帧；
- `POST /prepare`：准备 ASR 模型；
- `POST /models/streaming/prepare`：准备流式模型；
- `POST /models/vad/prepare`：准备 VAD；
- `GET /models`：模型状态。

## 术语

- `GET /terminology/stats`；
- `GET /terminology/search?q=...`；
- `POST /terminology/...`：术语库操作；
- `GET /glossary`、`POST /glossary`、`POST /glossary/import`；
- `GET /translate/routes`：列出 DSH 已配置的翻译路由、当前选择与回退警告；
- `POST /translate`：试翻译。

## 讲义阅读器

- `GET /reader/files`：最近文件；
- `POST /reader/files?name=...`：上传原始字节（最大 100MB）；
- `GET /reader/files/:id`：元数据；
- `DELETE /reader/files/:id`：删除；
- `GET /reader/files/:id/raw`：原始文件；
- `GET /reader/files/:id/html`：Office/PPTX 渲染 HTML。

## 客户端诊断

- `POST /client-event`；
- `POST /client-ready`。

## 同源限制

除 /health 外，请求必须来自本机同源页面；curl 或跨站请求会收到 401。浏览器客户端使用相对路径 fetch。
