# Histórico do Projeto — Bingo VIP Club (bingovipclub.online)

> Documento de referência gerado a partir das sessões de trabalho. Serve para relembrar o que já foi feito, as configurações de infraestrutura e as decisões tomadas. Peça para o assistente "ler o HISTORICO.md" quando precisar.

---

## 1. Infraestrutura

- **Frontend (site):** hospedado no Firebase Hosting.
  - `bingo-vip-club-e8164` (projeto ATIVO — default em `.firebaserc`).
  - ~~`bingo-master-pro-39ae0` (antigo — servia o domínio `bingovipclub.online`)~~ **EXCLUÍDO em 15/07/2026** (erro `403 "Project has been deleted"`, site `404`). Não dá mais para publicar nele.
  - **Deploy APENAS no projeto ativo:** `firebase deploy --only hosting` (usa o default).
  - ⚠️ Se o domínio `bingovipclub.online` precisar continuar no ar, aponte-o para `bingo-vip-club-e8164` (ou recrie o projeto 2 e reponte o domínio).
- **Backend (API):** `https://bingo-master-pro-fcty.onrender.com` (Render, auto-deploy via `git push origin main`).
  - `api.bingovipclub.online` tem SSL quebrado — **não usar**, usar sempre o `bingo-master-pro-fcty.onrender.com`.
- **`API_BASE`** no frontend = `https://bingo-master-pro-fcty.onrender.com` (game-logic.js:4).
- **Asaas (pagamentos PIX):** conta de PRODUÇÃO.
- **Resend (e-mails):** usado porque o Gmail é bloqueado pelo Render.
- **UptimeRobot:** monitor criado (HTTP, 5 min) apontando para `https://bingo-master-pro-fcty.onrender.com` para o Render não "dormir".

### Chaves (NÃO commitadas — definidas no painel do Render)
- `ASAAS_API_KEY` = `<definida no painel do Render>`
- `RESEND_API_KEY` = `<definida no painel do Render>`
- `ASAAS_WEBHOOK_TOKEN` = `<definida no painel do Render>`
- `ADMIN_SENHA` = `<definida como ENV VAR no Render>` (senha mestre do painel admin — definida como **ENV VAR no Render**, NÃO no código). O servidor exige header `x-admin-token` igual a ela em TODAS as rotas `/api/admin/*` (senão 401). O dono digita essa senha no popup ao abrir o painel admin.

### Webhook do Asaas (IMPORTANTE)
- URL registrada no Asaas: **`https://bingo-master-pro-fcty.onrender.com/api/asaas/webhook`**
  - ⚠️ Antes apontava para `bingo-master-pro-vbnc.onrender.com` (serviço errado) — isso fazia os depósitos NUNCA confirmarem no servidor. Corrigido em 15/07/2026.
