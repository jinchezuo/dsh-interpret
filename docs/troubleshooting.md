# 故障排查

## 插件未出现

- 确认安装命令成功；
- 在 DSH 插件管理中启用 dsh-interpret；
- 重启 DSH；
- 检查 ~/.dsh/interpret/startup.log 是否有 LOAD_FAILED。

## 模型未准备

- 打开「语音识别」卡片，点「准备本机模型」；
- 确认网络可访问 Hugging Face；
- 模型默认在 ~/.dsh/interpret/models；
- 流式模型会在 Parakeet 准备后自动下载。

## 没有系统音频

- 确认 macOS 已授予「屏幕录制/系统音频」权限；
- 首次从插件内新路径运行 helper 需要重新授权一次；
- 确认设置中 systemAudio 不是 off；
- 仍然失败时，麦克风同传不受影响。

## 翻译为空

- 检查 DSH 的 LLM 路由是否可用；
- 点「试翻译」验证；
- 检查设置中的 mtProvider/mtModel；
- 不要在没有 LLM 路由时期待离线翻译。

## PDF 空白

- 使用阅读器工具栏「新标签」打开；
- 检查文件是否损坏；
- 大文件可能受 100MB 上限限制。

## Office 解析失败

- 确认 DSH 自带 Python 存在（~/.dsh/dsh-runtimes/*/dependencies/python）；
- 检查 ~/.dsh/interpret 是否有读取权限；
- DOCX/XLSX 依赖 python-docx/openpyxl；PPTX 可用标准库；
- 同传字幕不受讲义解析失败影响。

## 刷新无效果

- 刷新只在会话 completed 后可用；
- 同传进行中按钮禁用；
- 点击后写入历史并清空页面；
- 若保存失败，页面保留原数据。

## 页面仍显示旧 UI

- 客户端 bundle 更新后需刷新页面（⌘⇧R）；
- 确认插件已重新加载。

## 端口/同源错误

- /interpret/api 只接受本机同源请求；
- 不要用 curl 或跨站页面调用受保护接口；
- 页面刷新后重新登录/重连。
