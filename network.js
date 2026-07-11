// CONFIGURAÇÃO DO BACKEND (servidor autoritativo)
// Local: ws://<host>:3000 (server.js). Produção (GitHub Pages / domínio próprio): aponte para o seu backend.
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
const WS_SERVER_URL = IS_LOCAL
    ? `ws://${window.location.hostname}:3000`
    : `wss://bingo-master-pro-2026.onrender.com`; // <-- PRODUÇÃO Render

let socket = null;
let souDono = false;
let modoTesteSaque = false; // MODO TESTE: permite sacar créditos adicionados pelo admin (somente admin habilita)
let socketReady = false;
let myId = '';
let myRole = '';
let myRoomId = '';
let pendingConnect = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let heartbeatInterval = null;
let backgroundPingInterval = null;
const MAX_RECONNECT_ATTEMPTS = 999;
const RECONNECT_BASE_DELAY = 500;
const HEARTBEAT_INTERVAL = 3000;

function loadChips(name) {
    const key = `bingo_fichas_${name.toLowerCase().trim()}`;
    const saved = localStorage.getItem(key);
    return saved !== null ? parseInt(saved, 10) : (typeof INITIAL_CHIPS !== 'undefined' ? INITIAL_CHIPS : 1000);
}

function saveChips(name, amount) {
    const key = `bingo_fichas_${name.toLowerCase().trim()}`;
    localStorage.setItem(key, amount);
}

async function syncChipsFromServer(cpf, name) {
    if (!cpf || !name) return 0;
    try {
        const res = await fetch(API_BASE + '/api/fichas/' + cpf);
        const data = await res.json();
        if (data.chips !== undefined) {
            saveChips(name, data.chips);
            return data.chips;
        }
    } catch (e) {
        console.error('[SYNC] Erro ao sincronizar fichas:', e);
    }
    return 0;
}

function setStatusMessage(message, type = 'info') {
    const statusBox = document.getElementById('connectionStatusMsg');
    const statusTxt = document.getElementById('statusTxt');
    if (!statusBox || !statusTxt) return;

    statusBox.style.display = 'block';
    statusTxt.textContent = message;

    statusBox.style.background = type === 'connected'
        ? 'rgba(46, 204, 113, 0.12)'
        : type === 'error'
            ? 'rgba(231, 76, 60, 0.12)'
            : 'rgba(79, 172, 254, 0.12)';
    statusTxt.style.color = type === 'connected'
        ? '#2ecc71'
        : type === 'error'
            ? '#e74c3c'
            : '#4facfe';
}

function updateConnectionBadge(connected) {
    const dot = document.getElementById('connDot');
    const status = document.getElementById('connStatus');
    if (!dot || !status) return;

    if (connected) {
        dot.classList.remove('disconnected');
        status.textContent = 'Conectado ao Bingo';
    } else {
        dot.classList.add('disconnected');
        status.textContent = 'Não conectado';
    }
}



// Apenas o DONO (CPF específico) tem acesso ao painel de admin.
// Exige login (CPF + senha) com este CPF — ninguém mais o verá.
const DONO_CPF = '05893761600';
function isMarcosName() {
    const cpf = (typeof meuCpf !== 'undefined' && meuCpf) ? String(meuCpf).replace(/\D/g, '') : '';
    return cpf === DONO_CPF;
}

function connectSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const token = typeof minhaSessaoToken !== 'undefined' ? minhaSessaoToken : '';
        const cpf = typeof meuCpf !== 'undefined' ? meuCpf : '';
        if (token && cpf) socket.send(JSON.stringify({ type: 'auth', sessionToken: token, cpf }));
        if (pendingConnect) socket.send(JSON.stringify(pendingConnect));
        return;
    }

    socketReady = false;
    if (socket) {
        socket.close();
    }

    socket = new WebSocket(WS_SERVER_URL);

    socket.addEventListener('open', () => {
        socketReady = true;
        reconnectAttempts = 0;
        updateConnectionBadge(true);
        showOfflineBanner(false);
        if (typeof hideSpinner === 'function') hideSpinner();
        startHeartbeat();
        // Autenticacao com sessao
        const token = typeof minhaSessaoToken !== 'undefined' ? minhaSessaoToken : '';
        const cpf = typeof meuCpf !== 'undefined' ? meuCpf : '';
        if (token && cpf) {
            socket.send(JSON.stringify({ type: 'auth', sessionToken: token, cpf }));
        }
        if (pendingConnect) {
            socket.send(JSON.stringify(pendingConnect));
        }
    });

    socket.addEventListener('message', (event) => {
        handleSocketMessage(event.data);
    });

    socket.addEventListener('close', (event) => {
        socketReady = false;
        stopHeartbeat();
        if (pendingConnect) {
            showOfflineBanner(true);
            scheduleReconnect();
        } else {
            updateConnectionBadge(false);
            showOfflineBanner(false);
        }
    });

    socket.addEventListener('error', () => {
        showOfflineBanner(true);
    });
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        } else if (!socket || socket.readyState === WebSocket.CLOSED) {
            stopHeartbeat();
            if (pendingConnect) scheduleReconnect();
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts = 0;
        showOfflineBanner(false);
        return;
    }

    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.2, reconnectAttempts), 5000);
    reconnectAttempts++;

    reconnectTimeout = setTimeout(() => {
        if (pendingConnect) {
            showOfflineBanner(true);
            connectSocket();
        }
    }, delay);
}

function cancelReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    reconnectAttempts = 0;
}

function keepalivePing() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
    }
}

window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.close(1000, 'Cliente saindo');
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            backgroundPingInterval = setInterval(keepalivePing, 2000);
        }
    } else {
        if (backgroundPingInterval) {
            clearInterval(backgroundPingInterval);
            backgroundPingInterval = null;
        }
        cancelReconnect();
        if (pendingConnect && (!socket || socket.readyState !== WebSocket.OPEN)) {
            connectSocket();
        }
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
            if (typeof requestWakeLock === 'function') requestWakeLock();
        }
    }
});

let joinRetryTimeout = null;

function tryJoinHost(attempt) {
    if (myRole !== 'guest' || !myId || !myName) return;
    if (socketReady) {
        sendToHost({ type: 'join', id: myId, name: myName, cards: myCards, chips: myChips });
    }
    if (attempt < 10) {
        joinRetryTimeout = setTimeout(() => tryJoinHost(attempt + 1), 2000);
    }
}

