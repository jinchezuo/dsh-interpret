# 发布到 GitHub

仓库内所有 `YOUR_GITHUB` 都是占位符，发布前替换为实际 GitHub 用户名或组织名：

- README.md
- package.json
- CITATION.cff

## 1. 创建仓库

```bash
# 在 GitHub 创建空仓库后
git remote add origin https://github.com/YOUR_GITHUB/dsh-interpret.git
git branch -M main
git push -u origin main
```

## 2. 本地校验

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm verify-package
node scripts/check-docs.mjs
pnpm pack
```

## 3. 打版本标签

```bash
git tag v1.0.0
git push origin v1.0.0
```

Release 工作流会自动：

- 构建客户端；
- 跑完整测试；
- 打包 dsh-interpret-1.0.0.tgz；
- 生成 SHA256SUMS.txt；
- 创建 GitHub Release 并上传工件。

## 4. 检查 Release

- 下载 tarball；
- 在干净 DSH profile 执行 `dsh plugin --profile test add <tarball>`；
- 确认没有 dsh-asr 也能加载并找到内置 helper/VAD；
- 下载模型后测试麦克风与讲义阅读器。

## 5. 发布前检查

- [ ] 所有 `YOUR_GITHUB` 已替换；
- [ ] README 的“重要声明”五条平台前提仍在；
- [ ] LICENSE / THIRD_PARTY_NOTICES 完整；
- [ ] 没有提交 .models、logs、tgz、node_modules；
- [ ] GitHub Actions 绿色；
- [ ] 备份 tag backup-v0.5.0 仍在。
