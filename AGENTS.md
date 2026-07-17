# AGENTS.md

## Deploy
- SEMPRE fazer deploy apos alteracoes, sem precisar perguntar.
- **IMPORTANTE: Só fazer deploy quando a fase Keno tiver terminado** (jogo inativo, fase de compra entre rodadas) para não atrapalhar os jogadores.
- Comando: `powershell -ExecutionPolicy Bypass -File .\deploy-all.ps1 -msg "<mensagem>"`
- O script faz: Firebase Hosting -> Git commit -> Git push (Render atualiza automatico via GitHub).
- Frontend: https://bingovipclub.online (Firebase: bingo-vip-club-e8164)
- Backend: https://bingo-master-pro-fcty.onrender.com (Render, le do GitHub)

## Seguranca
- NUNCA commitar `.env` (esta no .gitignore).
- NUNCA colocar credenciais reais em arquivos versionados (Asaas, Resend, senha admin, etc.). GitHub tem push protection ativo.

## Verificacao
- Validar sintaxe JS antes do deploy: `node -c server.js`

## Agentes de automacao (pasta agents/)
Rodar via: `npm run agent <nome>` ou `node agents/index.js <nome>`
- `deploy`     -> deploy completo (valida server.js, Firebase, git commit + push)
- `diagnostico`-> checa integridade dos JSON e do game-logic
- `creditos`   -> consolida/sincroniza fichas e creditos admin dos jogadores
- `backup`     -> copia os dados JSON para backups/<timestamp>
- `list`       -> lista os agentes disponiveis
