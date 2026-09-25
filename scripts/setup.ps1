# ============================================================
# AgentHub 一键安装脚本（Windows PowerShell）
# 用法：
#   .\scripts\setup.ps1              # 安装后端 + 前端全部依赖
#   .\scripts\setup.ps1 -SkipFrontend  # 只装后端
# ============================================================
param(
    [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "==> [1/4] 检查后端 Python 虚拟环境" -ForegroundColor Cyan
$venvDir = Join-Path $Root "backend\.venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "    未找到 .venv，正在创建（backend\.venv）..."
    python -m venv $venvDir
    if (-not (Test-Path $venvPython)) { throw "创建虚拟环境失败：请确认已安装 Python 3.10+ 且在 PATH 中" }
} else {
    Write-Host "    已存在 backend\.venv，跳过创建"
}

Write-Host "==> [2/4] 安装后端依赖（backend\requirements.txt）" -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $Root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "后端依赖安装失败（exit=$LASTEXITCODE）" }

if (-not $SkipFrontend) {
    Write-Host "==> [3/4] 安装前端依赖（frontend\package.json）" -ForegroundColor Cyan
    Push-Location (Join-Path $Root "frontend")
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "前端依赖安装失败（exit=$LASTEXITCODE）" }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "==> [3/4] 跳过前端安装（-SkipFrontend）" -ForegroundColor DarkGray
}

Write-Host "==> [4/4] 校验安装结果" -ForegroundColor Cyan
& $venvPython -c "import fastapi, sqlalchemy, asyncmy, pytest; print('backend OK: fastapi / sqlalchemy / asyncmy / pytest 均可导入')"
if (-not $SkipFrontend -and (Test-Path (Join-Path $Root "frontend\node_modules"))) {
    Write-Host "frontend OK: node_modules 已就绪"
}
Write-Host ""
Write-Host "安装完成。下一步：" -ForegroundColor Green
Write-Host "  一键运行测试:  .\scripts\test.ps1"
Write-Host "  一键启动:      .\scripts\dev.ps1"