function cancelJoinRetry() {
    if (joinRetryTimeout) {
        clearTimeout(joinRetryTimeout);
        joinRetryTimeout = null;
    }
}

function handleSocketMessage(raw) {
    let message;
    try {
        message = JSON.parse(raw);
    } catch (err) {
        console.error('Invalid WS message:', raw, err);
        return;
    }

    if (message.type === 'pong') {
        return;
    }

    if (message.type === 'auth_ok') {
        console.log('[AUTH] Autenticado como', message.nome);
        return;
    }

    if (message.type === 'auth_error') {
        console.warn('[AUTH]', message.message);
        localStorage.removeItem('bingo_session_token');
        localStorage.removeItem('bingo_meu_cpf');
        minhaSessaoToken = '';
        meuCpf = '';
        if (typeof goToScreen === 'function') goToScreen('screenHome');
        showToast(message.message, 'error');
        return;
    }

    if (message.type === 'forcedDisconnect') {
        showToast(message.message, 'error', 5000);
        if (typeof goToScreen === 'function') setTimeout(() => goToScreen('screenHome'), 100);
        return;
    }

    if (message.type === 'accountDeleted') {
        showToast(message.message || 'Sua conta foi removida pelo administrador.', 'error', 6000);
        setTimeout(() => {
            if (typeof sairDaConta === 'function') {
                sairDaConta();
            } else if (typeof goToScreen === 'function') {
                goToScreen('screenHome');
            }
        }, 800);
        return;
    }

    if (message.type === 'modoTesteUpdate') {
        modoTesteSaque = !!message.ligado;
        console.log('[MODO TESTE]', message.ligado ? 'LIGADO' : 'DESLIGADO');
        return;
    }

    if (message.type === 'connected') {
        if (message.role === 'host' && myRole === 'host') {
            myId = 'host';
            myRoomId = message.roomId || myRoomId;
            if (!allPlayers || allPlayers.length === 0) {
                allPlayers = [{ id: 'host', name: myName, chips: myChips, winnings: myWinnings || 0, cards: myCards || [], isHost: true }];
            }
            updatePlayerListUI();
            goToScreen('screenGame');
            const hostMsg = document.getElementById('hostOnlyMsg');
            const adminUI = document.getElementById('adminPanelTop');
            if (hostMsg) hostMsg.style.display = 'block';
            if (adminUI && isMarcosName(myName)) {
                adminUI.style.display = 'block';
                setTimeout(() => { adminAbrirAba('tabSaques'); carregarModoTeste(); carregarAdminUsuariosComSaldo(); carregarUsuariosParaExclusao(); }, 300);
            }
            document.getElementById('btnSacar').style.display = '';
            document.getElementById('btnDeposit').style.display = '';
            setStatusMessage(`Sala pública criada. Código: ${myRoomId}`, 'connected');
            updateConnectionBadge(true);
            if (typeof restaurarEstadoHost === 'function') setTimeout(restaurarEstadoHost, 1500);
            else if (typeof iniciarAutoStart === 'function') setTimeout(iniciarAutoStart, 1500);
            if (typeof drawnBalls !== 'undefined' && typeof currentPhaseIndex !== 'undefined') {
                sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            }
        }

        if (message.role === 'guest' && myRole === 'guest') {
            myId = message.id || myId;
            myRoomId = message.roomId || myRoomId;
            updateConnectionBadge(true);
            souDono = !!(message.dono || isMarcosName(myName));
            goToScreen('screenGame');
            setTimeout(() => {
                const btnSacar = document.getElementById('btnSacar');
                const btnDeposit = document.getElementById('btnDeposit');
                if (btnSacar) btnSacar.style.display = '';
                if (btnDeposit) btnDeposit.style.display = '';
            }, 50);
            if (souDono) {
                const adminUI = document.getElementById('adminPanelTop');
                if (adminUI) adminUI.style.display = 'block';
                setTimeout(() => { adminAbrirAba('tabSaques'); carregarModoTeste(); carregarAdminUsuariosComSaldo(); carregarUsuariosParaExclusao(); }, 300);
            }
        }

        if (message.role === 'spectator' && myRole === 'spectator') {
            myId = message.id || myId;
            myRoomId = message.roomId || myRoomId;
            updateConnectionBadge(true);
            goToScreen('screenGame');
            hideBotoesFinanceiros();
            setNullableStyle('readySection', 'display', 'none');
            setNullableStyle('buySection', 'display', 'none');
            setNullableStyle('hostOnlyMsg', 'display', 'none');
            setNullableStyle('adminPanelTop', 'display', 'none');
            if (typeof setStatusMessage === 'function') {
                setStatusMessage('Modo espectador - Apenas observando', 'info');
            }
        } else if (myRole === 'spectator') {
            // Fallback: servidor enviou role diferente, mas cliente é espectador
            myId = message.id || myId;
            myRoomId = message.roomId || myRoomId;
            updateConnectionBadge(true);
            goToScreen('screenGame');
            hideBotoesFinanceiros();
            if (typeof setStatusMessage === 'function') {
                setStatusMessage('Modo espectador - Apenas observando', 'info');
            }
        }
        return;
    }

    if (message.type === 'error') {
        setStatusMessage(message.message || 'Erro no servidor WebSocket.', 'error');
        updateConnectionBadge(false);
        return;
    }

    if (message.type === 'hostDisconnected') {
        setStatusMessage('O anfitrião encerrou a sala ou a conexão caiu.', 'error');
        updateConnectionBadge(false);
        return;
    }

    if (message.type === 'relay') {
        handleRelayMessage(message.data, message.from, message.id, message.name);
        return;
    }

    if (message.type === 'buySuccess') {
        if (message.chips !== undefined) myChips = message.chips;
        if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
        if (typeof renderMyCards === 'function') renderMyCards();
        if (typeof showToast === 'function') showToast(`${message.qty} cartela(s) comprada(s)!`, 'success');
        return;
    }

    if (message.type === 'buyError') {
        if (typeof showToast === 'function') showToast(message.message || 'Erro na compra.', 'error', 4000);
        return;
    }
}

