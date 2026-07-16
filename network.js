// CONFIGURAÇÃO DO BACKEND (servidor autoritativo)
// Local: ws://<host>:3000 (server.js). Produção (GitHub Pages / domínio próprio): aponte para o seu backend.
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');

// ===================== UTILITÁRIOS (segurança + log) =====================
window.__DEBUG__ = window.__DEBUG__ || false;
function dbg(...args) { if (window.__DEBUG__) console.log('[DEBUG]', ...args); }
function dbgWarn(...args) { if (window.__DEBUG__) console.warn('[DEBUG]', ...args); }
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeJsStr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ===================== AUTENTICAÇÃO DE ADMIN (senha mestre) =====================
// A senha mestre é digitada no painel admin e enviada via header x-admin-token.
// O servidor compara com process.env.ADMIN_SENHA (definida no Render). A senha
// NÃO fica no código — só na memória/sessionStorage após o dono digitá-la.
let adminAuthToken = sessionStorage.getItem('bingo_admin_token') || '';
function adminFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, { 'x-admin-token': adminAuthToken });
    return fetch(url, options);
}
function solicitarSenhaAdmin() {
    if (adminAuthToken) return Promise.resolve(true);
    return new Promise((resolve) => {
        // Modal customizado (NAO usa prompt() nativo que trava o jogo)
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;justify-content:center;align-items:center';
        overlay.innerHTML = `
            <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;text-align:center">
                <div style="font-size:18px;color:#fff;font-weight:600;margin-bottom:16px">🔐 Painel Administrativo</div>
                <p style="color:#cbd5e1;font-size:13px;margin:0 0 14px">Digite a senha mestre para continuar:</p>
                <input id="adminSenhaInput" type="password" placeholder="Senha mestre" style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:#fff;font-size:15px;text-align:center;margin-bottom:16px;box-sizing:border-box" />
                <div style="display:flex;gap:10px;justify-content:center">
                    <button id="adminSenhaOk" style="background:#10b981;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:bold;font-size:15px;cursor:pointer">Entrar</button>
                    <button id="adminSenhaCancel" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);padding:10px 24px;border-radius:8px;font-weight:bold;font-size:15px;cursor:pointer">Cancelar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#adminSenhaInput');
        const fechar = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        const tentar = () => {
            const senha = (input.value || '').trim();
            if (!senha) { showToast('Digite a senha mestre.', 'warning', 4000); return; }
            adminAuthToken = senha;
            adminFetch(API_BASE + '/api/admin/usuarios-suspeitos')
                .then(r => {
                    if (!r.ok) {
                        adminAuthToken = '';
                        sessionStorage.removeItem('bingo_admin_token');
                        fechar();
                        showToast('Senha mestre incorreta.', 'error', 4000);
                        resolve(false);
                    } else {
                        sessionStorage.setItem('bingo_admin_token', senha);
                        fechar();
                        resolve(true);
                    }
                })
                .catch(() => {
                    adminAuthToken = '';
                    sessionStorage.removeItem('bingo_admin_token');
                    fechar();
                    showToast('Erro de conexão ao validar senha.', 'error', 4000);
                    resolve(false);
                });
        };
        overlay.querySelector('#adminSenhaOk').onclick = tentar;
        overlay.querySelector('#adminSenhaCancel').onclick = () => { fechar(); resolve(false); };
        input.onkeydown = (e) => { if (e.key === 'Enter') tentar(); };
        setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
    });
}

// O WebSocket DEVE usar o MESMO servidor da API (API_BASE), senão o "auth"
// do login falha (sessão criada num servidor, validada em outro) e o jogador
// fica preso na tela de login. Deriva o host do WS a partir de API_BASE.
function wsBaseFromApi() {
    const base = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : '';
    if (IS_LOCAL) return window.location.hostname;
    if (!base) return 'bingo-master-pro-fcty.onrender.com';
    return base.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
const WS_WS_PROTO = (typeof API_BASE !== 'undefined' && API_BASE && API_BASE.startsWith('https')) ? 'wss' : 'ws';
const WS_CANDIDATES = IS_LOCAL
    ? [`ws://${window.location.hostname}:3000`]
    : [`${WS_WS_PROTO}://${wsBaseFromApi()}`];
let wsCandidateIndex = 0;
let wsOpened = false;
function currentWsUrl() {
    return WS_CANDIDATES[Math.min(wsCandidateIndex, WS_CANDIDATES.length - 1)];
}

let socket = null;
let souDono = false;
let modoTesteSaque = false; // MODO TESTE: LIGADO=todo saldo é sacável | DESLIGADO=só ganhos em jogos
let socketReady = false;
let myId = '';
let myRole = '';
let myRoomId = '';
let pendingConnect = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let wasForcedDisconnect = false;
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

function updateConnectionBadge(connected, reconnecting) {
    const dot = document.getElementById('connDot');
    const status = document.getElementById('connStatus');
    if (!dot || !status) return;

    if (connected) {
        dot.classList.remove('disconnected', 'reconnecting');
        status.textContent = 'Conectado ao Bingo';
    } else if (reconnecting) {
        dot.classList.remove('disconnected');
        dot.classList.add('reconnecting');
        status.textContent = 'Reconectando…';
    } else {
        dot.classList.remove('reconnecting');
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

    socket = new WebSocket(currentWsUrl());

    socket.addEventListener('open', () => {
        socketReady = true;
        wsOpened = true;
        wsCandidateIndex = 0;
        reconnectAttempts = 0;
        wasForcedDisconnect = false;
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
        if (wasForcedDisconnect) {
            wasForcedDisconnect = false;
            cancelReconnect();
            updateConnectionBadge(false, false);
            showOfflineBanner(false);
            return;
        }
        if (!wsOpened && wsCandidateIndex < WS_CANDIDATES.length - 1) {
            wsCandidateIndex++;
        }
        if (pendingConnect) {
            showOfflineBanner(true);
            updateConnectionBadge(false, true);
            scheduleReconnect();
        } else {
            updateConnectionBadge(false, true);
            showOfflineBanner(false);
            scheduleReconnect();
        }
    });

    socket.addEventListener('error', () => {
        showOfflineBanner(true);
        if (!wsOpened && wsCandidateIndex < WS_CANDIDATES.length - 1) {
            wsCandidateIndex++;
        }
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
        if (typeof loggedOut !== 'undefined' && loggedOut) return;
        const logado = (typeof minhaSessaoToken !== 'undefined' && minhaSessaoToken) || (typeof meuCpf !== 'undefined' && meuCpf);
        if (pendingConnect || logado) {
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
        if (typeof clearStaleCelebrations === 'function') clearStaleCelebrations();
        if (!loggedOut && pendingConnect && (!socket || socket.readyState !== WebSocket.OPEN)) {
            connectSocket();
        }
        if (!loggedOut && socket && socket.readyState === WebSocket.OPEN) {
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
        wasForcedDisconnect = true;
        cancelReconnect();
        showToast(message.message || 'Conta aberta em outro dispositivo. Você foi desconectado.', 'error', 5000);
        localStorage.removeItem('bingo_session_token');
        localStorage.removeItem('bingo_meu_cpf');
        minhaSessaoToken = '';
        meuCpf = '';
        pendingConnect = null;
        if (typeof goToScreen === 'function') setTimeout(() => goToScreen('screenHome'), 100);
        if (socket) { try { socket.close(); } catch (e) {} }
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

        if (message.type === 'auth_error') {
            console.warn('[AUTH] Falha na autenticação do WebSocket:', message.message);
            setStatusMessage('Sessão não validada no chat — entrando mesmo assim.', 'info');
            return;
        }

        if (message.type === 'connected') {
            // Sync modoTesteSaque from server
            if (message.modoTeste !== undefined) {
                modoTesteSaque = !!message.modoTeste;
            }
            adminFetch(API_BASE + '/api/admin/modo-teste')
                .then(r => r.json())
                .then(d => { modoTesteSaque = !!(d && d.ligado); })
                .catch(() => {});

            if (message.role === 'host' && myRole === 'host') {
            myId = 'host';
            myRoomId = message.roomId || myRoomId;
            if (!allPlayers || allPlayers.length === 0) {
                allPlayers = [{ id: 'host', name: myName, chips: myChips, winnings: myWinnings || 0, cards: myCards || [], isHost: true }];
            }
            updatePlayerListUI();
            goToScreen('screenGame');
            const hostMsg = document.getElementById('hostOnlyMsg');
            if (hostMsg) hostMsg.style.display = 'block';
            if (isMarcosName(myName)) {
                const btn = document.getElementById('btnAdminOpen');
                if (btn) btn.style.display = '';
                setTimeout(() => { carregarAdminUsuariosComSaldo(); carregarUsuariosParaExclusao(); carregarBarraJogadores(); }, 300);
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

        if (message.role === 'guest' || (message.role === 'spectator' && myRole === 'guest')) {
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
                const btn = document.getElementById('btnAdminOpen');
                if (btn) btn.style.display = '';
                setTimeout(() => { carregarAdminUsuariosComSaldo(); carregarUsuariosParaExclusao(); carregarBarraJogadores(); }, 300);
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
            setNullableStyle('btnAdminOpen', 'display', 'none');
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
                    setTimeout(showKenoRanking, 4500);
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
            if (typeof exibirAvisoManutencao === 'function') exibirAvisoManutencao(data.manutencao);
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
            const adminActive = document.getElementById('screenAdmin')?.classList.contains('active');
            if (!adminActive) goToScreen('screenGame');
            return;
        }

        if (data.type === 'winnerEvent' && typeof showWinnerBanner === 'function') {
            const results = data.results || data.winners || [];
            if (data.winningBall) {
                try { window.__ultimaBolaVencedora = data.winningBall; } catch (e) {}
            }
            showWinnerBanner(data.phaseKey || data.phase, results, data.jackpotValue);
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
                const jaVisivel = overlay && overlay.classList.contains('visible');
                if (overlay) overlay.classList.add('visible');
                if (overlayTimer) overlayTimer.textContent = text;
                // toca corneta de largada na primeira vez que o contador aparece
                // (não toca de novo se atualizar a página durante a mesma contagem)
                if (!jaVisivel && (typeof soundMuted === 'undefined' || !soundMuted)) {
                    const bugleKey = 'bingo_bugle_' + (typeof currentRound !== 'undefined' ? currentRound : 0);
                    if (!sessionStorage.getItem(bugleKey)) {
                        try { new Audio('inicio do bingo.mp3').play().catch(() => {}); } catch (e) {}
                        sessionStorage.setItem(bugleKey, '1');
                    }
                }
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
    hideBotoesFinanceiros();
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
    dbgWarn('[DEBUG executeAdminAction]', { selectedId, amount, action, socketReady });
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

    // Sempre busca o saldo completo no servidor: o objeto do jogo (allPlayers)
    // não traz os campos derivados (depositos, adminCredits, bonusGiven), o que
    // fazia o painel exibir "Depósitos: R$ 0,00" mesmo com saldo creditado.
    adminFetch(API_BASE + '/api/admin/usuarios-com-saldo')
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
    const adminCredRaw = data.adminCreditos || data.adminCredits || 0;
    const adminCreditsReais = (adminCredRaw / 1000).toFixed(2).replace('.', ',');
    const bonusGivenReais = ((data.bonusGiven || 0) / 1000).toFixed(2).replace('.', ',');
    const depositosReais = ((data.depositos || 0) / 1000).toFixed(2).replace('.', ',');
    const sacavel = adminCredRaw + (data.winnings || 0);
    const sacavelReais = (sacavel / 1000).toFixed(2).replace('.', ',');

    const balanceDiv = document.getElementById('adminPlayerBalance');
    if (!balanceDiv) return;

    balanceDiv.innerHTML = `
        <div style="margin:4px 0"><strong>${escapeHtml(data.nomeCompleto || data.name)}</strong></div>
        <div style="margin:2px 0">💰 Saldo total: <strong>R$ ${chipsReais}</strong></div>
        <div style="margin:2px 0">💰 Depósitos: <strong>R$ ${depositosReais}</strong> <span style="color:#6b6599">(não sacável)</span></div>
        <div style="margin:2px 0">🏆 Ganhos (Kuadra/Kina/Keno): <strong>R$ ${winningsReais}</strong> <span style="color:#10b981">(sacável)</span></div>
        <div style="margin:2px 0">🎁 Créditos admin: <strong>R$ ${adminCreditsReais}</strong> <span style="color:#10b981">(sacável)</span></div>
        <div style="margin:2px 0">🎁 Bônus: <strong>R$ ${bonusGivenReais}</strong> <span style="color:#fbbf24">(não sacável)</span></div>
        <div style="margin:6px 0;padding:6px;background:rgba(16,185,129,0.12);border-radius:4px;border:1px solid rgba(16,185,129,0.35)">
            💸 Saldo sacável: <strong>R$ ${sacavelReais}</strong> (Créditos admin + Ganhos)
        </div>
        <div style="font-size:0.75em;color:#6b6599;margin-top:4px">
            Mínimo saque: R$ 10,00 | Apenas Créditos (admin) e Ganhos são sacáveis. Depósitos e Bônus não.
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
    dbgWarn('[DEBUG sendAction]', { action, payload, roomId: myRoomId });
    socket.send(JSON.stringify({ type: 'action', action, roomId: myRoomId, payload: payload || {} }));
}

function carregarSaquesAdmin() {
    adminFetch(API_BASE + '/api/admin/saques')
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
                    <div><strong>${escapeHtml(s.nome)}</strong> - R$${s.valor.toFixed(2)}</div>
                    <div style="color:#a0a0b0">Chave: ${escapeHtml(s.chavePix)} (${escapeHtml(s.tipoChave)})</div>
                    <div style="color:#a0a0b0">${new Date(s.data).toLocaleString('pt-BR')}</div>
                    <div style="display:flex;gap:6px;margin-top:6px">
                        <button class="btn btn-add" onclick="processarSaqueAuto('${s.id}')" style="padding:4px 10px;font-size:0.8em">✅ Pagar e Marcar</button>
                        <button class="btn btn-remove" onclick="processarSaqueManual('${s.id}')" style="padding:4px 10px;font-size:0.8em">✅ Marcar Pago</button>
                    </div>
                </div>
            `).join('');
        })
        .catch(() => {});
}

function carregarModoTeste() {
    adminFetch(API_BASE + '/api/admin/modo-teste')
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
    adminFetch(API_BASE + '/api/admin/modo-teste', {
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
    adminFetch(API_BASE + '/api/admin/saques')
        .then(r => r.json())
        .then(saques => {
            const saque = saques.find(s => s.id === id);
            if (!saque) { showToast('Saque não encontrado.', 'error', 4000); return; }
            return adminFetch(API_BASE + '/api/admin/enviar-pix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    saqueId: saque.id,
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
    adminFetch(API_BASE + '/api/admin/saque-pago', {
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
    adminFetch(API_BASE + '/api/admin/testar-email', { method: 'POST' })
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

function testarAsaasAdmin() {
    adminFetch(API_BASE + '/api/admin/testar-asaas')
        .then(r => r.json())
        .then(r => {
            if (r.success) {
                showToast('✅ Asaas: ' + r.message, 'success', 8000);
            } else {
                showToast('❌ Asaas: ' + r.message, 'error', 10000);
            }
        })
        .catch(() => showToast('Erro de conexao ao testar Asaas.', 'error', 6000));
}

function mostrarWebhookUrl() {
    fetch(API_BASE + '/api/asaas/webhook-url')
        .then(r => r.json())
        .then(r => {
            if (r.url) {
                navigator.clipboard.writeText(r.url).then(() => {
                    showToast('🔗 URL do webhook copiada: ' + r.url, 'success', 8000);
                }).catch(() => {
                    showToast('🔗 URL do webhook: ' + r.url, 'info', 10000);
                });
            }
        })
        .catch(() => showToast('Erro ao obter URL do webhook.', 'error', 6000));
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
        const cardCount = p.cards ? p.cards.length : 0;
        li.innerHTML = `<span>${hostIcon}${escapeHtml(p.name)}</span><span class="player-cards">${cardCount} cartela${cardCount === 1 ? '' : 's'}</span>`;
        list.appendChild(li);
    });

    if (typeof renderCloseCardsPanel === 'function') {
        renderCloseCardsPanel();
    }
}

function carregarCadastrosAdmin() {
    Promise.all([
        adminFetch(API_BASE + '/api/admin/usuarios').then(r => r.json()),
        adminFetch(API_BASE + '/api/admin/usuarios-com-bonus').then(r => r.json())
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
                <div class="admin-card${jaTemBonus ? ' bonus-done' : ''}" style="position:relative" data-cpf="${escapeHtml(u.cpf)}" data-nome="${escapeHtml(u.nomeCompleto || u.nome || '')}" data-email="${escapeHtml(u.email || '')}" data-senha="${escapeHtml(u.senha || '')}" data-pix="${escapeHtml(u.chavePix || '')}">
                    <div class="admin-card-top">
                        <div class="admin-card-name">${escapeHtml(u.nomeCompleto || u.nome || 'Sem nome')}</div>
                        <div style="display:flex;gap:6px;flex-shrink:0">
                            ${jaTemBonus
                                ? '<span class="bonus-badge">✅ Bônus enviado</span>'
                                : `<button class="btn btn-bonus" style="padding:8px 16px;font-size:0.85em;background:#10b981;min-width:90px">🎁 Bônus</button>`}
                            <button class="btn btn-editar" style="padding:8px 16px;font-size:0.85em;background:#3b82f6;min-width:90px">✏️ Editar</button>
                            <button class="btn btn-remove" style="padding:8px 16px;font-size:0.85em;min-width:90px">🗑️ Excluir</button>
                        </div>
                    </div>
                    <div class="admin-card-info">
                        <span><span class="info-label">CPF:</span> ${escapeHtml(u.cpfFormatado || u.cpf)}</span>
                        <span><span class="info-label">Email:</span> ${escapeHtml(u.email)}</span>
                        <span><span class="info-label">Senha:</span> ${escapeHtml(u.senha)}</span>
                        <span><span class="info-label">PIX:</span> ${escapeHtml(u.chavePix)}</span>
                        ${u.data ? `<span><span class="info-label">Data:</span> ${new Date(u.data).toLocaleString('pt-BR')}</span>` : ''}
                    </div>
                </div>
            `}).join('');
        })
        .catch(() => {
            const div = document.getElementById('adminCadastrosList');
            if (div) div.innerHTML = '<p style="color:#ef4444;font-size:0.82em">Erro ao carregar.</p>';
        });
}

// Delegação de eventos para os cards de usuários (evita onclick inline frágil)
(function () {
    const lista = document.getElementById('adminCadastrosList');
    if (!lista || lista.__adminDelegado) return;
    lista.__adminDelegado = true;
    lista.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const card = btn.closest('.admin-card');
        if (!card) return;
        const cpf = card.dataset.cpf;
        const nome = card.dataset.nome;
        const email = card.dataset.email;
        const senha = card.dataset.senha;
        const pix = card.dataset.pix;
        if (btn.classList.contains('btn-bonus')) {
            darBonusUsuario(cpf, nome);
        } else if (btn.classList.contains('btn-editar')) {
            editarUsuarioAdmin(cpf, nome, email, senha, pix);
        } else if (btn.classList.contains('btn-remove')) {
            excluirUsuarioAdmin(cpf, nome);
        }
    });
})();

function excluirUsuarioAdmin(cpf, nome) {
    const overlay = document.getElementById('excluirModalOverlay');
    const msgEl = document.getElementById('excluirModalMsg');
    const btnExcluir = document.getElementById('excluirModalBtn');
    const btnCancel = document.getElementById('excluirModalCancelBtn');
    if (!overlay || !msgEl || !btnExcluir || !btnCancel) {
        showToast('Erro: modal de exclusão não encontrado.', 'error', 4000);
        return;
    }

    const fechar = () => { try { overlay.style.display = 'none'; } catch (e) {} };

    msgEl.innerHTML = 'Tem certeza que deseja <b style="color:#ef4444">EXCLUIR COMPLETAMENTE</b> o jogador "' + (nome || '') + '"?<br><span style="font-size:12px;color:#94a3b8">Isso apaga cadastro, saldo, saques, transações e histórico.</span>';
    overlay.style.display = 'flex';
    overlay.onclick = (e) => { if (e.target === overlay) fechar(); };
    btnExcluir.disabled = false;
    btnExcluir.textContent = '🗑️ Excluir';

    const confirmar = () => {
        btnExcluir.disabled = true;
        btnExcluir.textContent = 'Excluindo...';
        btnCancel.disabled = true;

        const safeReload = () => {
            try { carregarCadastrosAdmin(); } catch (e) {}
            try { carregarAdminUsuariosComSaldo(); } catch (e) {}
            try { carregarUsuariosParaExclusao(); } catch (e) {}
        };

        let resolvido = false;
        const finalizar = (sucesso, msg) => {
            if (resolvido) return;
            resolvido = true;
            fechar();
            btnExcluir.disabled = false;
            btnCancel.disabled = false;
            if (msg) showToast(msg, sucesso ? 'success' : 'error', 6000);
            if (sucesso) safeReload();
        };

        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 12000);

        adminFetch(API_BASE + '/api/admin/usuario/excluir', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf: String(cpf).replace(/\D/g, '') }),
            signal: controller.signal
        })
        .then(async (r) => {
            clearTimeout(fetchTimeout);
            let j = null;
            try { j = await r.json(); } catch (e) { j = null; }
            console.log('[EXCLUIR] resposta:', r.status, j);
            if (r.ok && j && j.success) {
                try {
                    const sel = document.getElementById('deletePlayerSelect');
                    if (sel) {
                        const opt = Array.from(sel.options).find(o => o.value && String(o.value).replace(/\D/g, '') === String(cpf).replace(/\D/g, ''));
                        if (opt) opt.remove();
                    }
                } catch (e) {}
                finalizar(true, `✅ Usuário "${nome}" excluído com sucesso!`);
            } else {
                finalizar(false, 'Erro: ' + ((j && j.error) || 'Falha ao excluir (HTTP ' + (r.ok ? 'desconhecido' : 'sem resposta') + ')'));
            }
        })
        .catch((err) => {
            clearTimeout(fetchTimeout);
            if (err && err.name === 'AbortError') {
                finalizar(false, 'A operação demorou muito (timeout). Tente novamente.');
            } else {
                finalizar(false, 'Erro de conexão: ' + (err && err.message ? err.message : err));
            }
        });
    };

    btnExcluir.onclick = confirmar;
    btnCancel.onclick = fechar;
}

function darBonusUsuario(cpf, nome) {
    const valor = 5000;
    confirmModal(`🎁 Conceder bônus de R$ 5,00 (${valor.toLocaleString('pt-BR')} fichas) para "${nome}"?`).then(ok => {
    if (!ok) return;

    showSpinner('Concedendo bônus...');
    
    adminFetch(API_BASE + '/api/admin/usuario/bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, bonus: valor })
    })
    .then(r => r.json())
    .then(r => {
        hideSpinner();
        if (r.success) {
            const msg = r.emailEnviado
                ? `✅ Bônus de R$ 5,00 concedido para "${nome}"! E-mail enviado para ${r.emailUsuario}`
                : `✅ Bônus de R$ 5,00 concedido para "${nome}"!`;
            showToast(msg, 'success', 8000);
            carregarCadastrosAdmin();
        } else {
            showToast('Erro: ' + (r.error || 'Erro desconhecido'), 'error', 6000);
        }
    })
    .catch(err => {
        hideSpinner();
        showToast('Erro de conexão: ' + err.message, 'error', 6000);
    });
    });
}

function editarUsuarioAdmin(cpf, nomeAtual, emailAtual, senhaAtual, pixAtual) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;justify-content:center;align-items:center';
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:28px;max-width:420px;width:90%">
            <div style="font-size:20px;color:#fff;font-weight:700;margin-bottom:20px">✏️ Editando ${escapeHtml(nomeAtual)}</div>
            <label style="color:#aaa;font-size:13px;display:block;margin-bottom:4px">Nome</label>
            <input id="editNome" class="input-field" style="width:100%;margin-bottom:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 12px;border-radius:8px;font-size:14px;box-sizing:border-box" value="${escapeHtml(nomeAtual)}">
            <label style="color:#aaa;font-size:13px;display:block;margin-bottom:4px">Email</label>
            <input id="editEmail" class="input-field" style="width:100%;margin-bottom:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 12px;border-radius:8px;font-size:14px;box-sizing:border-box" value="${escapeHtml(emailAtual)}">
            <label style="color:#aaa;font-size:13px;display:block;margin-bottom:4px">Senha</label>
            <input id="editSenha" class="input-field" style="width:100%;margin-bottom:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 12px;border-radius:8px;font-size:14px;box-sizing:border-box" value="${escapeHtml(senhaAtual)}">
            <label style="color:#aaa;font-size:13px;display:block;margin-bottom:4px">Chave PIX</label>
            <input id="editPix" class="input-field" style="width:100%;margin-bottom:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 12px;border-radius:8px;font-size:14px;box-sizing:border-box" value="${escapeHtml(pixAtual)}">
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button id="editCancelBtn" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);padding:10px 24px;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer">Cancelar</button>
                <button id="editSaveBtn" style="background:#3b82f6;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-weight:bold;font-size:14px;cursor:pointer">Salvar</button>
            </div>
            <div id="editStatus" style="margin-top:12px;font-size:13px;color:#ccc;text-align:center"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#editCancelBtn').onclick = () => overlay.remove();
    overlay.querySelector('#editSaveBtn').onclick = async () => {
        const dados = {
            nome: document.getElementById('editNome').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            senha: document.getElementById('editSenha').value.trim(),
            pix: document.getElementById('editPix').value.trim()
        };
        if (!dados.nome || !dados.email || !dados.senha || !dados.pix) {
            document.getElementById('editStatus').textContent = 'Preencha todos os campos.';
            return;
        }
        document.getElementById('editStatus').textContent = 'Salvando...';
        overlay.querySelector('#editSaveBtn').disabled = true;
        try {
            if (dados.nome !== nomeAtual) {
                await adminFetch(API_BASE + '/api/admin/usuarios/' + cpf + '/edicao', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campo: 'nomeCompleto', valor: dados.nome })
                }).then(r => r.json());
            }
            if (dados.email !== emailAtual) {
                await adminFetch(API_BASE + '/api/admin/usuarios/' + cpf + '/edicao', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campo: 'email', valor: dados.email })
                }).then(r => r.json());
            }
            if (dados.senha !== senhaAtual) {
                await adminFetch(API_BASE + '/api/admin/usuarios/' + cpf + '/edicao', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campo: 'senha', valor: dados.senha })
                }).then(r => r.json());
            }
            if (dados.pix !== pixAtual) {
                await adminFetch(API_BASE + '/api/admin/usuarios/' + cpf + '/edicao', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campo: 'chavePix', valor: dados.pix })
                }).then(r => r.json());
            }
            overlay.remove();
            showToast('✅ Dados de "' + dados.nome + '" atualizados com sucesso!', 'success', 5000);
            carregarCadastrosAdmin();
        } catch (e) {
            document.getElementById('editStatus').textContent = 'Erro ao salvar: ' + e.message;
            overlay.querySelector('#editSaveBtn').disabled = false;
        }
    };
}

function addBonusSelecionado() {
    const select = document.getElementById('adminPlayerSelect');
    const amountInput = document.getElementById('adminChipAmount');
    if (!select || !amountInput) return;
    const nome = select.value;
    const valor = parseInt(amountInput.value, 10);
    if (!nome || isNaN(valor) || valor <= 0) {
        showToast('Escolha um jogador e um valor válido.', 'warning', 3000);
        return;
    }
    showSpinner('Concedendo bônus...');
    adminFetch(API_BASE + '/api/admin/usuario/bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, bonus: valor })
    })
    .then(r => r.json())
    .then(r => {
        hideSpinner();
        if (r.success) {
            showToast(`✅ Bônus de ${valor.toLocaleString('pt-BR')} concedido para "${nome}"!`, 'success', 6000);
            carregarAdminUsuariosComSaldo();
            carregarBarraJogadores();
        } else {
            showToast('Erro: ' + (r.error || 'Erro'), 'error', 6000);
        }
    })
    .catch(err => { hideSpinner(); showToast('Erro de conexão: ' + err.message, 'error', 6000); });
}

function removerBonusSelecionado() {
    const select = document.getElementById('adminPlayerSelect');
    const amountInput = document.getElementById('adminChipAmount');
    if (!select || !amountInput) return;
    const nome = select.value;
    const valor = parseInt(amountInput.value, 10);
    if (!nome || isNaN(valor) || valor <= 0) {
        showToast('Escolha um jogador e um valor válido.', 'warning', 3000);
        return;
    }
    if (!confirm(`Remover ${valor} de BÔNUS de "${nome}"?`)) return;
    showSpinner('Removendo bônus...');
    adminFetch(API_BASE + '/api/admin/usuario/remover-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, bonus: valor })
    })
    .then(r => r.json())
    .then(r => {
        hideSpinner();
        if (r.success) {
            showToast(`🎁 Bônus removido de "${nome}" (restante: ${r.bonusRestante}).`, 'success', 6000);
            carregarAdminUsuariosComSaldo();
            carregarBarraJogadores();
        } else {
            showToast('Erro: ' + (r.error || 'Erro'), 'error', 6000);
        }
    })
    .catch(err => { hideSpinner(); showToast('Erro de conexão: ' + err.message, 'error', 6000); });
}

function carregarBarraJogadores() {
    const div = document.getElementById('adminPlayersBar');
    if (!div) return;
    div.innerHTML = 'Carregando...';
    adminFetch(API_BASE + '/api/admin/usuarios-com-saldo')
        .then(r => r.json())
        .then(usuarios => {
            const reais = (usuarios || []).filter(u => !u.isBot);
            if (reais.length === 0) { div.innerHTML = '<p style="color:#a0a0b0">Nenhum jogador real.</p>'; return; }
            const f = n => 'R$ ' + (Number(n) / 1000).toFixed(2).replace('.', ',');
            let html = '<table style="width:100%;border-collapse:collapse;min-width:540px">';
            html += '<thead><tr style="text-align:left;color:#cbd5e1;border-bottom:1px solid rgba(255,255,255,0.15)">' +
                '<th style="padding:5px 6px">Jogador</th>' +
                '<th style="padding:5px 6px">Créd.Admin</th>' +
                '<th style="padding:5px 6px">Ganhos</th>' +
                '<th style="padding:5px 6px">Bônus</th>' +
                '<th style="padding:5px 6px">Depositado</th>' +
                '<th style="padding:5px 6px">Sacável</th>' +
                '</tr></thead><tbody>';
            reais.forEach(u => {
                const cred = u.adminCreditos || 0;
                const gan = u.winnings || 0;
                const bon = u.bonusGiven || 0;
                const dep = u.depositos || 0;
                const sac = cred + gan;
                html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.06)">` +
                    `<td style="padding:5px 6px">${u.nomeCompleto || u.name || '?'}</td>` +
                    `<td style="padding:5px 6px;color:#10b981">${f(cred)}</td>` +
                    `<td style="padding:5px 6px;color:#10b981">${f(gan)}</td>` +
                    `<td style="padding:5px 6px;color:#fbbf24">${f(bon)}</td>` +
                    `<td style="padding:5px 6px;color:#cbd5e1">${f(dep)}</td>` +
                    `<td style="padding:5px 6px;color:#38bdf8;font-weight:700">${f(sac)}</td>` +
                    `</tr>`;
            });
            html += '</tbody></table>';
            div.innerHTML = html;
        })
        .catch(() => { div.innerHTML = '<p style="color:#ef4444">Erro ao carregar.</p>'; });
}

function carregarAdminUsuariosComSaldo() {
    adminFetch(API_BASE + '/api/admin/usuarios-com-saldo')
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

            usuarios.filter(u => u.isBot !== true).forEach(u => {
                const option = document.createElement('option');
                option.value = u.nomeCompleto;
                const saldo = (u.chips / 1000).toFixed(2).replace('.', ',');
                const ganhos = (u.winnings / 1000).toFixed(2).replace('.', ',');
                const credAdmin = (u.adminCreditos / 1000).toFixed(2).replace('.', ',');
                const bonusG = ((u.bonusGiven || 0) / 1000).toFixed(2).replace('.', ',');
                option.textContent = `${u.nomeCompleto} (Saldo: R$ ${saldo} | Ganhos: R$ ${ganhos} | Créd.Admin: R$ ${credAdmin} | Bônus: R$ ${bonusG})`;
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
    adminFetch(API_BASE + '/api/admin/usuarios-com-saldo')
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
    const cpf = String(select.value).trim();
    const selectedOption = Array.from(select.options).find(o => o.value === cpf);
    if (!selectedOption) {
        showToast('Selecione um jogador válido para excluir.', 'warning', 3500);
        return;
    }
    const nome = selectedOption.dataset.nome || selectedOption.textContent || '';

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
        if (tabId === 'tabAntifraude') carregarAntiFraude();
    }
}

// ===================== ANTI-FRAUDE (item 19) =====================
function carregarAntiFraude() {
    const div = document.getElementById('adminAntiFraudeList');
    if (!div) return;
    div.innerHTML = '<p class="admin-empty">Carregando...</p>';
    adminFetch(API_BASE + '/api/admin/usuarios-suspeitos')
        .then(r => r.json())
        .then(data => {
            if (!data.success) { div.innerHTML = '<p class="admin-empty">Erro ao carregar.</p>'; return; }
            const grupos = data.grupos || [];
            if (!grupos.length) {
                div.innerHTML = '<p class="admin-empty">Nenhuma conta suspeita detectada. 👍</p>';
                return;
            }
            div.innerHTML = grupos.map(g => `
                <div class="admin-card" style="border-color:rgba(239,68,68,0.5)">
                    <div style="font-weight:800;color:#fca5a5;margin-bottom:6px">⚠️ ${g.contas.length} contas · ${escapeHtml(g.fingerprint)}</div>
                    ${g.contas.map(c => `<div style="color:#fff;font-size:0.85em;padding:2px 0">👤 ${escapeHtml(c.nome || c.cpf)} <span style="color:#a0a0b0">(${escapeHtml(c.cpf || '')})</span></div>`).join('')}
                </div>
            `).join('');
        })
        .catch(() => { div.innerHTML = '<p class="admin-empty">Erro ao carregar.</p>'; });
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
    adminFetch(API_BASE + '/api/admin/historico')
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
        <div style="color:#fff">Jogador: ${escapeHtml(t.nomeExibicao || t.nome)} — <strong style="color:#ffff00">R$ ${valor}</strong></div>
        ${t.detalhe ? `<div style="color:rgba(255,255,255,0.7);font-size:0.9em">${escapeHtml(t.detalhe)}</div>` : ''}
    </div>`;
}

function carregarTransacoesAdmin() {
    const div = document.getElementById('adminTransacoesList');
    if (!div) return;
    div.innerHTML = '<p style="color:#a0a0b0;font-size:0.82em">Carregando...</p>';
    const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
    adminFetch(API_BASE + '/api/admin/transacoes')
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
    adminFetch(API_BASE + '/api/admin/historico').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroHistDe', 'filtroHistAte');
        baixarJSON(filtrarPorData(d, 'data', filtro.de, filtro.ate), 'historico_sorteios.json');
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarHistoricoCSV() {
    adminFetch(API_BASE + '/api/admin/historico').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroHistDe', 'filtroHistAte');
        const dados = filtrarPorData(d, 'data', filtro.de, filtro.ate);
        baixarCSV(dados, 'historico_sorteios.csv', ['numero', 'data', 'totalBolas']);
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarTransacoesJSON() {
    adminFetch(API_BASE + '/api/admin/transacoes').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
        baixarJSON(filtrarPorData(d, 'data', filtro.de, filtro.ate), 'transacoes.json');
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

function baixarTransacoesCSV() {
    adminFetch(API_BASE + '/api/admin/transacoes').then(r => r.json()).then(d => {
        const filtro = getDataFiltro('filtroTransDe', 'filtroTransAte');
        const dados = filtrarPorData(d, 'data', filtro.de, filtro.ate);
        baixarCSV(dados, 'transacoes.csv', ['tipo', 'nome', 'valor', 'data', 'detalhe']);
    }).catch(() => showToast('Erro ao baixar.', 'error', 4000));
}

// ===================== AVISO MANUTENÇÃO (JOGADOR) =====================
function exibirAvisoManutencao(m) {
    const banner = document.getElementById('manutencaoBanner');
    if (!banner) return;
    if (!m || !m.ativo) {
        banner.style.display = 'none';
        return;
    }
    const titulo = document.getElementById('manutTitulo');
    const detalhe = document.getElementById('manutDetalhe');
    let texto = 'O site entrará em manutenção';
    if (m.data) texto += ' até ' + m.data;
    if (m.horario) texto += ' às ' + m.horario;
    if (titulo) titulo.textContent = m.mensagem ? '🔧 ' + m.mensagem : 'Manutenção Programada';
    if (detalhe) detalhe.textContent = texto + '. Obrigado pela compreensão!';
    banner.style.display = 'flex';
}

// ===================== MANUTENÇÃO PROGRAMADA =====================
function carregarManutencaoAdmin() {
    adminFetch(API_BASE + '/api/manutencao').then(r => r.json()).then(m => {
        const dataEl = document.getElementById('manutData');
        const horaEl = document.getElementById('manutHorario');
        const msgEl = document.getElementById('manutMensagem');
        const statusEl = document.getElementById('manutStatus');
        if (dataEl && m.data) dataEl.value = m.data;
        if (horaEl && m.horario) horaEl.value = m.horario;
        if (msgEl && m.mensagem) msgEl.value = m.mensagem;
        if (statusEl) {
            statusEl.textContent = m.ativo
                ? '✅ Aviso ATIVO até ' + (m.data || '?') + (m.horario ? ' às ' + m.horario : '')
                : '⏹️ Nenhum aviso ativo';
            statusEl.style.color = m.ativo ? '#10b981' : '#888';
        }
    }).catch(() => {});
}

function salvarManutencao(ativo) {
    const data = document.getElementById('manutData').value || '';
    const horario = document.getElementById('manutHorario').value || '';
    const mensagem = document.getElementById('manutMensagem').value || '';
    if (ativo && !data) {
        showToast('Informe a data da manutenção.', 'warning', 4000);
        return;
    }
    adminFetch(API_BASE + '/api/admin/manutencao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, horario, mensagem, ativo })
    })
    .then(r => r.json())
    .then(r => {
        if (r.success) {
            showToast(ativo ? '🔔 Aviso de manutenção ativado!' : 'Aviso desativado.', ativo ? 'success' : 'info', 4000);
            carregarManutencaoAdmin();
        } else {
            showToast('Erro: ' + (r.error || 'desconhecido'), 'error', 4000);
        }
    })
    .catch(() => showToast('Erro de conexão.', 'error', 4000));
}

