# Changelog

## 1.1.0 — 2026-11-16

### Added

- Windows x64 支持。
- Windows WASAPI 系统音频 helper（C#/NAudio），输出与 macOS helper 相同的 1 秒 PCM16 WAV 分块。
- Windows DSH 自带 Python 查找与 .doc 的 Word/LibreOffice/antiword 降级。
- 双平台 Release：win32-x64 包与 SHA256SUMS。

### Changed

- 版本升级到 1.1.0。
- README/安装/故障排查/验收文档改为双平台。

## 1.0.0 — 2026-11-16

### Added

- 单插件自包含发布：内置系统音频 helper、Silero VAD。
- 讲义阅读器：PDF、DOC、DOCX、XLSX、CSV、MD、PPTX。
- 保存并刷新：结束后写入历史并清空字幕页。
- DSH 自带 Python 优先用于 Office 解析。
- GitHub 发布文档、CI、Release 工作流。

### Changed

- 不再要求安装 dsh-asr-plugin。
- 准备 Parakeet 后自动准备流式模型。

### Fixed

- 右栏在插件主面板下无法打开。
- 历史会话查看框透明。
- 刷新按钮无效果。
- 同传进行中刷新会干扰页面。

## 0.5.0 — 2026-11-16

- 本地备份基线：讲义阅读器、不透明历史弹窗、右栏分栏。
- 标签：backup-v0.5.0。

## 0.4.0 and earlier

- 实时英中字幕、术语 RAG、系统音频、历史、导出。