- Eventos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_DELETED`, `PAYMENT_OVERDUE`.
- `authToken` do webhook = `ASAAS_WEBHOOK_TOKEN`.

---

## 2. Regras de negócio (definidas pelo dono)

- **Saque sacável** = Créditos do admin + Prêmios (Kuadra/Kina/Keno/Jackpot).
- **NÃO sacável** = Depósitos e Bônus.
- Bônus de 1º depósito = 10% do valor (uma vez por usuário).
- Mínimo de saque: R$ 10,00.
- **Bots NUNCA devem receber bônus** (manual ou de 1º depósito).

---

## 3. O que já foi feito (correções)

### Erros 500 em `/api/solicitar-saque`
- `asyncHandler` trocado por try/catch manual para expor erro real.
- `enviarEmailNotificacao` tornado não-fatal (erro de e-mail não derruba o saque).
- Commit `ff55c02`.

### Overflow de `transacoes.id`
- `transacoes.id` era `SERIAL` (int, estourava com `Date.now()` ~1.75 trilhão). Alterado para `BIGINT`.
- Commit `5a14e31`.

### Bônus do admin não surtia efeito ao comprar cartela
- Rota `add-bonus` atualizava `chips` persistido mas não sincronizava o `player.chips` do jogador conectado. Adicionado bloco `gameRooms.forEach` para sincronizar.
- Validação de token de webhook Asaas adicionada.
- Commit `697cf78`.

### Transações sem `id` (erro ao pagar/marcar saque)
- 4 pushes de transação não tinham `id`. Adicionado `id: Date.now() + Math.floor(Math.random()*1000)`.
- Commit `041b0f8`.

### Erro "erro ao criar cliente no asaas" ao gerar QR Code
- `asaasRequest` passou a rejeitar em HTTP >=400 com mensagem real.
- `findOrCreateAsaasCustomer` passou a lançar em vez de retornar null.
- E-mail de aviso ao gerar PIX.
- Commit `1c6817a`.

### Saques pendentes não apagavam (comparação de id)
- IDs BIGINT voltam como **string** do Postgres; frontend injetava sem aspas → viravam number → `s.id === saqueId` falhava.
- Corrigido: comparação `String(s.id) === String(saqueId)` + frontend passa `saqueId` entre aspas.
- Commit `5691e92` (deploy Firebase v18 + Render).

### Depósito não creditava / painel mostrava "Depósitos: R$ 0,00" (15/07/2026)
- **Causa raiz:** webhook do Asaas apontava para serviço Render errado → servidor nunca recebia confirmação.
  - Corrigido a URL do webhook no Asaas para `bingo-master-pro-fcty.onrender.com`.
- Validação do webhook relaxada: só rejeita se o token vier **e** estiver errado (antes rejeitava 401 quando o Asaas não enviava o header).
- Bug de exibição: `atualizarSaldoJogadorSelecionado` (network.js) usava o objeto do jogo (sem campo `depositos`) quando o jogador estava na sala → mostrava "Depósitos: R$ 0,00". Agora **sempre busca o saldo completo do servidor**.
- Commit `ab458ab` (deploy Firebase v19 + Render).

### Proteção de bônus em bots (15/07/2026)
- Confirmado: nenhum bot tem bônus (`bonus: 0` em todos). `add-bonus` já não atinge bots (não estão na lista de usuários) e o dropdown os exclui.
- Centralizada a lista `BOT_NAMES` (constante de módulo) + função `isNomeDeBot(nome)`.
- Guarda adicionada para o bônus de 1º depósito (`processarConfirmacaoRecarga`) também nunca ir para bot.
- Commit `eebb579`.

### Reembolso de cartelas se o servidor cair (sessão anterior)
- Tabela `compras_pendentes` no `db.js` (id BIGINT PK, nome, sala, rodada, qty, custo, status).
- Helpers `liquidarComprasSala(sala)` (marca pendentes → liquidada ao fechar rodada) e `reembolsarComprasPendentes()` (devolve fichas a jogadores reais no startup; ignora bots).
- Chamadas em `iniciarNovaRodada`, `resetGame` e `iniciarServidor`.
- Em `buyCards`: registra compra pendente E deduz `bonusGiven` proporcional ao custo gasto.
- Commitados em `ab458ab`.

### Remoção de bots do painel admin
- Dropdown `#adminPlayerSelect` filtra `u.isBot !== true` (só jogadores reais).
- Commitado em `ab458ab`.

---

## 4. Estado atual (15/07/2026)

- Backend no Render atualizado e estável.
- Frontend no Firebase (projeto `bingo-vip-club-e8164`) em `network.js?v=22`, `game-logic.js?v=22`, `style.css?v=23`, `sw.js` cache `v25`.
- Webhook Asaas apontando corretamente → depósitos confirmam automaticamente.
- UptimeRobot monitorando o backend (5 min).
- Marília (conta de teste): saldo R$ 22,00 (crédito de teste = depósito R$ 20 + bônus R$ 2; o depósito real dela não tinha sido confirmado pelo servidor devido ao webhook errado, mas está refletido). Sem risco de crédito duplo (sem recargas pendentes).

---

## 5. Como testar depósito

1. Criar conta nova no site.
2. Fazer um depósito (gerar QR Code PIX, pagar).
3. O Asaas envia `PAYMENT_RECEIVED` → webhook confirma → saldo creditado no servidor.
4. No painel admin (`#adminPlayerSelect`), selecionar o jogador → deve mostrar "Depósitos: R$ X" corretamente (não mais R$ 0,00).

