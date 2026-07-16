# AGENTS.md

## Deploy
- SEMPRE fazer deploy apos alteracoes, sem precisar perguntar.
- Comando: `powershell -ExecutionPolicy Bypass -File .\deploy-all.ps1 -msg "<mensagem>"`
- O script faz: Firebase Hosting -> Git commit -> Git push (Render atualiza automatico via GitHub).
- Frontend: https://bingovipclub.online (Firebase: bingo-vip-club-e8164)
- Backend: https://bingo-master-pro-fcty.onrender.com (Render, le do GitHub)

## Seguranca
- NUNCA commitar `.env` (esta no .gitignore).
- NUNCA colocar credenciais reais em arquivos versionados (Asaas, Resend, senha admin, etc.). GitHub tem push protection ativo.

## Verificacao
- Validar sintaxe JS antes do deploy: `node -c server.js`
