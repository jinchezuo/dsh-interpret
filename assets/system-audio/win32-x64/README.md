# Windows 系统音频 helper

此目录用于放置 Windows x64 的 WASAPI 环回采集 helper：

    dsh-asr-capture-system.exe

它不是手工维护的二进制。Windows 构建或 GitHub Release 的 win32-x64 包会执行：

    pwsh scripts/build-win-audio.ps1

生成并复制 exe。源码仓库不提交该 exe，避免二进制与 C# 源码不同步。

普通 Windows 用户请安装 Release 中的 dsh-interpret-<version>-win32-x64.tgz；
从源码安装时，需要 .NET 8 SDK 并先运行上述构建脚本。
