# 发布到 GitHub

仓库地址：https://github.com/jinchezuo/dsh-interpret

## 1. 本地校验

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm verify-package
node scripts/check-docs.mjs
```

Windows helper 额外校验：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-win-audio.ps1
pnpm verify-package
```

## 2. 打版本标签

```bash
git tag v1.1.1
git push origin v1.1.1
```

Release 工作流会并行构建：

- dsh-interpret-1.1.1.tgz（macOS/generic，含 arm64 helper）；
- dsh-interpret-1.1.1-win32-x64.tgz（含 WASAPI exe）；
- SHA256SUMS.txt。

然后由 publish job 创建 GitHub Release。

## 3. 检查 Release

- 下载两个 tarball 和校验和；
- macOS：干净 DSH profile 安装 generic 包，验证麦克风/系统音频/讲义；
- Windows：干净 DSH profile 安装 win32-x64 包，验证默认播放设备系统音频；
- 确认 Windows 包内存在 assets/system-audio/win32-x64/dsh-asr-capture-system.exe；
- 确认通用包没有被误用于 Windows 系统音频。

## 4. 发布前检查

- [ ] package.json / api.js / README / CITATION 版本一致；
- [ ] README 的“重要声明”双平台前提仍在；
- [ ] LICENSE / THIRD_PARTY_NOTICES 包含 NAudio；
- [ ] 没有提交 .models、logs、tgz、node_modules、build；
- [ ] GitHub Actions Ubuntu + Windows 绿色；
- [ ] 备份 tag backup-v0.5.0 仍在。

## 5. 回滚

- 旧版本标签和 Release 保留；
- 用户可重新安装 v1.0.0 的 macOS 包；
- Windows 首个版本为 v1.1.0；v1.1.1 修复阅读器 Python 依赖。
