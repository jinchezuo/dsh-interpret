# 验收清单（1.1.1）

## 自动化

- [x] pnpm build
- [x] pnpm test（30 项；无模型时模型测试跳过）
- [x] pnpm verify-package
- [x] node scripts/check-docs.mjs
- [x] Windows CI 构建 WASAPI helper
- [ ] Windows helper 实机采集验证
- [x] tarball 包含 macOS helper、VAD、reader.py、client.js
- [x] Windows tarball 包含 win32-x64 exe
- [x] 临时 profile 只安装一个 tarball，npm 依赖自动安装

## macOS

- [ ] 干净 DSH profile 从 README 安装
- [ ] 禁用/卸载 dsh-asr 后插件仍加载
- [ ] 模型准备完成
- [ ] 系统音频权限授予后可用
- [ ] 麦克风同传
- [ ] 系统音频同传
- [ ] 实时英中字幕
- [ ] 最终定稿与术语校正
- [ ] 历史查看/重命名/删除/导出
- [ ] 保存并刷新
- [ ] 讲义 PDF/Word/Excel/CSV/MD/PPTX
- [ ] 右栏关闭/重新打开
- [ ] 页面刷新后恢复

## Windows x64

- [ ] 安装 win32-x64 tarball
- [ ] 默认播放设备存在
- [ ] 麦克风同传
- [ ] 系统音频同传（播放视频）
- [ ] 无屏幕录制权限要求
- [ ] 讲义 PDF/DOCX/XLSX/CSV/MD/PPTX
- [ ] .doc：有 Office 转换器时成功，无转换器时 word-extractor 兜底成功
- [ ] 历史/导出/保存并刷新
- [ ] 页面刷新后恢复

## 回归

- [ ] 同传进行中刷新不可用
- [ ] 刷新不影响实时字幕
- [ ] 讲义解析失败不影响同传
- [ ] 旧备份 backup-v0.5.0 可恢复
