# WorkOn 云作业服务器（低资源）

把一台常驻 Ubuntu VPS 变成 WorkOn 的作业服务器：

- **出站连接**：由 VPS 主动连回主端 `ws://<主端>:18792`，不在公网监听新端口。
- **完整 Harness**：模型循环 + 工具（`shell` / `fs.read` / `fs.write` / `http.fetch` / `finish`）。
- **断点恢复**：步骤状态与 `wakeAt` 落盘；服务重启后从断点继续，`wait` 不重新计时。
- **本地离线可跑**：主端断开后作业继续执行，重连后按 `job.snapshot` / `job.event` 补回。
- **低资源**：默认 `--max-concurrent 1`，2C2G 起步；主端只做控制/审批/查看。

## 1. 前置条件

| 项 | 要求 |
| --- | --- |
| 系统 | Ubuntu 22.04+（其它 Linux 同理） |
| Node | ≥ 22（自带 WebSocket；更早版本先在目录里 `npm i ws`） |
| 模型 | 任意 OpenAI 兼容接口：云端 API，或 VPS 上的 Ollama |
| 网络 | VPS 能访问主端 18792。推荐 Tailscale；也可端口映射或同局域网 |

主端地址的三种常见形态：

- Tailscale：`ws://100.x.y.z:18792`（推荐，不暴露公网）
- 公网端口映射：`ws://<公网 IP>:18792`（防火墙只放行 VPS 的出口 IP）
- 同局域网：`ws://192.168.x.x:18792`

## 2. 上传

```bash
# 在开发机
scp -r tools/workon-job-server user@<vps>:/opt/workon-job-server
```

VPS 上确认 Node：

```bash
node -v   # 需要 v22+
```

## 3. 首次配对

1. 主端：**设置 → 外部节点 → 生成配对码**（6 位数字，5 分钟有效）。
2. VPS 上执行（模型参数按实际替换）：

```bash
cd /opt/workon-job-server
node index.js \
  --server ws://100.x.y.z:18792 \
  --code 123456 \
  --label vps-1 \
  --workspace ~/workon-jobs \
  --model-base https://api.openai.com/v1 \
  --model gpt-4o-mini \
  --model-key sk-xxx \
  --max-concurrent 1
```

看到 `主端已确认，授权=exec` 即配对成功；令牌写入 `~/.workon-job-server.json`（权限 0600）。

> 只有带 `job.run` 能力的作业服务器才会获得 `exec` 授权；普通只读节点保持 `read`。

后续启动可以不再带 `--code` 与模型参数（令牌会自动复用）。模型配置也可以手工写进 `~/.workon-job-server.json`：

```json
{
  "token": "…",
  "modelBase": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "modelKey": "sk-xxx"
}
```

## 4. systemd 常驻（推荐）

```ini
# /etc/systemd/system/workon-job-server.service
[Unit]
Description=WorkOn job server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=workon
WorkingDirectory=/opt/workon-job-server
EnvironmentFile=/etc/workon-job-server.env
ExecStart=/usr/bin/node /opt/workon-job-server/index.js \
  --server ws://100.x.y.z:18792 \
  --label vps-1 \
  --workspace /var/lib/workon/jobs \
  --max-concurrent 1
Restart=always
RestartSec=5

# 2C2G 机器上的低资源上限
MemoryMax=1200M
CPUQuota=150%

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/workon-job-server.env（权限 0600，属主 workon）
WORKON_MODEL_BASE=https://api.openai.com/v1
WORKON_MODEL=gpt-4o-mini
WORKON_MODEL_KEY=sk-xxx
```

```bash
sudo useradd -r -m -d /var/lib/workon workon
sudo install -d -o workon -g workon /var/lib/workon/jobs
sudo chmod 600 /etc/workon-job-server.env
sudo systemctl daemon-reload
sudo systemctl enable --now workon-job-server
journalctl -u workon-job-server -f
```

## 5. Docker 隔离 shell（可选）

```bash
node index.js --server … --docker \
  --docker-image node:22-bookworm-slim \
  --docker-network none
```

- 每个 shell 步骤独立容器：`--cpus 1 --memory 512m`，作业目录挂到 `/work`。
- `--docker-network none` 完全断网；需要访问外部接口时改 `bridge`。
- 运行用户需在 `docker` 组：`sudo usermod -aG docker workon`。
- 不想用 shell 工具：`--no-shell`（只跑模型 / HTTP / 等待）。

## 6. 低资源建议

- `--max-concurrent 1`，不要按 CPU 核数放大。
- Agent 步骤的 `maxTurns` ≤ 8、`budgetTokens` ≤ 20000（事务策略里设置）。
- 模型用云端 API 时 VPS 几乎不占内存；用 Ollama 时选 4B 量化模型。
- 单次命令输出上限 20k 字符，超出截断，避免事件日志膨胀。

## 7. 数据与运维

| 路径 | 内容 |
| --- | --- |
| `~/.workon-job-server.json` | 配对令牌 / 可选模型配置（0600） |
| `~/.workon-jobs/state.json` | 作业与步骤状态（断点恢复依据） |
| `~/.workon-jobs/events.jsonl` | 事件审计日志 |
| `--workspace` 目录 | 每个作业的工作目录 `jobs/<jobId>` |

- **重新配对**：主端撤销该节点 → VPS 删除 `~/.workon-job-server.json` → 重新生成配对码连接。
- **升级**：替换 `index.js` → `systemctl restart workon-job-server`。
- **安全**：不要把 18792 直接暴露公网；令牌文件保持 0600；退役节点及时在主端撤销。

## 8. 验收

1. 主端新建事务：目标选该云端节点、模式 `agent`，目标写「列出工作区文件后回答」→ 运行 → 状态变「完成」。
2. 断点：事务里放一个 `wait` 步骤，等待期间重启作业服务器 → 恢复后按原定时间继续，不重新计时。
3. 断网：停掉主端 WorkOn → VPS 作业继续跑 → 主端重启后作业状态自动补回。