function handleRelayMessage(data, senderRole, senderId, senderName) {
    if (!data?.type) return;

    if (myRole === 'host' && senderRole === 'guest') {
        if (data.type === 'join') {
            const guestId = senderId || data.id || `guest-${Date.now()}`;
            const guestName = senderName || data.name || 'Convidado';
            const guestChips = loadChips(guestName);
            const guestWinnings = typeof loadWinningsFor === 'function' ? loadWinningsFor(guestName) : 0;
            const existing = allPlayers.find(p => p.name.toLowerCase() === guestName.toLowerCase());

            if (existing) {
                existing.id = guestId;
                existing.name = guestName;
                existing.chips = guestChips;
                existing.winnings = guestWinnings;
                existing.cards = data.cards || existing.cards || [];
                existing.isHost = false;
            } else {
                allPlayers.push({ id: guestId, name: guestName, chips: guestChips, winnings: guestWinnings, cards: data.cards || [], isHost: false });
            }

            updatePlayerListUI();
            if (typeof addLog === 'function') addLog('Um jogador entrou na sala.');
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex, gameActive, gameEnded });
            return;
        }

        if (data.type === 'buyCards') {
            const guest = allPlayers.find(p => p.id === senderId || p.name.toLowerCase() === (data.name || '').toLowerCase());
            if (guest) {
                guest.cards = data.cards || guest.cards;
                guest.chips = data.chips;
                saveChips(guest.name, guest.chips);
            }
            updatePlayerListUI();
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            return;
        }

        if (data.type === 'recargaFeita') {
            const guest = allPlayers.find(p => p.name.toLowerCase() === (data.nome || '').toLowerCase());
            if (guest) {
                guest.chips += data.fichas || 0;
                saveChips(guest.name, guest.chips);
            }
            updatePlayerListUI();
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            return;
        }

        if (data.type === 'readyToggle') {
            readyPlayers[senderId] = data.ready;
            if (typeof updateReadyUI === 'function') updateReadyUI();
            sendToGuest({ type: 'readyUpdate', readyPlayers });
            return;
        }

        if (data.type === 'spectatorJoined') {
            if (typeof drawnBalls !== 'undefined' && typeof allPlayers !== 'undefined') {
                sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex, gameActive, gameEnded });
                const closeMap = typeof computeCloseCardsForAllPlayers === 'function' ? computeCloseCardsForAllPlayers() : {};
                if (Object.keys(closeMap).length) {
                    sendToGuest({ type: 'closeCards', data: closeMap });
                }
            }
            return;
        }
    }

    if ((myRole === 'guest' || myRole === 'spectator' || myRole === 'host') && senderRole === 'host') {
        if (data.type === 'resetGame') {
            // Limpa as cartelas do jogador ao reiniciar a rodada
            myCards = [];
            saveCards(myName, myCards);
            if (typeof renderMyCards === 'function') renderMyCards();
        }
        if (data.type === 'gameState' || data.type === 'resetGame') {
            cancelJoinRetry();
            const overlay = document.getElementById('countdownOverlay');
            if (overlay) overlay.classList.remove('visible');
            allPlayers = data.players || allPlayers;
            const oldDrawnLen = drawnBalls.length;
            drawnBalls = data.drawnBalls || drawnBalls;
            if (data.currentPhaseIndex !== undefined) {
                currentPhaseIndex = data.currentPhaseIndex;
            }
            if (typeof updatePhaseUI === 'function') updatePhaseUI();
            if (typeof updateJackpotPanel === 'function') updateJackpotPanel();
            if (data.gameActive !== undefined) gameActive = data.gameActive;
            if (data.gameEnded !== undefined) {
                const wasEnded = gameEnded;
                gameEnded = data.gameEnded;
                if (gameEnded && !wasEnded && typeof showKenoRanking === 'function') {
                    setTimeout(showKenoRanking, 3000);
                }
            }
            if (data.currentRound !== undefined) {
                currentRound = data.currentRound;
                const roundEl = document.getElementById('currentRoundNumber');
                if (roundEl) roundEl.textContent = gameEnded ? `Sorteio #${data.currentRound} (encerrado)` : `Sorteio #${data.currentRound}`;
            }
            if (data.jackpot !== undefined) {
                JACKPOT_REWARD = data.jackpot;
                try { localStorage.setItem('bingo_jackpot_reward', JACKPOT_REWARD); } catch (e) {}
            }
            
            const me = allPlayers.find(p => p.id === myId || p.name.toLowerCase() === myName.toLowerCase());
            if (me) {
                myChips = me.chips;
                myCards = me.cards || myCards;
                myWinnings = me.winnings || 0;
                myAdminCredits = me.adminCredits || 0;
                saveChips(myName, myChips);
                if (typeof saveWinnings === 'function') saveWinnings();
                if (typeof saveAdminCredits === 'function') saveAdminCredits();
                if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
            }
            updatePlayerListUI();
            const novasBolas = data.drawnBalls || [];
            if (novasBolas.length !== oldDrawnLen) {
                if (typeof applyBoardReset === 'function') applyBoardReset();
                if (novasBolas.length && typeof applyDrawnBall === 'function') {
                    novasBolas.forEach(ball => applyDrawnBall(ball));
                }
            }
            if (typeof renderMyCards === 'function') renderMyCards();
            if (typeof updateJackpotPanel === 'function') updateJackpotPanel();
            if (typeof renderMissingNumbersPanel === 'function') renderMissingNumbersPanel();
            goToScreen('screenGame');
            return;
        }

        if (data.type === 'winnerEvent' && typeof showWinnerBanner === 'function') {
            const results = data.results || data.winners || [];
            if (data.winningBall) {
                try { window.__ultimaBolaVencedora = data.winningBall; } catch (e) {}
            }
            showWinnerBanner(data.phaseKey || data.phase, results);
            if (typeof playWinnerSound === 'function') {
                const isJackpot = results.some(r => r.jackpotCount > 0);
                if (!isJackpot) playWinnerSound(data.phaseKey || data.phase, results);
            }
            return;
        }

        if (data.type === 'syncBall') {
            drawnBalls = data.drawnBalls || drawnBalls;
            if (data.ball !== undefined && typeof applyDrawnBall === 'function') {
                applyDrawnBall(data.ball);
                try { if (typeof speak === 'function') speak(String(data.ball)); } catch (e) {}
            }
            if (typeof renderMissingNumbersPanel === 'function') renderMissingNumbersPanel();
            return;
        }

        if (data.type === 'closeCards' && typeof renderMyCards === 'function') {
            latestCloseCards = data.data || data.closeMap || {};
            renderMyCards();
            if (typeof renderCloseCardsPanel === 'function') renderCloseCardsPanel();
            if (typeof renderMissingNumbersPanel === 'function') renderMissingNumbersPanel();
            return;
        }

        if (data.type === 'confetti') {
            try { if (typeof launchConfetti === 'function') launchConfetti(); } catch (e) {}
            return;
        }

        if (data.type === 'jackpotUpdate') {
            try {
                JACKPOT_REWARD = data.value;
                localStorage.setItem('bingo_jackpot_reward', JACKPOT_REWARD);
                if (typeof updateJackpotPanel === 'function') updateJackpotPanel();
            } catch (e) {
                console.warn('Não foi possível atualizar jackpot localmente', e);
            }
            return;
        }

        if (data.type === 'adminUpdateChips') {
            allPlayers = data.players || allPlayers;
            const me = allPlayers.find(p => p.id === myId || p.name.toLowerCase() === myName.toLowerCase());
            if (me) {
                myChips = me.chips;
                myCards = me.cards || myCards;
                myWinnings = me.winnings || 0;
                myAdminCredits = me.adminCredits || 0;
                saveChips(myName, myChips);
                if (typeof saveWinnings === 'function') saveWinnings();
                if (typeof saveAdminCredits === 'function') saveAdminCredits();
                if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
            }
            updatePlayerListUI();
            if (typeof addLog === 'function') addLog('O teu saldo de fichas foi atualizado pelo Administrador.');
            return;
        }

        if (data.type === 'readyUpdate') {
            readyPlayers = data.readyPlayers || {};
            if (typeof updateReadyUI === 'function') updateReadyUI();
            return;
        }

        if (data.type === 'undoBall') {
            if (typeof applyBoardReset === 'function') applyBoardReset();
            drawnBalls = data.drawnBalls || [];
            if (drawnBalls.length && typeof applyDrawnBall === 'function') {
                drawnBalls.forEach(ball => applyDrawnBall(ball));
            }
            const mainBall = document.getElementById('mainBall');
            if (mainBall) mainBall.textContent = drawnBalls.length ? drawnBalls[drawnBalls.length - 1] : '-';
            if (typeof renderMyCards === 'function') renderMyCards();
            if (typeof updateJackpotPanel === 'function') updateJackpotPanel();
            if (typeof showToast === 'function') showToast('↩ O anfitrião desfez a última bola', 'warning');
            return;
        }

        if (data.type === 'updateSpectators') {
            const el = document.getElementById('spectatorCount');
            const num = document.getElementById('spectatorCountNum');
            if (el && num) {
                const c = data.count || 0;
                if (c > 0) {
                    el.style.display = '';
                    num.textContent = c;
                } else {
                    el.style.display = 'none';
                }
            }
            return;
        }

        if (data.type === 'preparingNewRound') {
            if (typeof fecharKenoRanking === 'function') fecharKenoRanking();
            return;
        }

        if (data.type === 'buyError') {
            if (typeof showToast === 'function') showToast(data.message || 'Erro na compra.', 'error', 4000);
            return;
        }

        if (data.type === 'buySuccess') {
            if (data.chips !== undefined) myChips = data.chips;
            if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
            if (typeof renderMyCards === 'function') renderMyCards();
            if (typeof showToast === 'function') showToast(`${data.qty} cartela(s) comprada(s)!`, 'success');
            return;
        }

        if (data.type === 'autoStart') {
            const s = data.seconds || 0;
            const min = Math.floor(s / 60);
            const seg = s % 60;
            const text = `${min}:${seg.toString().padStart(2, '0')}`;
            const timerEl = document.getElementById('autoStartTimer');
            if (timerEl) timerEl.textContent = text;
            const overlay = document.getElementById('countdownOverlay');
            const overlayTimer = document.getElementById('countdownTimer');
            if (s > 0) {
                if (overlay) overlay.classList.add('visible');
                if (overlayTimer) overlayTimer.textContent = text;
            } else {
                if (overlay) overlay.classList.remove('visible');
            }
            return;
        }

        if (data.type === 'advancePhase') {
            if (typeof data.currentPhaseIndex !== 'undefined') currentPhaseIndex = data.currentPhaseIndex;
            if (typeof updatePhaseUI === 'function') updatePhaseUI();
            if (typeof renderCloseCardsPanel === 'function') renderCloseCardsPanel();
            return;
        }

        if (data.type === 'notice') {
            if (typeof showToast === 'function') showToast(data.text || '', data.kind === 'success' ? 'success' : 'warning');
            return;
        }

        if (data.type === 'saqueNotificacao') {
            if (souDono && typeof showToast === 'function') {
                showToast(`💸 NOVO SAQUE: ${data.nome} - R$ ${data.valor.toFixed(2)}`, 'warning', 10000);
            }
            if (typeof carregarSaquesAdmin === 'function') carregarSaquesAdmin();
            return;
        }
    }
}


function setNullableStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

function hideBotoesFinanceiros() {
    const sacar = document.getElementById('btnSacar');
    const depositar = document.getElementById('btnDeposit');
    const depositarAlt = document.querySelector('.btn-deposit');
    if (sacar) sacar.style.display = 'none';
    if (depositar) depositar.style.display = 'none';
    if (depositarAlt) depositarAlt.style.display = 'none';
}


function conectarComoEspectador() {
    myName = 'Espectador';
    myRole = 'spectator';
    souDono = false;
    myId = `spec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    myRoomId = 'bingo-master-pro-marcos';
    isHost = false;
    cancelReconnect();
    pendingConnect = { type: 'connect', role: 'spectator', roomId: myRoomId, name: myName, id: myId };
    if (typeof showSpinner === 'function') showSpinner('Entrando como espectador...');
    connectSocket();
}

function sendToGuest(data) {
    if (!socketReady) {
        console.warn('Socket não está pronto para enviar comandos', data);
        return;
    }
    socket.send(JSON.stringify({ type: 'message', to: 'guests', roomId: myRoomId, data }));
}

function sendToHost(data) {
    if (!socketReady) {
        console.warn('Socket não está pronto para enviar comandos', data);
        return;
    }
    socket.send(JSON.stringify({ type: 'message', to: 'host', roomId: myRoomId, data }));
}

function executeAdminAction(action) {
    const select = document.getElementById('adminPlayerSelect');
    const amountInput = document.getElementById('adminChipAmount');
    if (!select || !amountInput) return;

    const selectedId = select.value;
    const amount = parseInt(amountInput.value, 10);
    console.log('[DEBUG executeAdminAction]', { selectedId, amount, action, socketReady });
    if (!selectedId || isNaN(amount) || amount <= 0) {
        showToast('Escolha um jogador e insira um valor válido.', 'warning', 3000);
        return;
    }

    if (typeof sendAction === 'function') {
        sendAction('adminChips', { targetId: selectedId, amount, mode: action });
    }
    if (typeof addLog === 'function') addLog(`Administrador ${action === 'remove' ? 'retirou' : 'adicionou'} ${amount.toLocaleString('pt-BR')} fichas.`);
    
    // Atualiza o painel de saldo do jogador selecionado
    setTimeout(atualizarSaldoJogadorSelecionado, 500);
}

function atualizarSaldoJogadorSelecionado() {
    const select = document.getElementById('adminPlayerSelect');
    const balanceDiv = document.getElementById('adminPlayerBalance');
    if (!select || !balanceDiv) return;
    
    const selectedNome = select.value;
    if (!selectedNome) {
        balanceDiv.innerHTML = 'Selecione um jogador acima para ver os detalhes.';
        return;
    }
    
    // Primeiro tenta encontrar na sala (allPlayers)
    const player = allPlayers.find(p => p.name === selectedNome);
    if (player) {
        mostrarSaldoJogador(player);
        return;
    }
    
    // Se não está na sala, busca no servidor pelo nome completo
    fetch(API_BASE + '/api/admin/usuarios-com-saldo')
        .then(r => r.json())
        .then(usuarios => {
            const usuario = usuarios.find(u => u.nomeCompleto === selectedNome);
            if (usuario) {
                mostrarSaldoJogador(usuario);
            } else {
                balanceDiv.innerHTML = 'Usuário não encontrado.';
            }
        })
        .catch(() => {
            balanceDiv.innerHTML = 'Erro ao buscar saldo do usuário.';
        });
}

function mostrarSaldoJogador(data) {
    const chipsReais = (data.chips / 1000).toFixed(2).replace('.', ',');
    const winningsReais = (data.winnings / 1000).toFixed(2).replace('.', ',');
    const adminCreditsReais = ((data.adminCreditos || 0) / 1000).toFixed(2).replace('.', ',');
    const saqueDisponivel = ((data.winnings + (data.adminCreditos || 0)) / 1000).toFixed(2).replace('.', ',');
    
    const balanceDiv = document.getElementById('adminPlayerBalance');
    if (!balanceDiv) return;
    
    balanceDiv.innerHTML = `
        <div style="margin:4px 0"><strong>${data.nomeCompleto || data.name}</strong></div>
        <div style="margin:2px 0">💰 Saldo fichas: <strong>R$ ${chipsReais}</strong></div>
        <div style="margin:2px 0">🏆 Ganhos (sacável normal): <strong>R$ ${winningsReais}</strong></div>
        <div style="margin:2px 0">🎁 Créditos admin: <strong>R$ ${adminCreditsReais}</strong></div>
        <div style="margin:6px 0;padding:6px;background:rgba(59,130,246,0.1);border-radius:4px;border:1px solid rgba(59,130,246,0.3)">
            💸 Saldo sacável: <strong>R$ ${saqueDisponivel}</strong>
        </div>
        <div style="font-size:0.75em;color:#6b6599;margin-top:4px">
            Mínimo saque: R$ 10,00 | Fichas depositadas não são sacáveis | Ganhos + Créditos admin são sacáveis
        </div>
    `;
}

function adminStartNow() {
    if (typeof sendAction === 'function') sendAction('startNow');
}

function adminResetGame() {
    if (typeof sendAction === 'function') sendAction('resetGame');
}

function sendAction(action, payload) {
    if (!socketReady) {
        console.warn('Socket não está pronto para enviar ações', { socketReady, myRoomId });
        return;
    }
    console.log('[DEBUG sendAction]', { action, payload, roomId: myRoomId });
    socket.send(JSON.stringify({ type: 'action', action, roomId: myRoomId, payload: payload || {} }));
}

function carregarSaquesAdmin() {
    fetch(API_BASE + '/api/admin/saques')
        .then(r => r.json())
        .then(saques => {
            const div = document.getElementById('adminSaquesList');
            if (!div) return;
            const pendentes = saques.filter(s => s.status === 'pendente');
            if (pendentes.length === 0) {
                div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Nenhum saque pendente.</p>';
                return;
            }
            div.innerHTML = pendentes.map(s => `
                <div style="background:#1e1e2a;border-radius:6px;padding:8px;margin:6px 0;font-size:0.8em">
                    <div><strong>${s.nome}</strong> - R$${s.valor.toFixed(2)}</div>
                    <div style="color:#a0a0b0">Chave: ${s.chavePix} (${s.tipoChave})</div>
                    <div style="color:#a0a0b0">${new Date(s.data).toLocaleString('pt-BR')}</div>
                    <div style="display:flex;gap:6px;margin-top:6px">
                        <button class="btn btn-add" onclick="processarSaqueAuto(${s.id})" style="padding:4px 10px;font-size:0.8em">✅ Pagar e Marcar</button>
                        <button class="btn btn-remove" onclick="processarSaqueManual(${s.id})" style="padding:4px 10px;font-size:0.8em">✅ Marcar Pago</button>
                    </div>
                </div>
            `).join('');
        })
        .catch(() => {});
}

function carregarModoTeste() {
    fetch(API_BASE + '/api/admin/modo-teste')
        .then(r => r.json())
        .then(d => {
            modoTesteSaque = !!(d && d.ligado);
            const btn = document.getElementById('btnModoTeste');
            if (btn) {
                btn.textContent = modoTesteSaque
                    ? '🧪 Modo Teste: LIGADO (clique p/ desligar)'
                    : '🧪 Modo Teste: DESLIGADO (clique p/ ligar)';
                btn.style.background = modoTesteSaque ? 'linear-gradient(135deg,#f59e0b,#d97706)' : '';
            }
        })
        .catch(() => {});
}

function alternarModoTeste() {
    const novo = !modoTesteSaque;
    fetch(API_BASE + '/api/admin/modo-teste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ligado: novo })
    })
        .then(r => r.json())
        .then(d => {
            modoTesteSaque = !!(d && d.ligado);
            carregarModoTeste();
            showToast('Modo Teste de Saque ' + (modoTesteSaque ? 'LIGADO' : 'DESLIGADO') + ' (somente para testes).', 'info', 5000);
        })
        .catch(() => showToast('Erro ao alterar modo teste.', 'error', 4000));
}

function processarSaqueAuto(id) {
    if (!confirm('Enviar PIX automaticamente para este jogador via Asaas?')) return;
    fetch(API_BASE + '/api/admin/saques')
        .then(r => r.json())
        .then(saques => {
            const saque = saques.find(s => s.id === id);
            if (!saque) { showToast('Saque não encontrado.', 'error', 4000); return; }
            return fetch(API_BASE + '/api/admin/enviar-pix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    para: saque.nome,
                    chavePix: saque.chavePix,
                    valor: saque.valor,
                    tipoChave: saque.tipoChave
                })
            });
        })
        .then(r => r.json())
        .then(r => {
            if (r.success) {
                showToast('Pagamento enviado com sucesso!', 'success', 4000);
                carregarSaquesAdmin();
            } else {
                showToast('Erro: ' + (r.error || r.message || 'Erro'), 'error', 5000);
            }
        })
        .catch(() => showToast('Erro de conexao.', 'error', 5000));
}

function processarSaqueManual(id) {
    if (!confirm('Marcar este saque como pago (manual)?')) return;
    fetch(API_BASE + '/api/admin/saque-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saqueId: id })
    })
        .then(r => r.json())
        .then(r => {
            if (r.success) {
                showToast('Saque marcado como pago!', 'success', 4000);
                carregarSaquesAdmin();
            } else {
                showToast('Erro: ' + (r.error || 'Erro desconhecido'), 'error', 5000);
            }
        })
        .catch(() => showToast('Erro de conexao.', 'error', 5000));
}

function testarEmailAdmin() {
    fetch(API_BASE + '/api/admin/testar-email', { method: 'POST' })
        .then(r => r.json())
        .then(r => {
            if (r.success) {
                showToast('📧 Email de teste enviado para ' + r.message, 'success', 6000);
            } else {
                showToast('Erro: ' + (r.error || 'Erro desconhecido'), 'error', 6000);
            }
        })
        .catch(() => showToast('Erro de conexao ao testar email.', 'error', 6000));
}

function updatePlayerListUI() {
    const list = document.getElementById('playerListUI');
    const isMarcos = souDono;
    if (!list) return;

    list.innerHTML = '';

    const sortedPlayers = [...allPlayers].sort((a, b) => b.chips - a.chips);

    sortedPlayers.forEach((p, index) => {
        const li = document.createElement('li');
        const hostIcon = p.isHost ? '👑 ' : '';
        const winningsDisplay = (p.winnings || 0) > 0 ? ` 🏆 R$${(p.winnings / 1000).toFixed(2).replace('.', ',')}` : '';
        const chipsReais = (p.chips / 1000).toFixed(2).replace('.', ',');
        li.innerHTML = `<span>${hostIcon}${p.name} (${p.cards ? p.cards.length : 0} cartela${p.cards && p.cards.length === 1 ? '' : 's'})</span><span class="player-chips"><span class="conta-label">Dinheiro na conta</span>R$ ${chipsReais}</span>`;
        list.appendChild(li);
    });

    if (typeof renderCloseCardsPanel === 'function') {
        renderCloseCardsPanel();
    }
}

function carregarCadastrosAdmin() {
    Promise.all([
        fetch(API_BASE + '/api/admin/usuarios').then(r => r.json()),
        fetch(API_BASE + '/api/admin/usuarios-com-bonus').then(r => r.json())
    ])
    .then(([usuarios, usuariosComBonus]) => {
            const div = document.getElementById('adminCadastrosList');
            if (!div) return;
            if (usuarios.length === 0) {
                div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Nenhum cadastro.</p>';
                return;
            }
            const bonusSet = new Set(usuariosComBonus.map(n => n.toLowerCase().trim()));
            div.innerHTML = usuarios.map(u => {
                const key = (u.nomeCompleto || u.nome || '').toLowerCase().trim();
                const jaTemBonus = bonusSet.has(key);
                return `
                <div class="admin-card" style="position:relative;padding-bottom:40px">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
                        <strong>${u.nomeCompleto || u.nome || 'Sem nome'}</strong>
                        <div style="display:flex;gap:6px">
                            ${jaTemBonus ? '<span style="color:#10b981;font-size:0.8em">✓ Bônus dado</span>' : `<button class="btn" onclick="darBonusUsuario('${u.cpf}', '${u.nomeCompleto || u.nome}')" style="padding:6px 12px;font-size:0.75em;background:#10b981;min-width:80px">🎁 Bônus</button>`}
                            <button class="btn btn-remove" onclick="excluirUsuarioAdmin('${u.cpf}', '${u.nomeCompleto || u.nome}')" style="padding:6px 12px;font-size:0.75em;min-width:80px">🗑️ Excluir</button>
                        </div>
                    </div>
                    <div style="color:#a0a0b0;font-size:0.82em">CPF: ${u.cpfFormatado || u.cpf}</div>
                    <div style="color:#a0a0b0;font-size:0.82em">Email: ${u.email}</div>
                    <div style="color:#fbbf24;font-size:0.82em">Senha: ${u.senha}</div>
                    <div style="color:#a0a0b0;font-size:0.82em">PIX: ${u.chavePix}</div>
                    <div style="color:#6b6599;font-size:0.75em;margin-top:4px">${u.data ? new Date(u.data).toLocaleString('pt-BR') : ''}</div>
                    <div style="color:#ef4444;font-size:0.72em;margin-top:8px;font-weight:600">⚠️ Esta ação remove TODOS os dados: usuário, fichas, ganhos, saques, transações e histórico. O jogador poderá se cadastrar novamente.</div>
                </div>
            `}).join('');
        })
        .catch(() => {
            const div = document.getElementById('adminCadastrosList');
            if (div) div.innerHTML = '<p style="color:#ef4444;font-size:0.82em">Erro ao carregar.</p>';
        });
}

function excluirUsuarioAdmin(cpf, nome) {
    if (!confirm(`⚠️ ATENÇÃO: Tem certeza que deseja EXCLUIR COMPLETAMENTE o usuário "${nome}" (CPF: ${cpf})?\n\nIsso vai apagar PERMANENTEMENTE:\n• Cadastro do usuário\n• Saldo (fichas)\n• Ganhos (winnings)\n• Créditos admin\n• Saques pendentes/pagos\n• Transações\n• Histórico de recargas\n\nO jogador poderá se cadastrar novamente com o mesmo CPF.\n\nDigitar "EXCLUIR" para confirmar:`)) {
        return;
    }
    
    const confirmText = prompt('Digite "EXCLUIR" para confirmar a exclusão permanente:');
    if (confirmText !== 'EXCLUIR') {
        showToast('Exclusão cancelada: texto de confirmação incorreto.', 'warning', 4000);
        return;
    }

    showSpinner('Excluindo usuário...');
    
    fetch(API_BASE + '/api/admin/usuario/excluir', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf })
    })
    .then(r => r.json())
    .then(r => {
        hideSpinner();
        if (r.success) {
            showToast(`✅ Usuário "${nome}" excluído com sucesso! Todos os dados foram removidos.`, 'success', 6000);
            carregarCadastrosAdmin();
            carregarAdminUsuariosComSaldo();
        } else {
            showToast('Erro: ' + (r.error || 'Erro desconhecido'), 'error', 6000);
        }
    })
    .catch(err => {
        hideSpinner();
        showToast('Erro de conexão: ' + err.message, 'error', 6000);
    });
}

function darBonusUsuario(cpf, nome) {
    const bonus = prompt(`Digite o valor do BÔNUS para "${nome}":\n\nIsso adicionará fichas ao saldo do jogador.`);
    if (bonus === null) return;
    const valor = parseInt(bonus);
    if (isNaN(valor) || valor <= 0) {
        showToast('Valor inválido. O bônus deve ser um número positivo.', 'warning', 4000);
        return;
    }
    
    showSpinner('Concedendo bônus...');
    
    fetch(API_BASE + '/api/admin/usuario/bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, bonus: valor })
    })
    .then(r => r.json())
    .then(r => {
        hideSpinner();
        if (r.success) {
            showToast(`✅ Bônus de ${valor.toLocaleString('pt-BR')} fichas concedido para "${nome}"!`, 'success', 6000);
            carregarCadastrosAdmin();
        } else {
            showToast('Erro: ' + (r.error || 'Erro desconhecido'), 'error', 6000);
        }
    })
    .catch(err => {
        hideSpinner();
        showToast('Erro de conexão: ' + err.message, 'error', 6000);
    });
}

function carregarAdminUsuariosComSaldo() {
    fetch(API_BASE + '/api/admin/usuarios-com-saldo')
        .then(r => r.json())
        .then(usuarios => {
            const select = document.getElementById('adminPlayerSelect');
            if (!select) return;

            const selectedValue = select.value;
            select.innerHTML = '';

            // Adicionar opção padrão
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Selecione um usuário --';
            select.appendChild(defaultOption);

            usuarios.forEach(u => {
                const option = document.createElement('option');
                option.value = u.nomeCompleto;
                const isBot = u.isBot === true;
                const prefix = isBot ? '🤖 ' : '';
                const saldo = (u.chips / 1000).toFixed(2).replace('.', ',');
                const ganhos = (u.winnings / 1000).toFixed(2).replace('.', ',');
                const credAdmin = (u.adminCreditos / 1000).toFixed(2).replace('.', ',');
                option.textContent = `${prefix}${u.nomeCompleto} (Saldo: R$ ${saldo} | Ganhos: R$ ${ganhos} | Créd. Admin: R$ ${credAdmin})`;
                select.appendChild(option);
            });

            // Restaurar seleção se ainda existir
            if (selectedValue) {
                select.value = selectedValue;
            }

            // Atualizar painel de saldo do jogador selecionado
            if (typeof atualizarSaldoJogadorSelecionado === 'function') {
                atualizarSaldoJogadorSelecionado();
            }
        })
        .catch(() => {
            const select = document.getElementById('adminPlayerSelect');
            if (select) select.innerHTML = '<option value="">Erro ao carregar usuários</option>';
        });
}

// Admin - Carregar lista específica para o dropdown de exclusão rápida
function carregarUsuariosParaExclusao() {
    fetch(API_BASE + '/api/admin/usuarios-com-saldo')
        .then(r => r.json())
        .then(usuarios => {
            const select = document.getElementById('deletePlayerSelect');
            if (!select) return;
            const selectedValue = select.value;
            select.innerHTML = '';

            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Selecione um jogador para excluir --';
            select.appendChild(defaultOption);

            // Apenas jogadores reais (não bots)
            usuarios.filter(u => u.isBot !== true).forEach(u => {
                const option = document.createElement('option');
                option.value = u.cpf;
                option.dataset.nome = u.nomeCompleto;
                const saldo = (u.chips / 1000).toFixed(2).replace('.', ',');
                option.textContent = `👤 ${u.nomeCompleto} (CPF: ${u.cpfFormatado || u.cpf} | Saldo: R$ ${saldo})`;
                select.appendChild(option);
            });

            if (selectedValue) select.value = selectedValue;
        })
        .catch(() => {
            const select = document.getElementById('deletePlayerSelect');
            if (select) select.innerHTML = '<option value="">Erro ao carregar usuários</option>';
        });
}

// Admin - Excluir jogador selecionado (versão com select + confirmação usando função existente)
function confirmarExclusaoJogador() {
    const select = document.getElementById('deletePlayerSelect');
    if (!select || !select.value) {
        showToast('Selecione um jogador para excluir.', 'warning', 3500);
        return;
    }
    const cpf = select.value;
    const selectedOption = select.options[select.selectedIndex];
    const nome = selectedOption.dataset.nome || '';

    // Reusa a função existente com fluxo completo de confirmação
    excluirUsuarioAdmin(cpf, nome);
}

function adminAbrirAba(tabId) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
    const tab = document.querySelector(`.admin-tab[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    if (content) {
        content.style.display = 'block';
        if (tabId === 'tabSaques' && content.querySelector('p')?.textContent === 'Carregando...') carregarSaquesAdmin();
        if (tabId === 'tabUsuarios') {
            carregarCadastrosAdmin();
            carregarAdminUsuariosComSaldo();
        }
        if (tabId === 'tabHistorico') carregarHistoricoAdmin();
        if (tabId === 'tabTransacoes') carregarTransacoesAdmin();
    }
}

function getDataFiltro(deId, ateId) {
    const de = document.getElementById(deId)?.value;
    const ate = document.getElementById(ateId)?.value;
    return { de: de ? new Date(de + 'T00:00:00') : null, ate: ate ? new Date(ate + 'T23:59:59') : null };
}

function filtrarPorData(lista, campoData, de, ate) {
    if (!de && !ate) return lista;
    return lista.filter(item => {
        const d = new Date(item[campoData]);
        if (de && d < de) return false;
        if (ate && d > ate) return false;
        return true;
    });
}

function carregarHistoricoAdmin() {
    const div = document.getElementById('adminHistoricoList');
    if (!div) return;
    div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Carregando...</p>';
    const filtro = getDataFiltro('filtroHistDe', 'filtroHistAte');
    fetch(API_BASE + '/api/admin/historico')
        .then(r => r.json())
        .then(historico => {
            if (!div) return;
            const filtrados = filtrarPorData(historico, 'data', filtro.de, filtro.ate);
            if (filtrados.length === 0) {
                div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Nenhum sorteio encontrado.</p>';
                return;
            }
            div.innerHTML = filtrados.slice().reverse().map(h => {
                const venc = { kuadra: [], kina: [], keno: [] };
                Object.keys(h.vencedores || {}).forEach(fase => {
                    (h.vencedores[fase] || []).forEach(v => {
                        if (!venc[fase].some(x => x.nome === v.nome)) {
                            const premioTxt = ((v.premio || 0) / 1000).toFixed(2).replace('.', ',');
                            venc[fase].push({ nome: v.nome, premio: premioTxt });
                        }
                    });
                });
                const vencedorTexto = Object.keys(venc)
                    .filter(f => venc[f].length)
                    .map(f => {
                        const lista = venc[f].map(x => `${x.nome} <span style="color:#ffff00">(R$ ${x.premio})</span>`).join(', ');
                        return `${f}: ${lista}`;
                    })
                    .join('<br>');
                return `
                <div class="admin-card">
                    <div><strong style="color:#ffff00">Sorteio #${h.numero}</strong> <span style="color:rgba(255,255,255,0.6)">${new Date(h.data).toLocaleString('pt-BR')}</span></div>
                    <div style="color:rgba(255,255,255,0.8)">Bolas: ${h.totalBolas || h.bolasSorteadas?.length || 0}</div>
                    <div style="color:#ffffff">${vencedorTexto || 'Nenhum vencedor'}</div>
                </div>`;
            }).join('');
        })
        .catch(() => {
            if (div) div.innerHTML = '<p style="color:#ef4444;font-size:0.82em">Erro ao carregar.</p>';
        });
}

const TRANSACAO_LABELS = {
    deposito: '💰 Depósito',
    saque_pendente: '⏳ Saque solicitado',
    saque_pago: '✅ Saque pago',
    premio: '🏆 Prêmio'
};
const TRANSACAO_CORES = {
    deposito: '#6ee7b7',
    saque_pendente: '#fbbf24',
    saque_pago: '#34d399',
    premio: '#a78bfa'
};

function renderTransacao(t) {
    const valor = parseFloat(t.valor || 0).toFixed(2).replace('.', ',');
    const tipo = TRANSACAO_LABELS[t.tipo] || t.tipo;
    const cor = TRANSACAO_CORES[t.tipo] || '#fff';
    return `
    <div class="admin-card">
        <div><strong style="color:${cor}">${tipo}</strong> <span style="color:rgba(255,255,255,0.6)">${new Date(t.data).toLocaleString('pt-BR')}</span></div>
        <div style="color:#fff">Jogador: ${t.nomeExibicao || t.nome} — <strong style="color:#ffff00">R$ ${valor}</strong></div>
        ${t.detalhe ? `<div style="color:rgba(255,255,255,0.7);font-size:0.9em">${t.detalhe}</div>` : ''}
    </div>`;
}

function carregarTransacoesAdmin() {
    const div = document.getElementById('adminTransacoesList');
    if (!div) return;
    div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Carregando...</p>';
    const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
    fetch(API_BASE + '/api/admin/transacoes')
        .then(r => r.json())
        .then(transacoes => {
            if (!div) return;
            const filtrados = filtrarPorData(transacoes, 'data', filtro.de, filtro.ate);
            if (!filtrados || filtrados.length === 0) {
                div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Nenhuma transação encontrada.</p>';
                return;
            }
            div.innerHTML = filtrados.slice().reverse().map(renderTransacao).join('');
        })
        .catch(() => {
            if (div) div.innerHTML = '<p style="color:#ef4444;font-size:0.82em">Erro ao carregar.</p>';
        });
}

function baixarJSON(data, nomeArquivo) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function baixarCSV(data, nomeArquivo, colunas) {
    const header = colunas.join(',');
    const rows = data.map(item => colunas.map(c => {
        const val = item[c] || '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    }).join(','));
    const csv = [header, ...rows].join('\r\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function baixarHistoricoJSON() {
    fetch(API_BASE + '/api/admin/historico').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroHistDe', 'filtroHistAte');
        baixarJSON(filtrarPorData(d, 'data', filtro.de, filtro.ate), 'historico_sorteios.json');
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarHistoricoCSV() {
    fetch(API_BASE + '/api/admin/historico').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroHistDe', 'filtroHistAte');
        const dados = filtrarPorData(d, 'data', filtro.de, filtro.ate);
        baixarCSV(dados, 'historico_sorteios.csv', ['numero', 'data', 'totalBolas']);
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarTransacoesJSON() {
    fetch(API_BASE + '/api/admin/transacoes').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
        baixarJSON(filtrarPorData(d, 'data', filtro.de, filtro.ate), 'transacoes.json');
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarTransacoesCSV() {
    fetch(API_BASE + '/api/admin/transacoes').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
        const dados = filtrarPorData(d, 'data', filtro.de, filtro.ate);
        baixarCSV(dados, 'transacoes.csv', ['tipo', 'nome', 'valor', 'data', 'detalhe']);
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