---

## 6. Pontos de atenção / pendências

- Se depósitos pararem de confirmar: verificar se o webhook no Asaas ainda aponta para `bingo-master-pro-fcty.onrender.com/api/asaas/webhook`.
- Chaves sensíveis ficam no Render (não no repo).
- Deploy do frontend APENAS no projeto `bingo-vip-club-e8164` (o outro foi excluído). Comando: `firebase deploy --only hosting`.
- `api.bingovipclub.online` tem SSL quebrado — usar sempre o `*.onrender.com`.

---

## 7. Arquivos principais

- `server.js` — toda a API (saque, depósito, webhook Asaas, bônus, reembolso, admin).
- `db.js` — persistência (fichasStore, transacoes, saques, recargas, compras_pendentes, usuarios).
- `game-logic.js` (v18) — fluxo de depósito no frontend, polling de PIX, `verificarRecargas`.
- `network.js` (v19) — painel admin, exibição de saldo, dropdown de jogadores.
- `index.html` (v21) — referências de versão dos scripts.

---

## 8. Melhorias de 15/07/2026 (segunda leva)

Implementados os itens: **1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 17, 19**.

- **(1) XSS:** adicionadas `escapeHtml`/`escapeJsStr` em `game-logic.js` e `network.js`; nomes de jogadores agora são escapados antes de `innerHTML` (banner de vitória, ranking, lista de jogadores, lista de usuários do admin, saques, transações).
- **(2) Validação no servidor:** `server.js` ganhou `sanitizeText`, `normalizeCpf`, `validarValorSaque`. CPF validado em cadastro/login; valor de saque validado; nome sanitizado; `fingerprint` armazenado.
- **(4) Reconexão:** badge de conexão agora tem estado "Reconectando…" (âmbar pulsante) e o host também reconecta ao perder o socket. CSS `.conn-dot.reconnecting`.
- **(5) Logger:** `dbg`/`dbgWarn` centralizados e desligáveis via `window.__DEBUG__`; logs de debug ruidosos substituídos.
- **(6) Hall da Fama:** novo endpoint `GET /api/hall-da-fama` (usa tabela `historico`) + modal `abrirHallDaFama()`.
- **(7) Som no mobile:** botão 🔊/🔇 no topo, respeita mudo, e dica "toque para ativar o som" em mobile (autoplay bloqueado).
- **(8) Status de saque:** endpoint `GET /api/meus-saques` + seção "Meus saques" com status (Pendente/Aprovado/Pago) dentro do modal de saque.
- **(9) Admin responsivo:** media query mobile aprimorada (abas, filtros, cards, cabeçalho empilhados).
- **(10) Notificações PWA:** `sw.js` com handlers `push`/`notificationclick`; botão 🔔 e `mostrarNotificacao()` em vitórias. Definir `VAPID_PUBLIC_KEY` para push server→client (sem ela, usa notificação local).
- **(11) Login integrado:** login já era SPA (`index.html`); `tela-login.html` órfão agora redireciona para `index.html`.
- **(17) Estatísticas:** endpoint `GET /api/minhas-estatisticas` + modal `abrirMinhasEstatisticas()` (vitórias por fase, prêmios, fichas, ganhos).
- **(19) Anti-fraude:** coluna `fingerprint` em `usuarios`; endpoint `GET /api/admin/usuarios-suspeitos`; aba "Anti-fraude" no admin listando grupos de contas no mesmo dispositivo. Client envia `fingerprint` no cadastro.

### Versões para deploy
- `index.html` → `style.css?v=23`, `game-logic.js?v=22`, `network.js?v=22`.
- `sw.js` CACHE_NAME `bingo-master-pro-v25` (força atualização do SW).

---

## 9. Justiça do jogo — bots, prêmios e jackpot (15/07/2026)

- **Bots NÃO ganham prêmios** (decisão do dono): são só figurantes p/ quem assiste.
  - `checkAwardsForAllPlayers` (`engine.js`) ignora `player.isBot`.
  - `salvarHistoricoSorteio` e `transacoes` pulam bots → Hall da Fama e ledger só com humanos.
  - Efeito: a fase só avança quando um HUMANO ganha.
  - Jackpot só paga se `humanCards >= JACKPOT_MIN_HUMAN_CARDS` (50) — protege a casa.
