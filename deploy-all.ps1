param([string]$msg = "deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')", [switch]$noGitHub)

Write-Output "`n=============================="
Write-Output "  DEPLOY COMPLETO"
Write-Output "=============================="

Write-Output "`n>>> [1/3] Firebase Hosting..."
firebase deploy --only hosting --project bingo-master-pro-39ae0 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Write-Output "ERRO no Firebase"; exit 1 }
Write-Output ">>> OK"

Write-Output "`n>>> [2/3] Render (server)..."
git add -A
git commit -m $msg 2>&1 | Out-Null
git push render main 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Write-Output "ERRO no Render"; exit 1 }
Write-Output ">>> OK"

if (-not $noGitHub) {
    Write-Output "`n>>> [3/3] GitHub..."
    git push origin main 2>&1 | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0) { Write-Output "ERRO no GitHub"; exit 1 }
    Write-Output ">>> OK"
}

Write-Output "`n=============================="
Write-Output "  DEPLOY CONCLUIDO!"
Write-Output "  Frontend: https://bingo-master-pro-39ae0.web.app"
Write-Output "  Backend:  https://bingo-master-pro-2026.onrender.com"
Write-Output "=============================="
