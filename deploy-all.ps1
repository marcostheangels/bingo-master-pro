param([string]$msg = "deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')", [switch]$noGitHub)

Write-Output "`n=============================="
Write-Output "   DEPLOY COMPLETO"
Write-Output "=============================="

# >>> [0] Bump automático da versão ?v= nos scripts do index.html (evita cache do navegador)
Write-Output "`n>>> [0/3] Atualizando versao dos scripts no index.html..."
$indexFile = "index.html"
if (Test-Path $indexFile) {
    $content = Get-Content $indexFile -Raw
    # Incrementa ?v=N para game-logic.js e network.js (formato src="arquivo.js?v=NUM")
    $content = [regex]::Replace($content, '(src="game-logic\.js\?v=)(\d+)', {
        param($m) $m.Groups[1].Value + ([int]$m.Groups[2].Value + 1)
    })
    $content = [regex]::Replace($content, '(src="network\.js\?v=)(\d+)', {
        param($m) $m.Groups[1].Value + ([int]$m.Groups[2].Value + 1)
    })
    Set-Content $indexFile $content -NoNewline
    Write-Output ">>> OK (versoes incrementadas)"
} else {
    Write-Output ">>> index.html nao encontrado, pulando bump de versao"
}

Write-Output "`n>>> [1/3] Firebase Hosting..."
firebase deploy --only hosting --project bingo-vip-club-e8164 2>&1 | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { Write-Output "ERRO no Firebase"; exit 1 }
Write-Output ">>> OK"

Write-Output "`n>>> [2/3] Salvando alterações locais (Git Commit)..."
git add -A
git commit -m $msg 2>&1 | Out-Null
# Removeu-se o push direto para o render, pois o Render lê direto do GitHub
Write-Output ">>> OK"

if (-not $noGitHub) {
    Write-Output "`n>>> [3/3] Enviando para o GitHub (O Render atualizará automático)..."
    git push origin main 2>&1 | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0) { Write-Output "ERRO no GitHub"; exit 1 }
    Write-Output ">>> OK"
}

Write-Output "`n=============================="
Write-Output "   DEPLOY CONCLUIDO!"
Write-Output "   Frontend: https://bingovipclub.online"
Write-Output "   Backend:  https://api.bingovipclub.online"
Write-Output "=============================="