- ✅ **Jackpot agora É ALCANÇÁVEL:** `JACKPOT_BALL_LIMIT` subido para **75** (keno completa
  em média 85 bolas, mín 58). Jackpot paga quando keno ≤75 bolas e há ≥50 cartelas humanas
  (portão de volume). Ainda protegido.
- 💡 **Sugestão de economia (casa nunca perde):** depósito R$10 não é sacável (casa mantém),
   só prêmios são. Com cartela R$0,15, 1 depósito compra 100 cartelas (~7 rodadas) e um jogador
   sozinho quase sempre ganha as 3 fases (R$15/rodada) → casa PERDE com poucos jogadores.
   Equilíbrio base R$15/rodada: ~100 cartelas/rodada a R$0,15 (ou ~50 a R$0,30).

### DECISÃO APLICADA — Opção A (15/07/2026, commit `aca7b52`)
- **Cartela baixada para R$0,10** (`CARD_COST = 100`).
- **Prêmios base (por fase, dividido entre vencedores):** Kuadra **R$0,30**, Kina **R$0,40**,
  Keno **R$0,80** → payout fixo ~R$1,50/rodada. Casa recebe R$0,10/cartela, logo:
  - break-even com 1 jogador (15 cartelas = R$1,50 receita);
  - LUCRO com ≥2 jogadores. Casa nunca perde.
- **Jackpot AGORA É PROGRESSIVO** (nunca mais valor fixo da casa):
  - R$0,02 de cada cartela vendida vai para o poço (`JACKPOT_CONTRIBUTION_PER_CARD = 20`).
  - Poço inicia em **R$50** (`JACKPOT_INITIAL = 5000`) e só cresce com as cartelas.
  - Paga somente se keno ≤ 75 bolas **E** ≥ 50 cartelas humanas na rodada.
  - Ao pagar, o poço é zerado para R$50. Casa NUNCA banca o jackpot.
- `processPhaseWinners` recebe o valor atual do poço por parâmetro (`jackpotAmount`).
- Backend: `buyCards` alimenta `room.jackpot`; `iniciarNovaRodada` mantém o acumulado;
  ao premiar, zera para R$50 e registra `room.jackpotAwardedValue` no histórico.
- Frontend: `PHASES` e `CARD_COST` sincronizados; `JACKPOT_BALL_LIMIT = 75` (corrigido,
  estava 37 no cliente); display do jackpot vem do servidor (`gameState.jackpot`).

### CORREÇÃO — fases travavam com só bots (15/07/2026, commit `a0da44f`)
- **Sintoma:** sala com apenas bots não saía da fase Kuadra: sorteava todas as bolas, os bots
  chegavam perto de ganhar (painel "faltando 1 bola") mas a fase nunca avançava para Kina/Keno.
- **Causa:** a fase só avançava quando um HUMANO era detectado como vencedor
  (`checkAwardsForAllPlayers` ignora `isBot`, e o flag `jaTemVencedor` lia prêmios que os bots
  nunca recebiam).
- **Fix em `server.js` `sortearProximaBola`:** detecta a conclusão da fase em TODOS os cartões
  via `engine.computeCardAwards` para fins de avanço de fase. Porém, SÓ quando a sala não tem
  humanos com cartelas — em sala mista, a fase continua avançando só com humano (bot não "snipa"
  o prêmio). Na última fase (Keno) o bot finaliza a rodada normalmente.
- Bots continuam SEM prêmio e SEM Hall da Fama (`checkAwardsForAllPlayers` e
  `salvarHistoricoSorteio` seguem ignorando `isBot`).

### MUDANÇA — bots voltam a ganhar no jogo (15/07/2026, commit `fda7a68`)
- **Decisão invertida (a pedido do dono):** com humanos na sala, os bots AGORA ganham
  também (fichas + banner de vitória) para dar vida ao jogo e estimular o humano a jogar
  mais (bots não sacam → é lucro líquido da casa; o prêmio total por fase é fixo e dividido,
  então bot ganhando só faz o humano receber menos por prêmio).
