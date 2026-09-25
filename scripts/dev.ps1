# ============================================================
# AgentHub 一键启动（Windows PowerShell）
# 用法：
#   .\scripts\dev.ps1                  # 启动基础设施(redis+qdrant) + 迁移 + 后端 + 前端
#   .\scripts\dev.ps1 -AllInfra        # 基础设施含 docker MySQL（本机已有 MySQL 时不要加）
#   .\scripts\dev.ps1 -NoFrontend      # 只起后端
#
# 说明：
#   - 默认只拉起 docker compose 中的 redis / qdrant（本机若已装 MySQL 则复用本机的）。
#   - 启动前自动创建主库 agenthub 并执行 alembic upgrade head。
#   - 后端/前端以后台进程启动，日志分别写入 backend\uvicorn.log 与 frontend\vite.log。
# ============================================================
param(
    [switch]$AllInfra,
    [switch]$SkipInfra,
    [switch]$NoFrontend,
    [switch]$NoBackend
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $Root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "未找到 backend\.venv，请先运行 .\scripts\setup.ps1" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $Root ".env")) -and -not (Test-Path (Join-Path $Root "backend\.env"))) {
    Write-Host "未找到 .env，请先复制 .env.example 为 .env：Copy-Item .env.example .env" -ForegroundColor Red
    exit 1
}

# ---------- 1. 基础设施 ----------
$infraUp = $false
if ($SkipInfra) {
    Write-Host "==> [1/5] 跳过基础设施（-SkipInfra）。注意：Redis/Qdrant 未启动时，文档处理与向量检索不可用" -ForegroundColor Yellow
} else {
    Write-Host "==> [1/5] 拉起基础设施（docker compose）" -ForegroundColor Cyan
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    警告：Docker daemon 未运行，跳过基础设施。Redis/Qdrant 未启动时，文档处理与向量检索不可用；" -ForegroundColor Yellow
        Write-Host "          请启动 Docker Desktop 后重试，或手动运行 docker compose up -d redis qdrant" -ForegroundColor Yellow
    } else {
        Push-Location $Root
        try {
            if ($AllInfra) {
                docker compose up -d mysql redis qdrant
            } else {
                docker compose up -d redis qdrant
            }
            if ($LASTEXITCODE -ne 0) { throw "docker compose 启动失败（exit=$LASTEXITCODE），请确认 Docker 已启动" }
            $infraUp = $true
        } finally {
            Pop-Location
        }
    }
}

# ---------- 2. 确保主库存在 ----------
Write-Host "==> [2/5] 确保主库 agenthub 存在（按 backend/.env 的 DATABASE_URL）" -ForegroundColor Cyan
& $venvPython (Join-Path $PSScriptRoot "ensure-db.py")
if ($LASTEXITCODE -ne 0) { throw "主库检查/创建失败，请确认 MySQL 已启动且凭据正确" }

# ---------- 3. 数据库迁移 ----------
Write-Host "==> [3/5] 执行数据库迁移（alembic upgrade head）" -ForegroundColor Cyan
Push-Location (Join-Path $Root "backend")
try {
    & $venvPython -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "alembic 迁移失败（exit=$LASTEXITCODE）" }
} finally {
    Pop-Location
}

# ---------- 4. 后端 ----------
if (-not $NoBackend) {
    Write-Host "==> [4/5] 启动后端（uvicorn，日志: backend\uvicorn.log）" -ForegroundColor Cyan
    $backendLog = Join-Path $Root "backend\uvicorn.log"
    $proc = Start-Process -FilePath $venvPython -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload") -WorkingDirectory (Join-Path $Root "backend") -RedirectStandardOutput $backendLog -RedirectStandardError (Join-Path $Root "backend\uvicorn.err.log") -PassThru -WindowStyle Hidden
    Write-Host "    后端 PID: $($proc.Id)  http://127.0.0.1:8000/docs"
} else {
    Write-Host "==> [4/5] 跳过后端（-NoBackend）" -ForegroundColor DarkGray
}

# ---------- 5. 前端 ----------
if (-not $NoFrontend) {
    if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) {
        Write-Host "==> [5/5] 前端依赖未安装，跳过。请先运行 .\scripts\setup.ps1（npm install）后重试" -ForegroundColor Yellow
    } else {
        Write-Host "==> [5/5] 启动前端（vite dev，日志: frontend\vite.log）" -ForegroundColor Cyan
        $viteLog = Join-Path $Root "frontend\vite.log"
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        $proc = Start-Process -FilePath $npm -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $Root "frontend") -RedirectStandardOutput $viteLog -RedirectStandardError (Join-Path $Root "frontend\vite.err.log") -PassThru -WindowStyle Hidden
        Write-Host "    前端 PID: $($proc.Id)  http://localhost:5173"
    }
} else {
    Write-Host "==> [5/5] 跳过前端（-NoFrontend）" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "启动完成。浏览器打开 http://localhost:5173（前端）、http://127.0.0.1:8000/docs（API 文档）。" -ForegroundColor Green
Write-Host "停止：结束对应进程即可；基础设施可用 docker compose down 关闭。" -ForegroundColor DarkGray
