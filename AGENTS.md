# AGENTS.md

## 个人需求台账

跨对话进度看：`.cursor/task-ledger.md`（最近 10 条需求 + 解决状态）。  
Agent 规则：`.cursor/rules/task-ledger.mdc`（每轮拆解/交付必须更新）。

## 启动项目

```powershell
Get-Process -Name "electron","node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev","2>&1",">","dev-out.log" -WorkingDirectory "D:\AI\WorkOn\workonv0.2-6\workon"
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
