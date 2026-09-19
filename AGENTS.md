# AGENTS.md

## 个人需求台账

跨对话进度看：`.cursor/task-ledger.md`（最近 10 条需求 + 解决状态）。  
Agent 规则：`.cursor/rules/task-ledger.mdc`（每轮拆解/交付必须更新）。

## 启动项目

⚠️ 从 Devin/IDE 内嵌终端启动前必须先清 `ELECTRON_RUN_AS_NODE`（父进程是 Electron，会传染给子进程，导致 `electron.app` undefined、主进程秒崩）：

```powershell
Get-Process -Name "electron","node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_FORCE_RENDERER_ACCESSIBILITY -ErrorAction SilentlyContinue
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm run dev > dev-out.log 2>&1" -WorkingDirectory "D:\AI\WorkOn\workonv0.2-6\workon"
```

## 类型检查

```powershell
npm run typecheck
```

## Git 推送

每天改动完成后推送到 GitHub：
```powershell
git add -A
git commit -m "daily: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main
```
