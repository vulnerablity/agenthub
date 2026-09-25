# ============================================================
# AgentHub 一键运行后端测试（Windows PowerShell）
# 用法：
#   .\scripts\test.ps1                       # 全量测试
#   .\scripts\test.ps1 -TestDb mysql+asyncmy://root:pass@host:port/agenthub_test  # 指定测试库
#   .\scripts\test.ps1 -PytestArgs "-x -k auth"   # 透传 pytest 参数
#
# 测试数据库说明：
#   - tests/conftest.py 会自动创建 <TEST_DATABASE_URL 指定的库>（默认 agenthub_test）并执行
#     alembic 迁移到 head，无需手动初始化。
#   - 默认要求本机 MySQL 运行在 localhost:3306，账号 root/123456（与 backend/.env 一致）。
#   - 其他环境请用 -TestDb 传入可用的测试库地址。
# ============================================================
param(
    [string]$TestDb = "mysql+asyncmy://root:123456@localhost:3306/agenthub_test",
    [string]$PytestArgs = ""
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $Root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "未找到 backend\.venv，请先运行 .\scripts\setup.ps1" -ForegroundColor Red
    exit 1
}

$env:TEST_DATABASE_URL = $TestDb
Write-Host "==> 测试库: $TestDb" -ForegroundColor Cyan
Write-Host "==> 运行 pytest（backend 目录）..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "backend")
try {
    if ([string]::IsNullOrWhiteSpace($PytestArgs)) {
        & $venvPython -m pytest -q
    } else {
        & $venvPython -m pytest -q @($PytestArgs -split ' ')
    }
    exit $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:\TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
