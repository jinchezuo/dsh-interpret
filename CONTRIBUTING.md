# 贡献指南

感谢参与 dsh-interpret。

## 开始

1. Fork 仓库并创建分支；
2. `pnpm install`；
3. 修改后运行 `pnpm build`、`pnpm test`；
4. 提交 PR，描述改动、测试结果和影响范围。

## 必须遵守

- 不修改 DeepSeek Harness core；
- 音频、ASR、翻译、RAG 改动需要补测试或说明手工验证；
- 不引入对 dsh-asr-plugin 等外部 DSH 插件的硬依赖；
- 讲义读取只通过上传后的 id，不接受任意文件路径；
- 不提交模型权重、node_modules、日志或用户数据。

## 代码风格

- 2 空格缩进；
- 宿主代码 ESM；
- 客户端只使用 DSH 提供的 React 和 runtime；
- 错误信息使用可操作的中文，保留稳定 error code。

## 提交信息

建议使用：

```text
feat: ...
fix: ...
docs: ...
test: ...
chore: ...
```

## 安全

安全问题不要开公开 Issue，按 SECURITY.md 私下报告。