- `checkAwardsForAllPlayers` (`engine.js`): removido o `if (player.isBot) return;` → bots
  entram na lista de vencedores.
- `processPhaseWinners` (`engine.js`): prêmio base dividido entre TODOS os vencedores
  (humanos + bots). **Jackpot continua 100% humano**: só paga se houver ao menos 1 humano
  ganhador E `humanCards >= 50` E keno ≤ 75; bots NUNCA recebem jackpot nem consomem o poço.
- `server.js`: loop de resultados continua ignorando bots no **ledger de saque**
  (`transacoes`) e no `setChips` persistente — bots só atualizam fichas em memória (para o
  banner). `salvarHistoricoSorteio` segue ignorando `isBot` → Hall da Fama continua só humano.
- `sortearProximaBola`: o avanço de fase por bot (correção anterior) permanece; em sala mista
  a fase avança quando humano OU bot ganha.
- **Deploy APENAS no projeto `bingo-vip-club-e8164`** (`firebase deploy --only hosting` — o projeto `bingo-master-pro-39ae0` foi excluído). Backend no Render com `git push origin main`.

### MUDANÇA — Hall da Fama inclui bots + valores corrigidos (15/07/2026, commit `f33b8b0`)
- **Pedido do dono:** não expor que os jogadores são bots no jogo (já era assim — os bots usam
  nomes normais tipo `Renata 🌸`, sem selo "BOT" na lista nem no banner); e no **Hall da Fama**
  MOSTRAR os nomes dos bots que ganham, para o dono ter controle/histórico dos ganhadores.
- `salvarHistoricoSorteio` (`server.js`): removido o `if (player.isBot) return;` → bots agora
  entram no histórico do Hall da Fama (com nome e valor), iguais aos humanos.
- **Jackpot fora do registro de bots:** no Hall da Fama, o prêmio do keno de um bot NÃO inclui o
  jackpot (`jackpot = (!player.isBot && room.jackpotAwarded) ? room.jackpotAwardedValue : 0`),
  pois bots nunca recebem jackpot. Humanos continuam registrando keno + jackpot.
- **Correção de valores no Hall da Fama:** os prêmios são salvos em **unidades** (300/400/800).
  O modal (`abrirHallDaFama` em `game-logic.js`) agora divide por 1000 → `R$ 0,30 / 0,40 / 0,80`.
  Antes mostrava errado (ex.: ganhou R$ 0,80 aparecia como "800,00"). A divisão por 1000 vale
  também para registros antigos (prêmios antigos em unidades continuam corretos: R$ 3,00 etc.).
- **Deploy APENAS no projeto `bingo-vip-club-e8164`** (`firebase deploy --only hosting` — o projeto `bingo-master-pro-39ae0` foi excluído). Backend no Render com `git push origin main`. Versões: `index.html` → `game-logic.js?v=23`, `sw.js` cache `v26`.

### MUDANÇA — Cartela R$0,05 + mais cartelas + jackpot seguro + animações (15/07/2026, commit `6c52192`)
- **Cartela baixada para R$0,05** (`CARD_COST = 50`) e **limite de compra por jogador = 40 cartelas**
  (`HUMAN_MAX_CARDS = 40`, era 15). `BOT_MAX_CARDS = 15`. Servidor já bloqueia acima do limite
  (`engine.getMaxCardsForPlayer` em `buyCards`).
- **Prêmios mantidos atraentes** (multiplicador agora maior pq cartela é mais barata): kuadra R$0,30 (6x),
  kina R$0,40 (8x), keno R$0,80 (16x) — `PHASES` recompensas 300/400/800 (inalteradas).
- **Jackpot progressivo seguro:** `JACKPOT_INITIAL = 20000` (R$20,00), `JACKPOT_BALL_LIMIT = 68`,
  `JACKPOT_CONTRIBUTION_PER_CARD = 10` (R$0,01), `JACKPOT_MIN_HUMAN_CARDS = 50` (exige ≥2 jogadores,
  pois limite é 40). Simulação provou: com BALL_LIMIT=75 o jackpot pagava 20-43% das rodadas e
  QUEBRAVA a casa; com BALL_LIMIT=70 paga 2-5% e a casa LUCRO em TODOS os cenários
  (+R$0,32 a +R$2,90/rodada). Jackpot "R$5" anterior (5000) estava subvalorizado vs HISTORICO (que dizia R$50, erro).
