# 验收清单（1.0.0）

## 自动化

- [x] pnpm build
- [x] pnpm test（27 项）
- [x] pnpm verify-package
- [x] node scripts/check-docs.mjs
- [x] tarball 包含 helper、VAD、reader.py、client.js
- [x] 临时 profile 只安装一个 tarball，npm 依赖自动安装

## 安装

- [ ] 干净 DSH profile 从 README 安装
- [ ] 禁用/卸载 dsh-asr 后插件仍加载
- [ ] 模型准备完成
- [ ] 系统音频权限授予后可用

## 功能

- [ ] 麦克风同传
- [ ] 系统音频同传
- [ ] 实时英中字幕
- [ ] 最终定稿与术语校正
- [ ] 历史查看/重命名/删除/导出
- [ ] 保存并刷新
- [ ] 讲义 PDF/Word/Excel/CSV/MD/PPTX
- [ ] 右栏关闭/重新打开
- [ ] 页面刷新后恢复

## 回归

- [ ] 同传进行中刷新不可用
- [ ] 刷新不影响实时字幕
- [ ] 讲义解析失败不影响同传
- [ ] 旧备份 backup-v0.5.0 可恢复