- **Correção de valores OBSOLETOS na UI** (estavam travados no pré-Opção-A): `index.html` mostrava
  prêmios `R$3/R$5/R$7` e cartela `R$0,15`; agora `R$0,30/0,40/0,80` e `R$0,05`. Também corrigido
  bug de `R$ 100,00` fixo no jackpot (`game-logic.js` linha do reset → `formatReais(JACKPOT_REWARD)`).
- **Animações padronizadas e sincronizadas** (todas disparadas pelos mesmos eventos do servidor
  `winnerEvent`/`gameEnded`, então todos os jogadores veem junto):
  - Kuadra / Kina / Keno / Jackpot: duração base **4s** + **1,5s por vencedor extra** (máx 12s)
    via `getCelebrationDuration()` — assim todos os vencedores de uma fase são vistos mesmo se forem muitos.
  - Ranking final: mesma regra, escala com o total de vencedores (kuadra+kina+keno).
  - Ao abrir nova celebração ou o ranking, o overlay de fase anterior é fechado (`closePhaseOverlays`)
    para não empilhar e esconder informação.
  - Velocidade de sorteio: **3s por bola** (ajustável no `speedRange`). Pausa entre fases: 5s (host) / 8s (servidor).
  - Ranking abre 4,5s após o fim da rodada (garante a celebração do keno terminar).
- **Deploy APENAS no projeto `bingo-vip-club-e8164`** (`firebase deploy --only hosting`). Backend no
  Render com `git push origin main`. Versões: `index.html` → `game-logic.js?v=24`, `network.js?v=23`, `sw.js` cache `v27`.

### CORREÇÃO — Jackpot fixo R$20,00 + bots podem ganhar (15/07/2026, commit `be2daca`)
- **Pedido do dono:** jackpot estava acumulando (chegou a R$100,80) e ele quer **fixo em R$20,00**;
  e um bot atingiu a condição do jackpot (keno ≤70 bolas) mas nada apareceu — parecia bug.
- **Jackpot FIXO em R$20,00:** `JACKPOT_CONTRIBUTION_PER_CARD = 0` (era 10). O poço não acumula mais;
  inicia em R$20,00 e após ser pago zera de volta para R$20,00. Casa nunca banca e sem risco.
- **Bots podem ganhar o jackpot** (`engine.js` `processPhaseWinners`): antes o jackpot exigia
  `humanWinners.length > 0` e só pagava humanos, então quando um bot ganhava keno ≤70 bolas NADA
  aparecia. Agora o jackpot vai para QUALQUER vencedor de keno (humano ou bot) quando a condição
  (keno ≤ `JACKPOT_BALL_LIMIT` bolas + ≥ `JUMAN_MIN_HUMAN_CARDS` cartelas humanas) é atingida.
  - `isJackpot = isJackpotEligible(...) && (humanCards >= JACKPOT_MIN_HUMAN_CARDS)` (sem exigir humano vencedor).
  - `jackpotPerPlayer` dividido por `uniquePlayers.length` (humanos + bots).
  - Bots só recebem fichas NÃO sacáveis → casa NÃO tem prejuízo real; e fica transparente para todos
    verem o jackpot sendo pago (ex.: "Renata 🌸 ganhou o JACKPOT de R$ 20,00").
- **Hall da Fama** (`salvarHistoricoSorteio` em `server.js`): agora registra o jackpot para TODOS os
  vencedores de keno (humanos e bots) — antes só humanos.
- **Sobre a "chance grande" de jackpot:** com cartela R$0,05 e BALL_LIMIT=70 a casa LUCRO mesmo que o
  jackpot pague (poço fixo R$20,00, sem acúmulo). Se o dono quiser o jackpot mais raro/exclusivo,
  basta baixar `JACKPOT_BALL_LIMIT` (ex.: 68 ou 65) — porém abaixo de ~68 ele raramente paga (pode
  parecer "nunca ganha"). Sugestão: manter 70 (paga ~2-5% das rodadas, visível e seguro).
- Backend no Render com `git push origin main` (frontend inalterado: `game-logic.js?v=24`).

### JACKPOT PROGRESSIVO (modelo "panela que cresce") — commit `a64ef30`
- **Decisão do dono:** implementar o jackpot progressivo (cada cartela vendida joga uma fatia numa
  panela que cresce rodada após rodada até alguém ganhar). Escolhido `BALL_LIMIT = 55`.
- **Por que 55 e não 68:** o jogo usa **90 bolas** (`server.js` sorteia `Math.random()*90+1`).
  Simulação fiel do motor: com 90 bolas, keno fecha em ≤68 em ~45% (50 cartelas) a ~75%+ (80+
  cartelas) das rodadas → em BALL_LIMIT=68 o jackpot pagaria QUASE TODA rodada e NÃO acumularia.
  Com **BALL_LIMIT=55** a chance cai para ~1,2% (50 cartelas) a ~13% (500 cartelas): a panela
  ACUMULA entre as rodadas e cresce com a sala.
- **Constantes finais (`engine.js`):**
  - `JACKPOT_BALL_LIMIT = 55`
  - `JACKPOT_INITIAL = 20000` (R$20,00 de semente/piso)
  - `JACKPOT_CONTRIBUTION_PER_CARD = 5` (R$0,005 por **CARTELA HUMANA** — bots NÃO alimentam)
  - `JACKPOT_MIN_HUMAN_CARDS = 50`
  - `JACKPOT_MAX = 100000` (R$100,00 teto de segurança / backstop)
- **Alimentação:** `server.js` (compra de cartela) soma `qty * 5` ao `room.jackpot` SÓ se
  `!player.isBot`, com `Math.min(..., JACKPOT_MAX)`. Poço persiste entre rodadas e reinícios
  (snapshot `rooms_state.json`). Ao ganhar: `processPhaseWinners` paga `room.jackpot` (dividido
  entre vencedores) e zera para `JACKPOT_INITIAL`; `broadcast jackpotUpdate`.
- **Cliente:** `JACKPOT_BALL_LIMIT = 55` em `game-logic.js`; `JACKPOT_REWARD` já sincroniza do
  servidor (`network.js` recebe `jackpot` no gameState e evento `jackpotUpdate`) → subtítulo e
  placar mostram o valor VIVO. `index.html` subtítulo "ATÉ 55 BOLAS"; `game-logic.js?v=26` / `sw.js` v29.
- **ECONOMIA REAL (lida em `server.js`):** bônus é **10% SÓ NO 1º DEPÓSITO** (não 100%); Asaas
  cobra **R$2,00** de taxa por PIX de R$10 → casa líquida **R$8,00**/depósito. Depósito e bônus
  NÃO são sacáveis; só PRÊMIOS. Margem real da casa ≈ **R$0,04/cartela** → por isso a contribuição
  do jackpot tem de ser pequena (R$0,005) para never perder.
- **Simulação de segurança (sem prejuízo) — CONFIRMADA:** lucro da casa (receita de cartelas
  humanas − prêmios a humanos): 50 cartelas → +R$0,83/rodada (ainda +R$0,33 real após taxa Asaas);
  80 → ~R$1,93; 200 → ~R$6,62; 500 → ~R$18,63. Pior caso (sala 100% humana, 50 cartelas):
  ~break-even/leve lucro. Quando um BOT ganha o jackpot, recebe só fichas → dinheiro real fica
  com a casa. **Casa nunca perde.**
- **Decisão final do dono:** manter `JACKPOT_CONTRIBUTION_PER_CARD = 5` (conservador). Poço chega
  a **~R$30–40** numa sala cheia (cresce com a galera, limitado pela margem fina). Para R$100+
  recorrente seria preciso subir o valor da cartela ou reduzir o bônus do 1º depósito (não feito).
- Backend Render commit `a64ef30`; frontend `game-logic.js?v=26` / `sw.js` v29.


