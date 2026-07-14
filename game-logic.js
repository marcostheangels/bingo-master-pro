window.API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
    ? '' : 'https://api.bingovipclub.online';
window.API_FALLBACK = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
    ? '' : 'https://bingo-master-pro-fcty.onrender.com';

// Fallback automático: se o domínio principal do backend falhar (ex.: SSL do subdomínio
// api.bingovipclub.online inválido), tenta o domínio padrão do Render.
(function () {
    const _origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!_origFetch) return;
    window.fetch = async function (input, init) {
        try {
            return await _origFetch(input, init);
        } catch (e) {
            if (typeof input === 'string' && window.API_BASE && input.indexOf(window.API_BASE) === 0) {
                const fallbackUrl = input.replace(window.API_BASE, window.API_FALLBACK);
                return await _origFetch(fallbackUrl, init);
            }
            throw e;
        }
    };
})();

const INITIAL_CHIPS = 0;
let minhaSessaoToken = localStorage.getItem('bingo_session_token') || '';
let meuCpf = (localStorage.getItem('bingo_meu_cpf') || '').padStart(11, '0').slice(0, 11);
let meuEmail = localStorage.getItem('bingo_meu_email') || ''; // 👈 Adicione esta linha

function mascaraCPF(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    input.value = v;
}

function validarCPF(cpf) {
    const nums = cpf.replace(/\D/g, '');
    if (nums.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(nums)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(nums[i]) * (10 - i);
    let dig1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (parseInt(nums[9]) !== dig1) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(nums[i]) * (11 - i);
    let dig2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (parseInt(nums[10]) !== dig2) return false;
    return true;
}


function mostrarAba(aba) {
    document.getElementById('authRegister').style.display = aba === 'register' ? 'block' : 'none';
    document.getElementById('authLogin').style.display = aba === 'login' ? 'block' : 'none';
    document.getElementById('regError').textContent = '';
    document.getElementById('loginError').textContent = '';
}

async function registrar() {
    const nome = document.getElementById('regNome').value.trim();
    const cpf = document.getElementById('regCpf').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const senha = document.getElementById('regSenha').value.trim();
    const confirma = document.getElementById('regConfirma').value.trim();
    const chavePix = document.getElementById('regChavePix').value.trim();
    const errEl = document.getElementById('regError');

    if (!nome || !cpf || !email || !senha || !confirma || !chavePix) {
        errEl.textContent = 'Preencha todos os campos.';
        return;
    }
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (!validarCPF(cpfLimpo)) {
        errEl.textContent = 'CPF inválido.';
        return;
    }
    if (senha.length < 4) {
        errEl.textContent = 'Senha deve ter no mínimo 4 caracteres.';
        return;
    }
    if (senha !== confirma) {
        errEl.textContent = 'Senhas não conferem.';
        return;
    }
    try {
        const res = await fetch(API_BASE + '/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nomeCompleto: nome, cpf: cpfLimpo, email, senha, chavePix })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.error || 'Erro ao cadastrar.';
            return;
        }
        
        // Atualização das variáveis globais
        minhaSessaoToken = data.sessionToken;
        meuCpf = data.cpf;
        meuEmail = data.email || email; // 🌟 Define a variável global do e-mail
        myName = data.nome;

        // Salvando no armazenamento local (localStorage)
        localStorage.setItem('bingo_session_token', data.sessionToken);
        localStorage.setItem('bingo_meu_cpf', data.cpf);
        localStorage.setItem('bingo_meu_email', meuEmail); // 🌟 Salva o e-mail para persistência
        localStorage.setItem('bingo_last_name', data.nome);
        
        showToast('Cadastro realizado com sucesso!', 'success');
        conectarAposAuth();
    } catch (e) {
        errEl.textContent = 'Erro de conexão com o servidor.';
    }
}

async function fazerLogin() {
    const cpf = document.getElementById('loginCpf').value.trim().replace(/\D/g, '');
    const senha = document.getElementById('loginSenha').value.trim();
    const errEl = document.getElementById('loginError');

    if (!cpf || !senha) {
        errEl.textContent = 'Preencha CPF e senha.';
        return;
    }
    try {
        const res = await fetch(API_BASE + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, senha })
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.error || 'Erro ao fazer login.';
            return;
        }
        minhaSessaoToken = data.sessionToken;
        meuCpf = data.cpf;
        localStorage.setItem('bingo_session_token', data.sessionToken);
        localStorage.setItem('bingo_meu_cpf', data.cpf);
        localStorage.setItem('bingo_last_name', data.nome);
        myName = data.nome;
        showToast('Login realizado com sucesso!', 'success');
        if (typeof syncChipsFromServer === 'function') await syncChipsFromServer(data.cpf, data.nome);
        conectarAposAuth();
    } catch (e) {
        errEl.textContent = 'Erro de conexão com o servidor.';
    }
}

function conectarAposAuth() {
    myChips = typeof loadChips === 'function' ? loadChips(myName) : INITIAL_CHIPS;
    if (typeof loadWinnings === 'function') loadWinnings();
    myCards = typeof loadCards === 'function' ? loadCards(myName) : [];
    if (typeof renderMyCards === 'function') renderMyCards();
    if (typeof updateChipsDisplay === 'function') updateChipsDisplay();

    const isMarcos = typeof isMarcosName === 'function' ? isMarcosName(myName) : false;
    // O servidor é quem manda no jogo (autoritativo). Todos são "jogadores".
    isHost = false;
    myId = `player-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    myRoomId = 'bingo-master-pro-marcos';
    cancelReconnect();
    setStatusMessage(isMarcos ? 'Entrando como administrador...' : 'Entrando na sala...', 'info');
    myRole = 'guest';
    pendingConnect = { type: 'connect', role: 'guest', roomId: myRoomId, name: myName, id: myId, chips: myChips };
    if (typeof requestWakeLock === 'function') requestWakeLock();
    if (typeof setupNoSleepFallback === 'function') setupNoSleepFallback();
    if (typeof showSpinner === 'function') showSpinner('Entrando na sala...');
    if (typeof initSounds === 'function') initSounds();
    connectSocket();
}

async function validarSessaoExistente() {
    if (!minhaSessaoToken || !meuCpf) return false;
    try {
        const res = await fetch(API_BASE + '/api/validar-sessao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: minhaSessaoToken, cpf: meuCpf })
        });
        const data = await res.json();
        if (data.valido) {
            myName = data.nome;
            meuCpf = data.cpf;
            localStorage.setItem('bingo_last_name', data.nome);
            if (typeof syncChipsFromServer === 'function') await syncChipsFromServer(meuCpf, myName);
            return true;
        }
    } catch (e) {}
    localStorage.removeItem('bingo_session_token');
    localStorage.removeItem('bingo_meu_cpf');
    minhaSessaoToken = '';
    meuCpf = '';
    return false;
}
const BOT_INITIAL_CHIPS = 10000; // bots comecam com R$10,00 em fichas (somente bots)
const PHASES = {
    kuadra: { label: 'Kuadra', description: '4 números na mesma linha horizontal', prize: '💰 R$ 3,00', reward: 3000 },
    kina: { label: 'Kina', description: '5 números na mesma linha horizontal', prize: '💰 R$ 5,00', reward: 5000 },
    keno: { label: 'Keno', description: 'Cartela completa', prize: '💰 R$ 7,00', reward: 7000 }
};
const PHASE_SEQUENCE = ['kuadra', 'kina', 'keno'];
const BOT_NAMES = ['Renata 🌸', 'Carlos 🍀', 'Fernanda 🌷', 'Juliana 💎', 'Pedro 🎯', 'Aline 🌺', 'Rodrigo ⚡', 'Tatiana 🌟', 'Bruno 🍀', 'Camila 🦋'];
const BOT_MAX_CARDS = 15;
const HUMAN_MAX_CARDS = 15;
const CARD_COST = 150;
const JACKPOT_BALL_LIMIT = 37;
let JACKPOT_REWARD = 100000;

function getRoundNumber() {
    return parseInt(localStorage.getItem('bingo_round_number') || '0', 10);
}
function setRoundNumber(n) {
    localStorage.setItem('bingo_round_number', n);
}
let currentRound = getRoundNumber();

function saveJackpotReward() {
    localStorage.setItem('bingo_jackpot_reward', JACKPOT_REWARD);
}

let myName = '';
let myChips = INITIAL_CHIPS;
let myWinnings = 0;
let myAdminCredits = 0;

function loadWinnings() {
    const saved = localStorage.getItem('bingo_ganhos_' + (myName ? myName.toLowerCase().trim() : ''));
    myWinnings = saved ? parseInt(saved, 10) : 0;
}

function loadAdminCredits() {
    const saved = localStorage.getItem('bingo_admin_creditos_' + (myName ? myName.toLowerCase().trim() : ''));
    myAdminCredits = saved ? parseInt(saved, 10) : 0;
}

function saveWinnings() {
    localStorage.setItem('bingo_ganhos_' + (myName ? myName.toLowerCase().trim() : ''), myWinnings);
}

function saveAdminCredits() {
    localStorage.setItem('bingo_admin_creditos_' + (myName ? myName.toLowerCase().trim() : ''), myAdminCredits);
}

function saveChips(name, chips) {
    localStorage.setItem('bingo_fichas_' + name.toLowerCase().trim(), chips);
}

function saveWinningsFor(name, value) {
    localStorage.setItem('bingo_ganhos_' + name.toLowerCase().trim(), value);
}

function loadCards(name) {
    try {
        const saved = localStorage.getItem('bingo_cards_' + name.toLowerCase().trim());
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        return [];
    }
}

function saveCards(name, cards) {
    localStorage.setItem('bingo_cards_' + name.toLowerCase().trim(), JSON.stringify(cards));
}

function loadWinningsFor(name) {
    const saved = localStorage.getItem('bingo_ganhos_' + name.toLowerCase().trim());
    return saved ? parseInt(saved, 10) : 0;
}

let isHost = false;
let gameActive = false;
let gameEnded = false;
let drawnBalls = [];
let myCards = [];
let allPlayers = [];
let currentPhaseIndex = 0;
let drawDelayTimeout = null;
let phasePauseTimeout = null;
let speedControlInitialized = false;
let latestCloseCards = {}; // mapping received from host: playerId -> [{cardId, phase}]
let wakeLock = null;

async function requestWakeLock() {
    if (document.visibilityState !== 'visible') return;
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        }
    } catch (err) {
        console.warn('Wake Lock não suportado ou negado:', err);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
    if (wakeLockVideo) {
        wakeLockVideo.pause();
        wakeLockVideo.remove();
        wakeLockVideo = null;
    }
}

// Re-solicita wake lock quando a aba volta a ficar visível
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.getElementById('screenGame')?.classList.contains('active')) {
        requestWakeLock();
        setupNoSleepFallback();
    }
});

// Fallback para iOS: mantém a tela acordada com stream de canvas
let wakeLockVideo = null;
function setupNoSleepFallback() {
    if (wakeLockVideo) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 1, 1);
        const stream = canvas.captureStream();
        wakeLockVideo = document.createElement('video');
        wakeLockVideo.setAttribute('playsinline', '');
        wakeLockVideo.setAttribute('muted', '');
        wakeLockVideo.setAttribute('loop', '');
        wakeLockVideo.style.position = 'fixed';
        wakeLockVideo.style.top = '-9999px';
        wakeLockVideo.style.left = '-9999px';
        wakeLockVideo.style.width = '1px';
        wakeLockVideo.style.height = '1px';
        wakeLockVideo.style.opacity = '0';
        wakeLockVideo.style.pointerEvents = 'none';
        wakeLockVideo.srcObject = stream;
        document.body.appendChild(wakeLockVideo);
        wakeLockVideo.play().catch(() => {});
    } catch (e) {
        console.warn('No-sleep fallback não disponível:', e);
    }
}

function getMaxCardsForPlayer(player) {
    if (!player) return HUMAN_MAX_CARDS;
    if (player.isBot) return BOT_MAX_CARDS;
    const normalized = player.name.trim().toLowerCase();
    if (normalized === 'markim' || normalized === 'marília' || normalized === 'marilia') {
        return HUMAN_MAX_CARDS;
    }
    return HUMAN_MAX_CARDS;
}

function loadBotChips(botName) {
    try {
        const saved = localStorage.getItem(`bingo_fichas_${botName.toLowerCase().trim()}`);
        return saved !== null ? parseInt(saved, 10) : BOT_INITIAL_CHIPS;
    } catch (e) {
        return BOT_INITIAL_CHIPS;
    }
}

function createBotPlayer(index) {
    const name = BOT_NAMES[index] || `Bot ${index + 1}`;
    return {
        id: `bot-${Date.now()}-${index}`,
        name: name,
        chips: loadBotChips(name),
        winnings: loadWinningsFor(name),
        cards: [],
        isHost: false,
        isBot: true
    };
}

function addBotsToGame() {
    if (allPlayers.some(p => p.isBot)) return;

    BOT_NAMES.forEach((botName, index) => {
        const bot = createBotPlayer(index);
        const botCardCount = BOT_MAX_CARDS;
        for (let i = 0; i < botCardCount; i++) {
            bot.cards.push(generateBingoCardData());
        }
        bot.chips = Math.max(0, bot.chips - bot.cards.length * CARD_COST);
        allPlayers.push(bot);
    });

    if (typeof updatePlayerListUI === 'function') updatePlayerListUI();
}

function abrirAdminScreen() {
    goToScreen('screenAdmin');
    adminAbrirAba('tabSaques');
    carregarModoTeste();
    carregarAdminUsuariosComSaldo();
    carregarUsuariosParaExclusao();
}
function fecharAdminScreen() {
    goToScreen('screenGame');
}

function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if (!screen) return;
    screen.classList.add('active');

        if (screenId === 'screenGame') {
            try {
                updatePhaseUI();
                const nameLabel = document.getElementById('labelMyName');
                const avatar = document.getElementById('avatarIcon');
                if (nameLabel) nameLabel.textContent = myName;
                if (avatar) avatar.textContent = myName.charAt(0).toUpperCase();
                loadWinnings();
                updateChipsDisplay();

                // Botão admin no topo - só para o dono.
                const adminBtn = document.getElementById('btnAdminOpen');
                const isMarcos = typeof isMarcosName === 'function' && isMarcosName(myName);
                const ehDono = isMarcos || (typeof souDono !== 'undefined' && souDono);
                const ehEspectador = typeof myRole !== 'undefined' && myRole === 'spectator';
                if (adminBtn) adminBtn.style.display = (!ehEspectador && (isHost || ehDono)) ? '' : 'none';

                if (ehEspectador && typeof hideBotoesFinanceiros === 'function') {
                    hideBotoesFinanceiros();
                }

                const hostMsgEl = document.getElementById('hostOnlyMsg');
                if (hostMsgEl) hostMsgEl.style.display = isHost ? 'block' : 'none';
                renderMyCards();
                if (isHost) {
                    addBotsToGame();
                    sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
                }

                if (!speedControlInitialized) {
                    speedControlInitialized = true;
                    const speedInput = document.getElementById('speedRange');
                    if (speedInput) {
                        speedInput.addEventListener('input', () => {
                            if (drawDelayTimeout) {
                                scheduleNextDraw();
                            }
                        });
                    }
                }

                // Pré-carrega os áudios para não atrasar na primeira bola
                if (typeof initSounds === 'function') initSounds();

                // Solicita wake lock para manter a tela acesa durante o jogo
                requestWakeLock();
                // Fallback iOS: vídeo invisível mudo
                setupNoSleepFallback();
            } catch (err) {
                console.error('Erro ao inicializar a tela do jogo (tela ainda visível):', err);
            }
        } else {
            // Libera wake lock ao sair da tela do jogo
            releaseWakeLock();
        }
}

function updatePhaseUI() {
    const activePhase = getCurrentPhaseKey();

    Object.keys(PHASES).forEach(key => {
        const element = document.getElementById(`phase_${key}`);
        if (!element) return;

        const stateLabel = key === activePhase
            ? 'Em jogo'
            : PHASE_SEQUENCE.indexOf(key) < currentPhaseIndex
                ? 'Concluído'
                : 'Aguardando';

        element.innerHTML = `${PHASES[key].label}: <span class="prize">${PHASES[key].prize}</span> <span class="phase-state">${stateLabel}</span>`;
        element.classList.toggle('phase-active', key === activePhase);
        element.classList.toggle('phase-completed', PHASE_SEQUENCE.indexOf(key) < currentPhaseIndex);
    });
    updateJackpotPanel();
}

function formatReais(valor) {
    return (valor / 1000).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function updateJackpotPanel() {
    const subtitle = document.getElementById('jackpotSubtitle');
    const panel = document.querySelector('.jackpot-panel');
    if (!subtitle) return;

    const remaining = Math.max(0, JACKPOT_BALL_LIMIT - drawnBalls.length);
    if (drawnBalls.length > JACKPOT_BALL_LIMIT) {
        subtitle.innerHTML = 'Jackpot não disponível nesta rodada';
        if (panel) { panel.classList.remove('jackpot-active'); panel.classList.add('jackpot-inactive'); }
    } else {
        subtitle.innerHTML = `FECHE A CARTELA EM ATÉ <strong>${JACKPOT_BALL_LIMIT}</strong> BOLAS E LEVE O JACKPOT DE <strong style="color:#ffff00">R$ ${formatReais(JACKPOT_REWARD)}</strong>!<br><span style="font-size:0.85em;opacity:0.8;text-transform:none;font-weight:400">${remaining} bola${remaining === 1 ? '' : 's'} restante${remaining === 1 ? '' : 's'}</span>`;
        if (panel) { panel.classList.remove('jackpot-inactive'); panel.classList.add('jackpot-active'); }
    }
    const val = document.querySelector('.jackpot-value');
    if (val) val.textContent = `R$ ${formatReais(JACKPOT_REWARD)}`;

    updateJackpotBallsPanel();
}

function updateJackpotBallsPanel() {
    const panel = document.getElementById('jackpotBallsPanel');
    const grid = document.getElementById('jackpotBallsGrid');
    if (!panel || !grid) return;

    if (drawnBalls.length >= JACKPOT_BALL_LIMIT) {
        panel.classList.remove('visible');
        return;
    }

    const neededNumbers = new Set();
    const phase = getCurrentPhaseKey();

    allPlayers.forEach(player => {
        if (!player.cards) return;
        player.cards.forEach(card => {
            const numbers = card.numbers;
            if (phase === 'kuadra') {
                for (let row = 0; row < 3; row++) {
                    const rowMarks = numbers[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
                    if (rowMarks >= 3 && rowMarks < 4 && !card.awards.kuadra) {
                        numbers[row].forEach(value => {
                            if (value !== '' && !drawnBalls.includes(Number(value))) {
                                neededNumbers.add(Number(value));
                            }
                        });
                    }
                }
            } else if (phase === 'kina') {
                for (let row = 0; row < 3; row++) {
                    const rowMarks = numbers[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
                    if (rowMarks >= 4 && rowMarks < 5 && !card.awards.kina) {
                        numbers[row].forEach(value => {
                            if (value !== '' && !drawnBalls.includes(Number(value))) {
                                neededNumbers.add(Number(value));
                            }
                        });
                    }
                }
            } else if (phase === 'keno') {
                const totalMarked = numbers.flat().reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
                if (totalMarked >= 14 && totalMarked < 15 && !card.awards.keno) {
                    numbers.flat().forEach(value => {
                        if (value !== '' && !drawnBalls.includes(Number(value))) {
                            neededNumbers.add(Number(value));
                        }
                    });
                }
            }
        });
    });

    if (neededNumbers.size === 0) {
        panel.classList.remove('visible');
        return;
    }

    const sortedNumbers = Array.from(neededNumbers).sort((a, b) => a - b);
    grid.innerHTML = sortedNumbers.map(num => {
        let cls = 'jackpot-ball';
        if (phase === 'kuadra') cls += ' kuadra';
        else if (phase === 'kina') cls += ' kina';
        else if (phase === 'keno') cls += ' keno';
        return `<div class="${cls}">${num}</div>`;
    }).join('');

    panel.classList.add('visible');
}

function showWinnerToast(phaseKey, results) {
    if (!results || !results.length) return;
    const names = results.map(result => (result.player ? result.player.name : result.name)).join(', ');
    const jackpotWinner = results.some(result => result.jackpotCount > 0);
    const firstReward = results[0]?.totalReward || 0;
    const rewardStr = 'R$ ' + (firstReward / 1000).toFixed(2).replace('.', ',');
    const message = results.length === 1
        ? `${names} venceu ${PHASES[phaseKey].label} e recebeu ${rewardStr}!`
        : `${names} ganharam ${PHASES[phaseKey].label} e receberam ${rewardStr} cada!`;

    const finalMessage = jackpotWinner
        ? `${message} Jackpot ativado!`
        : message;

    const toast = document.createElement('div');
    toast.className = 'winner-toast';
    toast.textContent = finalMessage;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 500);
    }, 3500);
}

function playWinnerSound(phaseKey, results) {
    playSound('winner', phaseKey || 'keno');
}

function notifyGuestsOfWinner(phaseKey, playerResults) {
    if (!isHost) return;
    const payload = playerResults.map(result => {
        const cardData = getWinnerCardDetails(result.player, phaseKey);
        return {
            name: result.player.name,
            totalReward: result.totalReward,
            jackpotCount: result.jackpotCount,
            card: cardData ? {
                numbers: cardData.numbers,
                winningRow: cardData.winningRow,
                winningNum: cardData.winningNum,
                phaseKey: cardData.phaseKey
            } : null
        };
    });
    sendToGuest({ type: 'winnerEvent', phaseKey, results: payload });
}

let jackpotAudio = null;

function showWinnerBanner(phaseKey, results) {
    const isJackpot = results.some(r => r.jackpotCount > 0);
    if (isJackpot) {
        showJackpotCelebration(results);
        return true;
    }
    showPhaseCelebration(phaseKey, results);
    return false;
}

const PHASE_CELEBRATIONS = {
    kuadra: {
        icon: '◆', title: 'KUADRA!', subtitle: '4 Números na Mesma Linha',
        bgFrom: '#f0f0f5', bgVia: '#e8e8f0', bgTo: '#dcdce6',
        particles: ['◆', '◇', '✦'], count: 20
    },
    kina: {
        icon: '⭐', title: 'KINA!', subtitle: '5 Números em Linha',
        bgFrom: '#f0f0f5', bgVia: '#e8e8f0', bgTo: '#dcdce6',
        particles: ['⭐', '✨', '✦'], count: 22
    },
    keno: {
        icon: '🎯', title: 'KENO!', subtitle: 'Cartela Completa!',
        bgFrom: '#f0f0f5', bgVia: '#e8e8f0', bgTo: '#dcdce6',
        particles: ['🎯', '✨', '🌟'], count: 26
    }
};

function getWinnerCardDetails(player, phaseKey) {
    if (!player || !player.cards) return null;
    for (const card of player.cards) {
        if (card.awards && card.awards[phaseKey]) {
            const lastBall = drawnBalls.length ? drawnBalls[drawnBalls.length - 1] : null;
            let winningRow = -1;
            let winningNum = null;
            if (phaseKey === 'kuadra' || phaseKey === 'kina') {
                const target = phaseKey === 'kuadra' ? 4 : 5;
                for (let row = 0; row < 3; row++) {
                    const rowMarks = card.numbers[row].reduce((c, v) => c + (v !== '' && drawnBalls.includes(Number(v)) ? 1 : 0), 0);
                    if (rowMarks >= target) {
                        winningRow = row;
                        break;
                    }
                }
            }
            if (phaseKey === 'keno') {
                winningNum = lastBall;
            } else if (winningRow >= 0 && lastBall !== null) {
                for (let col = 0; col < 9; col++) {
                    const v = card.numbers[winningRow][col];
                    if (v !== '' && Number(v) === lastBall) {
                        winningNum = lastBall;
                        break;
                    }
                }
            }
            return {
                codigo: card.codigo || card.id.slice(-8).toUpperCase(),
                numbers: card.numbers,
                winningRow,
                winningNum,
                phaseKey
            };
        }
    }
    return null;
}

function renderWinnerCardHTML(cardData) {
    if (!cardData) return '';
    const card = cardData.numbers;
    const wr = cardData.winningRow;
    const wn = cardData.winningNum;
    const isKeno = cardData.phaseKey === 'keno';
    const idText = cardData.codigo ? `<div style="text-align:center;color:#1e90ff;font-weight:800;font-size:0.8em;margin-top:4px">ID da Cartela: ${cardData.codigo}</div>` : '';
    let grid = '<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px;margin:10px auto;max-width:360px;background:#fff;padding:6px;border-radius:10px">';
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 9; col++) {
            const val = card[row][col];
            if (val === '') {
                const isWinningRow = row === wr;
                const emptyBg = isKeno ? 'rgba(30,144,255,0.15)' : (isWinningRow ? 'rgba(239,68,68,0.15)' : 'rgba(0,0,0,0.06)');
                grid += `<div style="aspect-ratio:1;background:${emptyBg};border-radius:4px"></div>`;
            } else {
                const marked = drawnBalls.includes(Number(val));
                const isWinningNum = Number(val) === wn;
                let bg, color;
                if (isWinningNum) {
                    bg = '#ef4444'; color = '#fff';
                } else if (isKeno && marked) {
                    bg = '#1e90ff'; color = '#fff';
                } else if (marked && row === wr) {
                    bg = '#10b981'; color = '#fff';
                } else if (marked) {
                    bg = 'rgba(0,0,0,0.12)'; color = '#0b091a';
                } else if (row === wr) {
                    bg = 'rgba(239,68,68,0.08)'; color = '#333';
                } else {
                    bg = 'rgba(0,0,0,0.06)'; color = '#333';
                }
                grid += `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:0.9em;font-weight:700;border-radius:4px;background:${bg};color:${color}">${val}</div>`;
            }
        }
    }
    grid += '</div>';
    grid += idText;
    return grid;
}

function showPhaseCelebration(phaseKey, results) {
    const cfg = PHASE_CELEBRATIONS[phaseKey] || PHASE_CELEBRATIONS.keno;
    const overlay = document.createElement('div');
    overlay.className = 'winner-banner-overlay';
    overlay.style.cssText = `position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,2,113,0.7);backdrop-filter:blur(8px);z-index:10000;opacity:0;transition:opacity 0.4s`;
    const names = results.map(r => (r.player ? r.player.name : r.name)).join(', ');
    const total = results.reduce((s, r) => s + (r.totalReward || 0), 0);
    const totalReais = (total / 1000).toFixed(2).replace('.', ',');

    let cardsHTML = '';
    results.forEach(r => {
        let cardData = null;
        if (r.card) {
            cardData = { numbers: r.card.numbers, winningRow: r.card.winningRow, winningNum: r.card.winningNum, codigo: r.card.codigo, phaseKey: r.card.phaseKey || phaseKey };
        } else {
            const playerObj = r.player || (typeof allPlayers !== 'undefined' ? allPlayers.find(p => p.name === r.name) : null);
            if (playerObj) cardData = getWinnerCardDetails(playerObj, phaseKey);
        }
        if (cardData) {
            cardsHTML += `<div style="margin:8px 0;text-align:center">${renderWinnerCardHTML(cardData)}</div>`;
        }
    });

    overlay.innerHTML = `
    <div style="background:linear-gradient(to bottom, rgb(106, 121, 255), rgb(0, 3, 152), rgb(0, 3, 152), rgb(0, 3, 152));color:#ffffff;padding:30px 35px;border-radius:14px;text-align:center;box-shadow:5px 5px 0px rgba(0,0,0,0.55);max-width:500px;width:90%;position:relative;max-height:90vh;overflow-y:auto;border:2px solid rgba(255,255,0,0.4)">
        <div style="font-size:3em;margin-bottom:4px">${cfg.icon}</div>
        <div style="font-size:2.5em;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#ffff00;text-shadow:3px 3px rgba(0,0,0,1)">${cfg.title}</div>
        <div style="font-size:1.1em;font-weight:600;margin-top:6px;color:#ffffff">${cfg.subtitle}</div>
        <div style="font-size:2.2em;font-weight:900;margin:10px 0;color:#ffff00;text-shadow:3px 3px rgba(0,0,0,1)">R$ ${totalReais}</div>
        <div style="font-size:1.1em;font-weight:500;margin-bottom:8px;color:#ffffff">${names}</div>
        ${cardsHTML}
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

    const isMobile = window.innerWidth < 768;
    const particleCount = isMobile ? Math.min(cfg.count, 12) : cfg.count;

    const style = document.createElement('style');
    style.textContent = `
    .phaseParticle{position:fixed;pointer-events:none;z-index:10001;will-change:transform,opacity;contain:paint;backface-visibility:hidden;animation:phaseParticleFloat ease-out forwards}
    @keyframes phaseParticleFloat{0%{transform:translate3d(0,0,0) scale(0);opacity:1}100%{transform:translate3d(0,calc(-80vh),0) scale(1.1);opacity:0}}
    `;
    document.head.appendChild(style);

    for (let i = 0; i < particleCount; i++) {
        setTimeout(() => {
            const p = document.createElement('div');
            p.className = 'phaseParticle';
            p.textContent = cfg.particles[Math.floor(Math.random() * cfg.particles.length)];
            p.style.left = (5 + Math.random() * 90) + '%';
            p.style.bottom = '0';
            p.style.fontSize = (isMobile ? 0.9 + Math.random() * 1 : 1 + Math.random() * 1.5) + 'em';
            p.style.animationDuration = (3 + Math.random() * 1.5) + 's';
            p.style.animationDelay = (Math.random() * 0.5) + 's';
            document.body.appendChild(p);
            setTimeout(() => p.remove(), 6000);
        }, i * (isMobile ? 60 : 100));
    }

    setTimeout(() => closePhaseBanner(null, overlay), 4000);
}

function closePhaseBanner(btn, overlay) {
    const el = overlay || (btn ? btn.closest('.winner-banner-overlay') : null);
    if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }
}

function showJackpotCelebration(results) {
    if (jackpotAudio) { jackpotAudio.pause(); jackpotAudio = null; }
    jackpotAudio = new Audio('chaves_3.mp3');
    jackpotAudio.loop = false;
    jackpotAudio.volume = 0.4;
    jackpotAudio.play().catch(() => {});

    const overlay = document.createElement('div');
    overlay.className = 'winner-banner-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,2,113,0.75);backdrop-filter:blur(12px);z-index:10000;opacity:0;transition:opacity 0.4s';
    const names = results.map(r => (r.player ? r.player.name : r.name)).join(', ');
    const total = results.reduce((s, r) => s + (r.totalReward || 0), 0);
    const totalReais = (total / 1000).toFixed(2).replace('.', ',');
    overlay.innerHTML = `
    <div style="background:linear-gradient(to bottom, rgb(106, 121, 255), rgb(0, 3, 152), rgb(0, 3, 152), rgb(0, 3, 152));color:#ffffff;padding:50px 60px;border-radius:14px;text-align:center;box-shadow:5px 5px 0px rgba(0,0,0,0.55);max-width:520px;width:90%;position:relative;overflow:hidden;border:2px solid rgba(255,255,0,0.4)" id="jackpotBanner">
        <div style="font-size:4em;margin-bottom:10px">👑</div>
        <div style="font-size:4em;font-weight:900;letter-spacing:6px;text-transform:uppercase;color:#ffff00;text-shadow:3px 3px rgba(0,0,0,1)">JACKPOT!</div>
        <div style="font-size:1.3em;font-weight:600;margin-top:8px;opacity:0.9">GRANDE VENCEDOR</div>
        <div style="font-size:3.2em;font-weight:900;margin:16px 0;color:#ffff00;text-shadow:3px 3px rgba(0,0,0,1)">R$ ${totalReais}</div>
        <div style="font-size:1.2em;font-weight:500;opacity:0.85;margin-bottom:20px">${names}</div>
        <button onclick="closeJackpotBanner()" style="padding:14px 40px;border-radius:50px;border:2px solid rgba(255,255,0,0.4);background:rgba(0,0,0,0.2);color:#ffffff;font-size:1em;font-weight:700;cursor:pointer;transition:all 0.3s">Fechar</button>
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');

    const style = document.createElement('style');
    style.textContent = `
    @keyframes jackpotPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.02)} }
    @keyframes jackpotBorderSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes jackpotBounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-15px)} }
    @keyframes jackpotGlow { 0%,100%{text-shadow:0 4px 20px rgba(0,0,0,0.15)} 50%{text-shadow:0 4px 40px rgba(0,0,0,0.25),0 0 60px rgba(255,215,0,0.3)} }
    @keyframes jackpotValuePulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
    .jackpotCoin{position:fixed;pointer-events:none;z-index:10001;animation:jackpotCoinFall linear forwards}
    @keyframes jackpotCoinFall{0%{transform:translateY(-100px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
    .jackpotSpark{position:absolute;border-radius:50%;pointer-events:none;animation:jackpotSparkBurst ease-out forwards}
    @keyframes jackpotSparkBurst{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0}}
    `;
    document.head.appendChild(style);

    for (let i = 0; i < 40; i++) {
        setTimeout(() => {
            const c = document.createElement('div');
            c.className = 'jackpotCoin';
            c.textContent = ['🪙','💰'][Math.random() > 0.5 ? 1 : 0];
            c.style.left = Math.random() * 100 + '%';
            c.style.fontSize = (1.5 + Math.random() * 1.5) + 'em';
            c.style.animationDuration = (2 + Math.random() * 2) + 's';
            document.body.appendChild(c);
            setTimeout(() => c.remove(), 5000);
        }, i * 80);
    }

    setTimeout(closeJackpotBanner, 4000);
}

function closeJackpotBanner() {
    if (jackpotAudio) { jackpotAudio.pause(); jackpotAudio = null; }
    const overlays = document.querySelectorAll('.winner-banner-overlay');
    overlays.forEach(o => {
        o.style.opacity = '0';
        setTimeout(() => o.remove(), 500);
    });
}

function getCurrentPhaseKey() {
    return PHASE_SEQUENCE[currentPhaseIndex] || 'keno';
}

function advancePhase() {
    if (currentPhaseIndex < PHASE_SEQUENCE.length - 1) {
        currentPhaseIndex += 1;
        updatePhaseUI();
        const nextPhase = PHASES[getCurrentPhaseKey()].label;
        addLog(`Fase avançou para ${nextPhase}.`);
    }
}

function getDrawSpeed() {
    const speedInput = document.getElementById('speedRange');
    return speedInput ? parseInt(speedInput.value, 10) || 3000 : 3000;
}

function updateChipsDisplay() {
    const label = document.getElementById('labelMyChips');
    if (!label) return;
    const saldoReais = (myChips / 1000).toFixed(2).replace('.', ',');
    const ganhoReais = (myWinnings / 1000).toFixed(2).replace('.', ',');
    const adminReais = (myAdminCredits / 1000).toFixed(2).replace('.', ',');
    let sacavel = myWinnings;
    let nota = '';
    if (typeof modoTesteSaque !== 'undefined' && modoTesteSaque) {
        sacavel = myAdminCredits;
        nota = ' 🧪 MODO TESTE (créditos admin)';
    }
    const sacavelReais = (sacavel / 1000).toFixed(2).replace('.', ',');
    label.innerHTML = `R$ ${saldoReais} <span style="font-size:0.75em;color:#10b981;margin-left:4px">(Sacável: R$ ${sacavelReais}${nota})</span>`;
}

function speak(text) {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= 90) {
        if (typeof playNarration === 'function') playNarration(num);
        return;
    }
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function getMarkedCountInRow(card, row) {
    return card[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
}

function getCardCompleted(card) {
    return card.flat().every(value => value === '' || drawnBalls.includes(Number(value)));
}

function computeCardAwards(cardData) {
    const awards = [];
    const numbers = cardData.numbers;
    const currentPhase = getCurrentPhaseKey();
    const completed = getCardCompleted(numbers);

    if (currentPhase === 'kuadra') {
        for (let row = 0; row < 3; row++) {
            const count = getMarkedCountInRow(numbers, row);
            if (count >= 4 && !cardData.awards.kuadra) {
                cardData.awards.kuadra = true;
                awards.push('kuadra');
                break;
            }
        }
        return awards;
    }

    if (currentPhase === 'kina') {
        for (let row = 0; row < 3; row++) {
            const count = getMarkedCountInRow(numbers, row);
            if (count >= 5 && !cardData.awards.kina) {
                cardData.awards.kina = true;
                awards.push('kina');
                break;
            }
        }
        return awards;
    }

    if (currentPhase === 'keno' && completed && !cardData.awards.keno) {
        cardData.awards.keno = true;
        awards.push('keno');
        return awards;
    }

    return awards;
}

function generateBingoCardData() {
    const card = Array.from({ length: 3 }, () => Array(9).fill(''));

    for (let column = 0; column < 9; column++) {
        const start = column === 0 ? 1 : column * 10;
        const end = column === 8 ? 90 : column * 10 + 9;
        const pool = [];
        for (let n = start; n <= end; n++) pool.push(n);

        const selected = [];
        for (let row = 0; row < 3; row++) {
            const index = Math.floor(Math.random() * pool.length);
            selected.push(pool.splice(index, 1)[0]);
        }

        selected.sort((a, b) => a - b);
        for (let row = 0; row < 3; row++) {
            card[row][column] = selected[row];
        }
    }

    const colCount = Array(9).fill(3);

    for (let row = 0; row < 3; row++) {
        const candidates = [];
        for (let col = 0; col < 9; col++) {
            if (colCount[col] > 1) candidates.push(col);
        }
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        const toClear = candidates.slice(0, 4);
        toClear.forEach(col => {
            card[row][col] = '';
            colCount[col]--;
        });
    }

    const cardId = `card-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const codigo = Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    return { id: cardId, codigo, numbers: card, awards: { kuadra: false, kina: false, keno: false } };
}

function getCardProgress(cardData) {
    const numbers = cardData.numbers;
    let totalMarked = 0;
    let maxRowMarks = 0;

    for (let row = 0; row < 3; row++) {
        let rowMarked = 0;
        for (let column = 0; column < 9; column++) {
            const value = numbers[row][column];
            if (value !== '' && drawnBalls.includes(Number(value))) {
                rowMarked += 1;
            }
        }
        maxRowMarks = Math.max(maxRowMarks, rowMarked);
        totalMarked += rowMarked;
    }

    return totalMarked + maxRowMarks * 2;
}

// mapeia todas as cartelas próximas ou vencedoras (por playerId -> [{cardId, phase, won}])
function computeCloseCardsForAllPlayers() {
    const map = {};
    allPlayers.forEach(player => {
        if (!player || !player.cards) return;
        const list = [];
        player.cards.forEach((card) => {
            const result = getCardClosePhase(card);
            if (result) list.push({ cardId: card.id, phase: result.phase, won: result.won });
        });
        if (list.length) map[player.id || player.name] = list;
    });
    return map;
}

function renderCloseCardsPanel() {
    const panel = document.getElementById('closeCardsList');
    if (!panel) return;
    panel.innerHTML = '';

    const entries = Object.entries(latestCloseCards);
    if (!entries.length) {
        panel.innerHTML = '<div class="close-empty">Nenhuma cartela próxima ainda.</div>';
        return;
    }

    entries.forEach(([playerId, cards]) => {
        const player = allPlayers.find(p => (p.id || p.name) === playerId);
        const playerName = player ? player.name : playerId;
        const isHostPlayer = player && player.isHost;
        const isBotPlayer = player && player.isBot;

        const closeCounts = {};
        const wonCounts = {};
        cards.forEach(c => {
            if (c.won) {
                wonCounts[c.phase] = (wonCounts[c.phase] || 0) + 1;
            } else {
                closeCounts[c.phase] = (closeCounts[c.phase] || 0) + 1;
            }
        });

        const badges = [];
        Object.entries(wonCounts).forEach(([phase, count]) => {
            const label = phase === 'kuadra' ? 'Kuadra' : phase === 'kina' ? 'Kina' : phase === 'keno' ? 'Bingo' : phase;
            badges.push(`<span class="close-badge close-${phase}-won">✅ ${count}x ${label}</span>`);
        });
        Object.entries(closeCounts).forEach(([phase, count]) => {
            const label = phase === 'kuadra' ? 'Kuadra' : phase === 'kina' ? 'Kina' : phase === 'keno' ? 'Bingo' : phase;
            badges.push(`<span class="close-badge close-${phase}">🔥 ${count}x ${label}</span>`);
        });

        const item = document.createElement('div');
        item.className = 'close-card-item';
        item.innerHTML = `<span class="close-player">${isHostPlayer ? '👑 ' : ''}${playerName}</span><span class="close-badges">${badges.join('')}</span>`;
        panel.appendChild(item);
    });
}

function getCardClosePhase(cardData) {
    cardData.awards = cardData.awards || { kuadra: false, kina: false, keno: false };
    const numbers = cardData.numbers;
    const currentPhase = getCurrentPhaseKey();
    const currentPhaseIndex = PHASE_SEQUENCE.indexOf(currentPhase);

    // Verifica Kuadra (APENAS se fase atual for kuadra)
    if (currentPhaseIndex === 0) {
        if (cardData.awards.kuadra) return { phase: 'kuadra', won: true };
        for (let row = 0; row < 3; row++) {
            const rowMarks = numbers[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
            if (rowMarks >= 3) return { phase: 'kuadra', won: false };
        }
    }

    // Verifica Kina (APENAS se fase atual for kina)
    if (currentPhaseIndex === 1) {
        if (cardData.awards.kina) return { phase: 'kina', won: true };
        for (let row = 0; row < 3; row++) {
            const rowMarks = numbers[row].reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
            if (rowMarks >= 4) return { phase: 'kina', won: false };
        }
    }

    // Verifica Keno/Bingo (APENAS se fase atual for keno)
    if (currentPhaseIndex === 2) {
        if (cardData.awards.keno) return { phase: 'keno', won: true };
        const totalMarked = numbers.flat().reduce((count, value) => count + (value !== '' && drawnBalls.includes(Number(value)) ? 1 : 0), 0);
        if (totalMarked >= 14) return { phase: 'keno', won: false };
    }

    return null;
}

function buyBingoCards(quantity) {
    if (gameActive) {
        showToast('O sorteio já iniciou. Não é possível comprar cartelas durante o jogo.', 'warning', 5000);
        return;
    }
    if (!socketReady) {
        showToast('Conectando ao servidor... aguarde e tente novamente.', 'warning', 5000);
        return;
    }
    if (typeof sendAction === 'function') {
        sendAction('buyCards', { qty: quantity });
        showToast('Solicitando compra...', 'info', 2000);
    }
}

function buyBingoCard() {
    buyBingoCards(1);
}

function renderMyCards() {
    const grid = document.getElementById('myCardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!myCards.length) {
        const placeholder = document.createElement('div');
        placeholder.textContent = 'Nenhuma cartela comprada ainda.';
        placeholder.style.color = '#aaa';
        placeholder.style.padding = '12px';
        grid.appendChild(placeholder);
        return;
    }

    const sortedCards = [...myCards].sort((a, b) => getCardProgress(b) - getCardProgress(a));

    sortedCards.forEach((cardData, index) => {
        const card = cardData.numbers;
        const awardLabels = [];
        if (cardData.awards.kuadra) awardLabels.push('Kuadra');
        if (cardData.awards.kina) awardLabels.push('Kina');
        if (cardData.awards.keno) awardLabels.push('Keno');
        // determine closePhase from host-synced map when not host
        let closePhase = null;
        if (isHost) {
            closePhase = getCardClosePhase(cardData);
        } else {
            const mapForMe = latestCloseCards[myId] || [];
            const found = mapForMe.find(it => it.cardId === cardData.id);
            if (found) closePhase = { phase: found.phase, won: found.won };
        }
        const closeLabel = closePhase
            ? closePhase.won
                ? closePhase.phase === 'kuadra' ? '✅ Kuadra' : closePhase.phase === 'kina' ? '✅ Kina' : '✅ Bingo'
                : closePhase.phase === 'kuadra' ? '🔥 Quase Kuadra' : closePhase.phase === 'kina' ? '🔥 Quase Kina' : '🔥 Quase Bingo'
            : '';

        const cardBox = document.createElement('div');
        cardBox.className = 'bingo-card' + (closePhase ? ' card-close' : '');
        // if the card already has any awards (phase passed), hide the card title as requested
        const titleText = awardLabels.length ? '' : `Cartela #${index + 1}`;
        const idText = cardData.codigo ? `<span class="card-id">ID: ${cardData.codigo}</span>` : '';
        cardBox.innerHTML = `<div class="card-title">${titleText}${awardLabels.length ? ' - ' + awardLabels.join(', ') : ''} ${idText}</div>`;
        if (closeLabel) {
            cardBox.innerHTML += `<div class="card-badge">${closeLabel}</div>`;
        }

        const cardGrid = document.createElement('div');
        cardGrid.className = 'card-grid';

        const kenoCompleto = getCardCompleted(card);
        const ultimaBola = drawnBalls.length ? drawnBalls[drawnBalls.length - 1] : null;

        for (let row = 0; row < 3; row++) {
            for (let column = 0; column < 9; column++) {
                const cell = document.createElement('div');
                const value = card[row][column];
                if (value === '') {
                    cell.className = 'card-cell empty';
                } else {
                    cell.className = 'card-cell';
                    cell.textContent = value;
                    if (drawnBalls.includes(Number(value))) {
                        if (kenoCompleto && Number(value) === ultimaBola) {
                            cell.classList.add('marked', 'keno-complete-last');
                        } else if (kenoCompleto) {
                            cell.classList.add('marked', 'keno-complete');
                        } else {
                            cell.classList.add('marked');
                        }
                    }
                }
                cardGrid.appendChild(cell);
            }
        }

        cardBox.appendChild(cardGrid);
        grid.appendChild(cardBox);
    });
}

function startBingoDraw() {
    if (!isHost || drawDelayTimeout || phasePauseTimeout) return;

    const overlay = document.getElementById('countdownOverlay');
    if (overlay) overlay.classList.remove('visible');

    currentRound = getRoundNumber() + 1;
    setRoundNumber(currentRound);
    const roundEl = document.getElementById('currentRoundNumber');
    if (roundEl) roundEl.textContent = 'Sorteio #' + currentRound;

    const button = document.getElementById('btnStartGame');
    if (button) button.disabled = true;
    setRestartButtonState(false);
    gameActive = true;
    gameEnded = false;

    // Bots recebem suas cartelas no início de cada rodada
    allPlayers.forEach(player => {
        if (player.isBot && (!player.cards || player.cards.length === 0)) {
            for (let i = 0; i < BOT_MAX_CARDS; i++) {
                player.cards.push(generateBingoCardData());
            }
            player.chips = Math.max(0, player.chips - player.cards.length * CARD_COST);
            saveChips(player.name, player.chips);
        }
    });
    updatePlayerListUI();
    renderMyCards();

    scheduleNextDraw();
    salvarEstadoJogo();
}

function setRestartButtonState(enabled) {
    const button = document.getElementById('btnResetGame');
    if (button) {
        button.disabled = !enabled;
        button.style.opacity = enabled ? '1' : '0.5';
        button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }
}

function resetGame() {
    if (!isHost) return;
    clearTimeout(drawDelayTimeout);
    clearTimeout(phasePauseTimeout);
    drawDelayTimeout = null;
    phasePauseTimeout = null;
    const overlay = document.getElementById('countdownOverlay');
    if (overlay) overlay.classList.remove('visible');
    gameActive = false;
    gameEnded = false;
    drawnBalls = [];
    currentPhaseIndex = 0;

    // Limpa TODAS as cartelas (humanos e bots) e reembolsa apenas humanos
    allPlayers.forEach(player => {
        const qtd = player.cards ? player.cards.length : 0;
        if (!player.isBot && qtd > 0) {
            player.chips += qtd * CARD_COST;
            saveChips(player.name, player.chips);
        }
        player.cards = [];
    });

    // Sincroniza estado local do host
    myCards = [];
    saveCards(myName, myCards);
    const hostPlayer = allPlayers.find(p => p.id === 'host');
    if (hostPlayer) {
        myChips = hostPlayer.chips;
        updateChipsDisplay();
    }

    latestCloseCards = {};
    renderCloseCardsPanel();
    updatePhaseUI();
    updatePlayerListUI();
    renderMyCards();
    applyBoardReset();
    setRestartButtonState(false);
    const button = document.getElementById('btnStartGame');
    if (button) button.disabled = false;
    addLog('🔄 Jogo reiniciado. Fichas reembolsadas! Compre novas cartelas.');
    sendToGuest({ type: 'resetGame', players: allPlayers, drawnBalls, currentPhaseIndex, gameActive, gameEnded });
    releaseWakeLock();
    salvarEstadoJogo();
}

function initDrawnGrid() {
    const grid = document.getElementById('drawnGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
        const cell = document.createElement('div');
        cell.className = 'dgrid-cell';
        cell.dataset.num = i;
        cell.textContent = i;
        grid.appendChild(cell);
    }
}

function syncDrawnGrid() {
    if (!drawnBalls || !drawnBalls.length) return;
    const grid = document.getElementById('drawnGrid');
    if (!grid) return;
    drawnBalls.forEach(ball => {
        const cell = grid.querySelector(`.dgrid-cell[data-num="${ball}"]`);
        if (cell) cell.classList.add('drawn');
    });
}

function applyBoardReset() {
    const grid = document.getElementById('drawnGrid');
    if (grid) {
        grid.querySelectorAll('.dgrid-cell').forEach(c => {
            c.classList.remove('drawn', 'winner');
        });
    }
    const mainBall = document.getElementById('mainBall');
    if (mainBall) mainBall.textContent = '-';
}

function scheduleNextDraw(delay = null) {
    if (drawDelayTimeout) {
        clearTimeout(drawDelayTimeout);
    }
    const nextDelay = delay !== null ? delay : getDrawSpeed();
    drawDelayTimeout = setTimeout(drawNextBall, nextDelay);
}

function drawNextBall() {
    if (drawnBalls.length >= 90) {
        clearTimeout(drawDelayTimeout);
        drawDelayTimeout = null;
        addLog('Fim de Jogo! Todas as bolas foram sorteadas.');
        return;
    }

    let ball;
    do {
        ball = Math.floor(Math.random() * 90) + 1;
    } while (drawnBalls.includes(ball));

    drawnBalls.push(ball);
    speak(`${ball}`);
    addLog(`Número sorteado: ${ball}`);
    applyDrawnBall(ball);

    // after applying the ball, compute close cards and sync to guests
    if (isHost) {
        const closeMap = computeCloseCardsForAllPlayers();
        latestCloseCards = closeMap;
        renderCloseCardsPanel();
        sendToGuest({ type: 'closeCards', data: closeMap });
    }

    const winners = checkAwardsForAllPlayers();
    if (winners.length > 0) {
        const phaseKey = getCurrentPhaseKey();
        const phaseTitle = PHASES[phaseKey].label;
        const playerResults = processPhaseWinners(winners, phaseKey);

        playerResults.forEach(result => {
            const jackpotText = result.jackpotCount ? ` + jackpot ${result.jackpotCount}x!` : '';
            addLog(`${result.player.name} ganhou ${result.totalReward.toLocaleString('pt-BR')} fichas em ${phaseTitle}.${jackpotText}`);
        });

        showWinnerBanner(phaseKey, playerResults);
        notifyGuestsOfWinner(phaseKey, playerResults);
        updatePlayerListUI();
        renderMyCards();
        sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });

        if (currentPhaseIndex < PHASE_SEQUENCE.length - 1) {
            advancePhase();
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            phasePauseTimeout = setTimeout(() => {
                phasePauseTimeout = null;
                scheduleNextDraw();
            }, 5000);
            return;
        }

        addLog('Bingo concluído. Fim da rodada.');
        sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
        clearTimeout(drawDelayTimeout);
        drawDelayTimeout = null;
        gameActive = false;
        gameEnded = true;
        setRestartButtonState(true);
        sendToGuest({ type: 'jackpotUpdate', value: JACKPOT_REWARD });
        releaseWakeLock();
        if (isHost) {
            addLog('Rodada encerrada. Cartelas serão limpas em 10s e nova rodada iniciará em 1 minuto.');
            setTimeout(() => {
                if (!isHost || gameActive) return;
                bloquearAutoStart = true;
                resetGame();
                addLog('Cartelas limpas. Aguardando 1 minuto para nova rodada...');
                setTimeout(() => {
                    bloquearAutoStart = false;
                    if (isHost && !gameActive) {
                        startBingoDraw();
                    }
                }, 60000);
            }, 10000);
        }
        return;
    }

    sendToGuest({ type: 'syncBall', ball, drawnBalls });
    sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
    scheduleNextDraw();
}

function checkAwardsForAllPlayers() {
    if (!isHost) return [];
    const winners = [];

    allPlayers.forEach(player => {
        player.cards.forEach((cardData, cardIndex) => {
            const newAwards = computeCardAwards(cardData);
            newAwards.forEach(phase => {
                winners.push({ player, cardIndex, phase });
            });
        });
    });

    return winners;
}

function isJackpotEligible(phaseKey) {
    return phaseKey === 'keno' && drawnBalls.length <= JACKPOT_BALL_LIMIT;
}

function processPhaseWinners(winners, phaseKey) {
    const reward = PHASES[phaseKey].reward;
    const isJackpot = isJackpotEligible(phaseKey);

    // Count unique winners (one prize per player, not per card)
    const uniquePlayers = [];
    const seen = new Set();
    winners.forEach(({ player }) => {
        if (!player || typeof player.chips !== 'number') return;
        const key = player.id || player.name;
        if (!seen.has(key)) {
            seen.add(key);
            uniquePlayers.push(player);
        }
    });

    if (uniquePlayers.length === 0) return [];

    // Split phase prize equally among all winners
    const perPlayer = Math.max(1, Math.floor(reward / uniquePlayers.length));
    const jackpotPerPlayer = isJackpot ? Math.floor(JACKPOT_REWARD / uniquePlayers.length) : 0;

    const results = uniquePlayers.map(player => {
        let totalReward = perPlayer;
        let jackpotCount = 0;
        if (isJackpot) {
            totalReward += jackpotPerPlayer;
            jackpotCount = 1;
        }
        return { player, cards: 0, totalReward, jackpotCount };
    });

    results.forEach(result => {
        const oldWinnings = result.player.winnings || 0;
        result.player.winnings = oldWinnings + result.totalReward;
        result.player.chips += result.totalReward;
        console.log(`[PREMIO] ${result.player.name} ganhou ${result.totalReward} fichas. Winnings: ${oldWinnings} -> ${result.player.winnings} | Chips: ${result.player.chips}`);
        saveWinningsFor(result.player.name, result.player.winnings);
        saveChips(result.player.name, result.player.chips);
        // Registra a transação de prêmio no servidor (para o painel do admin)
        try {
            fetch(API_BASE + '/api/registrar-premio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: result.player.name, valor: result.totalReward, fase: phaseKey })
            }).catch(() => {});
        } catch (e) {}
        if (result.player.id === myId || (isHost && result.player.id === 'host')) {
            myWinnings = result.player.winnings || 0;
            myChips = result.player.chips;
            saveWinnings();
            saveChips(myName, myChips);
            updateChipsDisplay();
            console.log(`[MEU PREMIO] myWinnings atualizado para ${myWinnings} | myChips ${myChips}`);
        }
    });
    if (typeof updatePlayerListUI === 'function') updatePlayerListUI();

    if (isJackpot) {
        JACKPOT_REWARD = 100000;
        saveJackpotReward();
        sendToGuest({ type: 'jackpotUpdate', value: JACKPOT_REWARD });
        const jackpotDisplay = document.querySelector('.jackpot-value');
        if (jackpotDisplay) jackpotDisplay.textContent = 'R$ 100,00';
        updateJackpotPanel();
    }

    return results;
}

function applyDrawnBall(ball) {
    const mainDisplay = document.getElementById('mainBall');
    if (mainDisplay) {
        mainDisplay.textContent = ball;
        mainDisplay.classList.add('ball-animate');
        setTimeout(() => mainDisplay.classList.remove('ball-animate'), 500);
    }

    const grid = document.getElementById('drawnGrid');
    if (grid) {
        const cell = grid.querySelector(`.dgrid-cell[data-num="${ball}"]`);
        if (cell) {
            const isWinner = typeof window.__ultimaBolaVencedora !== 'undefined' && Number(ball) === Number(window.__ultimaBolaVencedora);
            cell.classList.add('drawn');
            if (isWinner) cell.classList.add('winner');
        }
    }

    renderMyCards();
    updateJackpotPanel();
}

function addLog(message) {
    const log = document.getElementById('gameLog');
    if (!log) return;
    const entry = document.createElement('div');
    entry.style.padding = '4px 0';
    entry.textContent = message;
    log.insertBefore(entry, log.firstChild);
}

// ==================== SOUND EFFECTS (MP3 reais do ShowOnline) ====================
let soundInitialized = false;
let kuadraSound = null, kinaSound = null, bingoSound = null;
let drawAudioCtx = null;

let lastNarrationAudio = null;

function initSounds() {
    if (soundInitialized) return;
    soundInitialized = true;
    if (typeof Howl === 'undefined') return;
    kuadraSound = new Howl({ src: ['kuadra.mp3'], volume: 0.8 });
    kinaSound = new Howl({ src: ['kina.mp3'], volume: 0.8 });
    bingoSound = new Howl({ src: ['keno.mp3'], volume: 0.8 });
}

function unlockAudioOnInteraction() {
    const unlock = () => {
        if (drawAudioCtx && drawAudioCtx.state === 'suspended') {
            drawAudioCtx.resume().catch(() => {});
        }
        if (typeof Howl !== 'undefined') {
            const silent = new Howl({ src: ['kuadra.mp3'], volume: 0 });
            silent.play();
        }
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
}
if (typeof window !== 'undefined') {
    unlockAudioOnInteraction();
}

function playNarration(ballNumber) {
    if (ballNumber < 1 || ballNumber > 90) return;
    if (lastNarrationAudio) {
        lastNarrationAudio.pause();
        lastNarrationAudio.currentTime = 0;
    }
    const pad = String(ballNumber).padStart(2, '0');
    const audio = new Audio(`balls/${pad}.mp3`);
    audio.volume = 0.7;
    lastNarrationAudio = audio;
    audio.play().catch(() => {});
}

function playSound(type, phase) {
    initSounds();
    if (type === 'draw') {
        try {
            if (!drawAudioCtx) drawAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = drawAudioCtx;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600 + Math.random() * 400, ctx.currentTime);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.08);
        } catch (e) {}
    } else if (type === 'mark') {
        try {
            if (!drawAudioCtx) drawAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = drawAudioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1000, ctx.currentTime);
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.04);
        } catch (e) {}
    } else if (type === 'winner') {
        if (phase === 'kuadra' && kuadraSound) kuadraSound.play();
        else if (phase === 'kina' && kinaSound) kinaSound.play();
        else if (bingoSound) bingoSound.play();
    }
}

// ==================== CONFETTI ====================
let confettiPieces = [];
let confettiAnimId = null;

function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#fbbf24', '#f59e0b', '#f97316', '#ef4444', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];

    for (let i = 0; i < 150; i++) {
        confettiPieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 8 + 4,
            h: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 4,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            rotV: (Math.random() - 0.5) * 8,
            opacity: 1
        });
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        confettiPieces.forEach(p => {
            p.x += p.vx;
            p.vy += 0.05;
            p.y += p.vy;
            p.rot += p.rotV;
            if (p.y > canvas.height + 20) { p.opacity -= 0.02; }
            if (p.opacity <= 0) return;
            alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        if (alive) {
            confettiAnimId = requestAnimationFrame(animate);
        } else {
            confettiPieces = [];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    animate();
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ==================== FULLSCREEN ====================
function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
}

// ==================== SPINNER ====================
function showSpinner(text = 'Conectando...') {
    const overlay = document.getElementById('spinnerOverlay');
    const txt = document.getElementById('spinnerText');
    if (overlay) overlay.classList.add('visible');
    if (txt) txt.textContent = text;
}
function hideSpinner() {
    const overlay = document.getElementById('spinnerOverlay');
    if (overlay) overlay.classList.remove('visible');
}

// ==================== OFFLINE BANNER ====================
function showOfflineBanner(visible) {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.toggle('visible', visible);
}

// ==================== BALL DRAW ANIMATION ====================
function animateBallDraw(callback) {
    const display = document.getElementById('mainBall');
    if (!display) { if (callback) callback(); return; }
    display.classList.add('ball-spinning');
    const interval = 60;
    let count = 0;
    const spinInterval = setInterval(() => {
        display.textContent = Math.floor(Math.random() * 90) + 1;
        count++;
        if (count >= 12) {
            clearInterval(spinInterval);
            display.classList.remove('ball-spinning');
            if (callback) callback();
        }
    }, interval);
}

// ==================== HISTORY ====================
function updateHistory(ball) {
    // removido - painel historico nao existe mais
}

// ==================== UNDO ====================
let lastDrawnBall = null;

function undoLastBall() {
    if (typeof sendAction === 'function') sendAction('undo');
}

// ==================== READY / PREPARAR ====================
let isReady = false;
let readyPlayers = {};

// ==================== CARD THEMES ====================
const CARD_THEMES = ['default', 'red', 'blue', 'green', 'purple', 'gold'];

function getRandomCardTheme() {
    return CARD_THEMES[Math.floor(Math.random() * CARD_THEMES.length)];
}

// Override renderMyCards to support themes
const _origRenderMyCards = renderMyCards;
renderMyCards = function() {
    const grid = document.getElementById('myCardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!myCards.length) {
        const placeholder = document.createElement('div');
        placeholder.textContent = 'Nenhuma cartela comprada ainda.';
        placeholder.style.color = '#aaa';
        placeholder.style.padding = '12px';
        grid.appendChild(placeholder);
        return;
    }

    const sortedCards = [...myCards].sort((a, b) => getCardProgress(b) - getCardProgress(a));

    sortedCards.forEach((cardData, index) => {
        const card = cardData.numbers;
        if (!cardData.theme) cardData.theme = getRandomCardTheme();
        const awardLabels = [];
        if (cardData.awards.kuadra) awardLabels.push('Kuadra');
        if (cardData.awards.kina) awardLabels.push('Kina');
        if (cardData.awards.keno) awardLabels.push('Keno');
        let closePhase = null;
        if (isHost) {
            closePhase = getCardClosePhase(cardData);
        } else {
            const mapForMe = latestCloseCards[myId] || [];
            const found = mapForMe.find(it => it.cardId === cardData.id);
            if (found) closePhase = { phase: found.phase, won: found.won };
        }
        const closeLabel = closePhase
            ? closePhase.won
                ? closePhase.phase === 'kuadra' ? '✅ Kuadra' : closePhase.phase === 'kina' ? '✅ Kina' : '✅ Bingo'
                : closePhase.phase === 'kuadra' ? '🔥 Quase Kuadra' : closePhase.phase === 'kina' ? '🔥 Quase Kina' : '🔥 Quase Bingo'
            : '';

        const cardBox = document.createElement('div');
        cardBox.className = `bingo-card${closePhase ? ' card-close' : ''} theme-${cardData.theme}`;
        const titleText = awardLabels.length ? '' : `Cartela #${index + 1}`;
        cardBox.innerHTML = `<div class="card-title">${titleText}${awardLabels.length ? ' - ' + awardLabels.join(', ') : ''}</div>`;
        if (closeLabel) {
            cardBox.innerHTML += `<div class="card-badge">${closeLabel}</div>`;
        }

        const cardGrid = document.createElement('div');
        cardGrid.className = 'card-grid';

        const currentPhase = getCurrentPhaseKey();
        const wonKuadra = cardData.awards.kuadra && currentPhase === 'kuadra';
        const wonKina = cardData.awards.kina && currentPhase === 'kina';
        const wonKeno = cardData.awards.keno;

        let winningRow = -1;
        if (wonKuadra) {
            for (let r = 0; r < 3; r++) {
                const marks = card[r].filter(v => v !== '' && drawnBalls.includes(Number(v))).length;
                if (marks >= 4) { winningRow = r; break; }
            }
        }
        if (wonKina) {
            for (let r = 0; r < 3; r++) {
                const marks = card[r].filter(v => v !== '' && drawnBalls.includes(Number(v))).length;
                if (marks >= 5) { winningRow = r; break; }
            }
        }

        const ultimaBola = drawnBalls.length ? drawnBalls[drawnBalls.length - 1] : null;
        const winningBall = typeof window.__ultimaBolaVencedora !== 'undefined' ? Number(window.__ultimaBolaVencedora) : null;

        for (let row = 0; row < 3; row++) {
            for (let column = 0; column < 9; column++) {
                const cell = document.createElement('div');
                const value = card[row][column];
                if (value === '') {
                    cell.className = 'card-cell empty';
                } else {
                    cell.className = 'card-cell';
                    cell.textContent = value;
                    if (drawnBalls.includes(Number(value))) {
                        const isWinningBall = winningBall !== null && Number(value) === winningBall;
                        const isWinningRow = (wonKuadra || wonKina) && row === winningRow;

                        if (wonKeno) {
                            cell.classList.add(isWinningBall ? 'marked-blue-last' : 'marked-blue');
                        } else if (isWinningRow) {
                            cell.classList.add(isWinningBall ? 'marked-last' : 'marked-blue');
                        } else {
                            cell.classList.add('marked');
                        }
                    }
                }
                cardGrid.appendChild(cell);
            }
        }

        cardBox.appendChild(cardGrid);
        const codigoEl = document.createElement('div');
        codigoEl.className = 'card-codigo';
        codigoEl.textContent = '';
        cardBox.appendChild(codigoEl);
        grid.appendChild(cardBox);
    });
};

// ==================== MODIFICATIONS TO EXISTING FUNCTIONS ====================

// Patch drawNextBall to add spinning animation, history, and sound
const _origDrawNextBall = drawNextBall;
drawNextBall = function() {
    if (drawnBalls.length >= 90) {
        clearTimeout(drawDelayTimeout);
        drawDelayTimeout = null;
        gameActive = false;
        gameEnded = true;
        setRestartButtonState(true);
        addLog('Fim de Jogo! Todas as bolas foram sorteadas.');
        salvarHistoricoRodada();
        releaseWakeLock();
        return;
    }

    let ball;
    do {
        ball = Math.floor(Math.random() * 90) + 1;
    } while (drawnBalls.includes(ball));

    lastDrawnBall = ball;
    document.getElementById('btnUndo').disabled = false;

    animateBallDraw(() => {
        drawnBalls.push(ball);
        playSound('draw');
        speak(`${ball}`);
        addLog(`Número sorteado: ${ball}`);
        applyDrawnBall(ball);
        updateHistory(ball);

        if (isHost) {
            const closeMap = computeCloseCardsForAllPlayers();
            latestCloseCards = closeMap;
            renderCloseCardsPanel();
            sendToGuest({ type: 'closeCards', data: closeMap });
        }

        const winners = checkAwardsForAllPlayers();
        if (winners.length > 0) {
            const phaseKey = getCurrentPhaseKey();
            const phaseTitle = PHASES[phaseKey].label;
            const playerResults = processPhaseWinners(winners, phaseKey);

            playerResults.forEach(result => {
                const jackpotText = result.jackpotCount ? ` + jackpot ${result.jackpotCount}x!` : '';
                addLog(`${result.player.name} ganhou ${result.totalReward.toLocaleString('pt-BR')} fichas em ${phaseTitle}.${jackpotText}`);
            });

            const isJackpot = playerResults.some(r => r.jackpotCount > 0);
            if (!isJackpot) playWinnerSound(phaseKey, playerResults);
            launchConfetti();
            showWinnerBanner(phaseKey, playerResults);
            notifyGuestsOfWinner(phaseKey, playerResults);
            sendToGuest({ type: 'confetti' });
            updatePlayerListUI();
            renderMyCards();
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });

            if (currentPhaseIndex < PHASE_SEQUENCE.length - 1) {
                advancePhase();
                sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
                phasePauseTimeout = setTimeout(() => {
                    phasePauseTimeout = null;
                    scheduleNextDraw();
                }, 5000);
                return;
            }

            addLog('Bingo concluído. Fim da rodada.');
            sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            clearTimeout(drawDelayTimeout);
            drawDelayTimeout = null;
            gameActive = false;
            gameEnded = true;
            setRestartButtonState(true);
            sendToGuest({ type: 'jackpotUpdate', value: JACKPOT_REWARD });
            salvarHistoricoRodada();
            releaseWakeLock();
            return;
        }

        sendToGuest({ type: 'syncBall', ball, drawnBalls });
        sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
        if (isHost) salvarEstadoJogo();
        scheduleNextDraw();
    });
};

// Patch applyDrawnBall to play mark sound
const _origApplyDrawnBall = applyDrawnBall;
applyDrawnBall = function(ball) {
    _origApplyDrawnBall(ball);
    playSound('mark');
};

// Patch resetGame to clear history and restart auto-start
const _origResetGame = resetGame;
resetGame = function() {
    _origResetGame();
    pararAutoStart();
    lastDrawnBall = null;
    document.getElementById('btnUndo').disabled = true;
    const btnAuto = document.getElementById('btnStartGame');
    const btnManual = document.getElementById('btnNextBall');
    const speedControl = document.querySelector('.speed-control');
    if (btnAuto) btnAuto.style.display = '';
    if (btnManual) btnManual.style.display = 'none';
    if (speedControl) speedControl.style.display = '';
    isReady = false;
    readyPlayers = {};
    const btnReady = document.getElementById('btnReady');
    if (btnReady) { btnReady.classList.remove('ready'); btnReady.textContent = '✅ Estou Pronto'; }
    updateReadyUI();
    if (isHost) setTimeout(iniciarAutoStart, 1000);
};

// Patch startBingoDraw to handle ready check and stop auto-start
const _origStartBingoDraw = startBingoDraw;
startBingoDraw = function() {
    if (!isHost || drawDelayTimeout || phasePauseTimeout) return;
    pararAutoStart();
    _origStartBingoDraw();
};

// Patch scheduleNextDraw to always schedule (modo manual removido)
const _origScheduleNextDraw = scheduleNextDraw;
scheduleNextDraw = function(delay) {
    _origScheduleNextDraw(delay);
};

// ==================== HISTORICO DE RODADAS ====================
function getVencedoresRodada() {
    const vencedores = { kuadra: [], kina: [], keno: [] };
    allPlayers.forEach(player => {
        if (!player.cards) return;
        player.cards.forEach(card => {
            if (card.awards.kuadra) vencedores.kuadra.push({ nome: player.name, premio: PHASES.kuadra.reward });
            if (card.awards.kina) vencedores.kina.push({ nome: player.name, premio: PHASES.kina.reward });
            if (card.awards.keno) {
                const jackpot = card.awards.keno && drawnBalls.length <= JACKPOT_BALL_LIMIT;
                vencedores.keno.push({ nome: player.name, premio: PHASES.keno.reward + (jackpot ? JACKPOT_REWARD : 0) });
            }
        });
    });
    return vencedores;
}

function salvarHistoricoRodada() {
    if (!isHost || !currentRound) return;
    const dados = {
        numero: currentRound,
        data: new Date().toISOString(),
        bolasSorteadas: [...drawnBalls],
        totalBolas: drawnBalls.length,
        vencedores: getVencedoresRodada()
    };
    fetch(API_BASE + '/api/salvar-historico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
    }).catch(() => {});
    const roundEl = document.getElementById('currentRoundNumber');
    if (roundEl) roundEl.textContent = 'Último: Sorteio #' + currentRound;
    addLog(`📋 Sorteio #${currentRound} salvo no histórico.`);
}

// ==================== MISSING NUMBERS PANEL ====================
function computarNumerosFaltando() {
    const playersMap = {};
    if (!allPlayers || !allPlayers.length) return [];
    const phase = getCurrentPhaseKey();
    const phaseIdx = PHASE_SEQUENCE.indexOf(phase);

    allPlayers.forEach(player => {
        if (!player.cards) return;
        const key = player.id || player.name;
        let bestEntry = null;
        let bestMissing = 999;

        player.cards.forEach(card => {
            const numbers = card.numbers;
            const missing = { kuadra: [], kina: [], keno: [] };

            if (phaseIdx === 0 && !card.awards.kuadra) {
                for (let row = 0; row < 3; row++) {
                    const rowMarks = numbers[row].reduce((c, v) => c + (v !== '' && drawnBalls.includes(Number(v)) ? 1 : 0), 0);
                    if (rowMarks >= 3 && rowMarks < 4) {
                        numbers[row].forEach(v => {
                            if (v !== '' && !drawnBalls.includes(Number(v)) && !missing.kuadra.includes(Number(v))) {
                                missing.kuadra.push(Number(v));
                            }
                        });
                    }
                }
            }
            if (phaseIdx === 1 && !card.awards.kina) {
                for (let row = 0; row < 3; row++) {
                    const rowMarks = numbers[row].reduce((c, v) => c + (v !== '' && drawnBalls.includes(Number(v)) ? 1 : 0), 0);
                    if (rowMarks >= 4 && rowMarks < 5) {
                        numbers[row].forEach(v => {
                            if (v !== '' && !drawnBalls.includes(Number(v)) && !missing.kina.includes(Number(v))) {
                                missing.kina.push(Number(v));
                            }
                        });
                    }
                }
            }
            if (phaseIdx === 2 && !card.awards.keno) {
                const totalMarked = numbers.flat().reduce((c, v) => c + (v !== '' && drawnBalls.includes(Number(v)) ? 1 : 0), 0);
                if (totalMarked >= 14 && totalMarked < 15) {
                    numbers.flat().forEach(v => {
                        if (v !== '' && !drawnBalls.includes(Number(v))) {
                            missing.keno.push(Number(v));
                        }
                    });
                }
            }

            const totalMissing = missing.kuadra.length + missing.kina.length + missing.keno.length;
            if (totalMissing > 0 && totalMissing < bestMissing) {
                bestMissing = totalMissing;
                bestEntry = {
                    codigo: card.codigo || card.id.slice(-8).toUpperCase(),
                    kuadra: missing.kuadra,
                    kina: missing.kina,
                    keno: missing.keno
                };
            }
        });

        if (bestEntry) {
            playersMap[key] = { nome: player.name, ...bestEntry, totalMissing: bestMissing };
        }
    });

    return Object.values(playersMap).sort((a, b) => a.totalMissing - b.totalMissing);
}

function renderMissingNumbersPanel() {
    const panel = document.getElementById('missingNumbersList');
    if (!panel) return;

    const phaseIdx = typeof currentPhaseIndex !== 'undefined' ? currentPhaseIndex : 0;
    const phaseName = phaseIdx === 0 ? 'Kuadra' : phaseIdx === 1 ? 'Kina' : 'Keno';
    const titleEl = document.getElementById('missingTitle');
    if (titleEl) titleEl.textContent = 'Cartelas faltando 1 bola ' + phaseName;

    const filtered = [];

    (allPlayers || []).forEach(p => {
        if (!p.cards) return;
        const pName = p.name;

        let kuadraCount = 0;
        let kinaCount = 0;
        let kenoCount = 0;
        const kuadraBalls = new Set();
        const kinaBalls = new Set();
        const kenoBalls = new Set();

        p.cards.forEach(card => {
            if (phaseIdx === 0 && !card.awards.kuadra) {
                for (let r = 0; r < 3; r++) {
                    const marks = card.numbers[r].filter(v => v !== '' && drawnBalls.includes(Number(v))).length;
                    if (marks === 3) {
                        kuadraCount++;
                        const missing = card.numbers[r].find(v => v !== '' && !drawnBalls.includes(Number(v)));
                        if (missing !== undefined) kuadraBalls.add(Number(missing));
                        break;
                    }
                }
            }

            if (phaseIdx === 1 && !card.awards.kina) {
                for (let r = 0; r < 3; r++) {
                    const marks = card.numbers[r].filter(v => v !== '' && drawnBalls.includes(Number(v))).length;
                    if (marks === 4) {
                        kinaCount++;
                        const missing = card.numbers[r].find(v => v !== '' && !drawnBalls.includes(Number(v)));
                        if (missing !== undefined) kinaBalls.add(Number(missing));
                        break;
                    }
                }
            }

            if (phaseIdx === 2 && !card.awards.keno) {
                const allNums = card.numbers.flat().filter(v => v !== '');
                const marks = allNums.filter(v => drawnBalls.includes(Number(v))).length;
                if (marks === 14) {
                    kenoCount++;
                    const missing = allNums.find(v => !drawnBalls.includes(Number(v)));
                    if (missing !== undefined) kenoBalls.add(Number(missing));
                }
            }
        });

        const arrKua = [...kuadraBalls].sort((a, b) => a - b);
        const arrKin = [...kinaBalls].sort((a, b) => a - b);
        const arrKen = [...kenoBalls].sort((a, b) => a - b);

        if (!arrKua.length && !arrKin.length && !arrKen.length) return;

        filtered.push({ nome: pName, arrKua, arrKin, arrKen, kuadraCount, kinaCount, kenoCount });
    });

    if (!filtered.length) {
        panel.innerHTML = '<p style="color:#6b6599;font-size:0.82em">Ninguém com 1 bola de diferença.</p>';
        return;
    }

    panel.innerHTML = filtered.map(entry => {
        const rows = [];
        if (entry.arrKua.length) {
            const cnt = entry.kuadraCount;
            const desc = cnt === 1 ? `${cnt} cartela` : `${cnt} cartelas`;
            const nums = entry.arrKua.map(n => `<span class="missing-ball kuadra">${n}</span>`).join('');
            rows.push(`<div class="missing-row"><span class="close-badge close-kuadra">🔥 Kuadra</span> ${desc}: ${nums}</div>`);
        }
        if (entry.arrKin.length) {
            const cnt = entry.kinaCount;
            const desc = cnt === 1 ? `${cnt} cartela` : `${cnt} cartelas`;
            const nums = entry.arrKin.map(n => `<span class="missing-ball kina">${n}</span>`).join('');
            rows.push(`<div class="missing-row"><span class="close-badge close-kina">🔥 Kina</span> ${desc}: ${nums}</div>`);
        }
        if (entry.arrKen.length) {
            const cnt = entry.kenoCount;
            const desc = cnt === 1 ? `${cnt} cartela` : `${cnt} cartelas`;
            const nums = entry.arrKen.map(n => `<span class="missing-ball keno">${n}</span>`).join('');
            rows.push(`<div class="missing-row"><span class="close-badge close-keno">🔥 Keno</span> ${desc}: ${nums}</div>`);
        }
        return `<div class="missing-player-card"><div class="missing-player-header"><span class="missing-player-name">${entry.nome}</span></div>${rows.join('')}</div>`;
    }).join('');
}

// ==================== KENO RANKING ANIMATION ====================
function showKenoRanking() {
    if (typeof allPlayers === 'undefined' || !allPlayers) return;
    const kuadra = [];
    const kina = [];
    const keno = [];
    const seen = { kuadra: new Set(), kina: new Set(), keno: new Set() };
    allPlayers.forEach(p => {
        if (!p.cards) return;
        p.cards.forEach(card => {
            if (card.awards && card.awards.kuadra && !seen.kuadra.has(p.name)) {
                seen.kuadra.add(p.name);
                kuadra.push({ nome: p.name, premio: PHASES ? PHASES.kuadra.reward / 1000 : 2 });
            }
            if (card.awards && card.awards.kina && !seen.kina.has(p.name)) {
                seen.kina.add(p.name);
                kina.push({ nome: p.name, premio: PHASES ? PHASES.kina.reward / 1000 : 3.5 });
            }
            if (card.awards && card.awards.keno && !seen.keno.has(p.name)) {
                seen.keno.add(p.name);
                const jackpotExtra = drawnBalls.length <= JACKPOT_BALL_LIMIT ? JACKPOT_REWARD : 0;
                keno.push({ nome: p.name, premio: PHASES ? (PHASES.keno.reward + jackpotExtra) / 1000 : 5 });
            }
        });
    });

    // Divide prize among winners of same phase
    if (kuadra.length > 1) kuadra.forEach(w => w.premio /= kuadra.length);
    if (kina.length > 1) kina.forEach(w => w.premio /= kina.length);
    if (keno.length > 1) keno.forEach(w => w.premio /= keno.length);

    if (!kuadra.length && !kina.length && !keno.length) return;

    const rankingHTML = `
    <div class="keno-ranking-overlay" id="kenoRankingOverlay">
        <div class="keno-ranking-content">
            <div class="keno-ranking-header">🏆 RANKING FINAL 🏆</div>
            <div class="keno-ranking-round">Rodada #${currentRound || '---'}</div>
            ${kuadra.length ? `<div class="ranking-section">
                <div class="ranking-section-title kuadra-title">◆ KUADRA ◆</div>
                ${kuadra.map(w => `<div class="ranking-winner"><span class="rank-pos">◆</span> ${w.nome} <span class="rank-prize">R$ ${w.premio.toFixed(2).replace('.', ',')}</span></div>`).join('')}
            </div>` : ''}
            ${kina.length ? `<div class="ranking-section">
                <div class="ranking-section-title kina-title">⭐ KINA ⭐</div>
                ${kina.map(w => `<div class="ranking-winner"><span class="rank-pos">⭐</span> ${w.nome} <span class="rank-prize">R$ ${w.premio.toFixed(2).replace('.', ',')}</span></div>`).join('')}
            </div>` : ''}
            ${keno.length ? `<div class="ranking-section">
                <div class="ranking-section-title keno-title">🎯 KENO 🎯</div>
                ${keno.map(w => `<div class="ranking-winner"><span class="rank-pos">🎯</span> ${w.nome} <span class="rank-prize">R$ ${w.premio.toFixed(2).replace('.', ',')}</span></div>`).join('')}
            </div>` : ''}
            <button class="ranking-close-btn" onclick="fecharKenoRanking()">Fechar</button>
        </div>
    </div>`;

    const existing = document.getElementById('kenoRankingOverlay');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.innerHTML = rankingHTML;
    document.body.appendChild(div.firstElementChild);
    requestAnimationFrame(() => {
        const el = document.getElementById('kenoRankingOverlay');
        if (el) el.classList.add('visible');
    });

    // Auto-fechar ranking em 5 segundos
    setTimeout(fecharKenoRanking, 5000);
}
function fecharKenoRanking() {
    const el = document.getElementById('kenoRankingOverlay');
    if (el) { el.classList.remove('visible'); setTimeout(() => el.remove(), 500); }
}

// Integrar missing numbers nos renders existentes
const _origRenderMyCards2 = renderMyCards;
renderMyCards = function() {
    _origRenderMyCards2();
    renderMissingNumbersPanel();
};

// ==================== AUTO-START ====================
const AUTO_START_INTERVAL = 150000; // 2 minutos e 30 segundos
let bloquearAutoStart = false; // impede auto-start durante o intervalo pós-rodada
let autoStartTimer = null;
let autoStartCountdown = null;
let autoStartSeconds = 0;

function iniciarAutoStart() {
    pararAutoStart();
    if (!isHost || gameActive || bloquearAutoStart) return;
    autoStartSeconds = AUTO_START_INTERVAL / 1000;
    atualizarAutoStartDisplay();
    autoStartTimer = setInterval(() => {
        autoStartSeconds--;
        atualizarAutoStartDisplay();
        if (autoStartSeconds <= 0) {
            pararAutoStart();
            if (isHost && !gameActive) {
                resetGame();
                setTimeout(startBingoDraw, 500);
            }
        }
    }, 1000);
}

function pararAutoStart() {
    if (autoStartTimer) {
        clearInterval(autoStartTimer);
        autoStartTimer = null;
    }
    const el = document.getElementById('autoStartTimer');
    if (el) el.textContent = '--:--';
    const overlay = document.getElementById('countdownOverlay');
    if (overlay) overlay.classList.remove('visible');
}

function atualizarAutoStartDisplay() {
    const el = document.getElementById('autoStartTimer');
    if (!el) return;
    if (autoStartSeconds <= 0) {
        el.textContent = '0:00';
        return;
    }
    const min = Math.floor(autoStartSeconds / 60);
    const seg = autoStartSeconds % 60;
    const text = `${min}:${seg.toString().padStart(2, '0')}`;
    el.textContent = text;
    const overlayTimer = document.getElementById('countdownTimer');
    if (overlayTimer) overlayTimer.textContent = text;
}

// Integrar auto-start no salvarHistoricoRodada
const _origSalvarHistorico = salvarHistoricoRodada;
salvarHistoricoRodada = function() {
    _origSalvarHistorico();
    if (isHost) {
        pararAutoStart();
        setTimeout(iniciarAutoStart, 3000);
    }
};

// ==================== PERSISTÊNCIA DO JOGO (RESTAURAR APÓS REFRESH/FECHAR) ====================
const GAME_STATE_KEY = 'bingo_estado_jogo_v1';
let estadoSaveInterval = null;

function salvarEstadoJogo() {
    if (!isHost) return;
    const gameScreen = document.getElementById('screenGame');
    if (!gameScreen || !gameScreen.classList.contains('active')) return;
    try {
        const snap = {
            drawnBalls,
            currentPhaseIndex,
            gameActive,
            gameEnded,
            currentRound,
            allPlayers,
            myCards,
            myChips,
            myWinnings,
            lastDrawnBall,
            JACKPOT_REWARD,
            latestCloseCards,
            ts: Date.now()
        };
        localStorage.setItem(GAME_STATE_KEY, JSON.stringify(snap));
    } catch (e) {
        console.warn('Falha ao salvar estado do jogo', e);
    }
}

function carregarEstadoJogo() {
    try {
        const raw = localStorage.getItem(GAME_STATE_KEY);
        if (!raw) return false;
        const snap = JSON.parse(raw);
        drawnBalls = snap.drawnBalls || [];
        currentPhaseIndex = snap.currentPhaseIndex || 0;
        gameActive = !!snap.gameActive;
        gameEnded = !!snap.gameEnded;
        currentRound = snap.currentRound || getRoundNumber();
        if (snap.allPlayers) allPlayers = snap.allPlayers;
        if (snap.myCards) myCards = snap.myCards;
        if (typeof snap.myChips === 'number') myChips = snap.myChips;
        if (typeof snap.myWinnings === 'number') myWinnings = snap.myWinnings;
        lastDrawnBall = snap.lastDrawnBall || null;
        if (typeof snap.JACKPOT_REWARD === 'number') JACKPOT_REWARD = snap.JACKPOT_REWARD;
        if (snap.latestCloseCards) latestCloseCards = snap.latestCloseCards;
        return true;
    } catch (e) {
        return false;
    }
}

function renderizarTabuleiroRestaurado() {
    applyBoardReset();
    const list = document.getElementById('drawnList');
    const mainDisplay = document.getElementById('mainBall');
    drawnBalls.forEach(b => {
        if (list) {
            const item = document.createElement('div');
            item.className = 'drawn-num';
            item.textContent = b;
            list.appendChild(item);
        }
    });
    if (mainDisplay && drawnBalls.length) {
        mainDisplay.textContent = drawnBalls[drawnBalls.length - 1];
    }
    if (typeof renderMyCards === 'function') renderMyCards();
}

function restaurarEstadoHost() {
    initDrawnGrid();
    syncDrawnGrid();
    const tem = carregarEstadoJogo();

    if (!allPlayers.find(p => p.id === 'host')) {
        allPlayers.unshift({ id: 'host', name: myName, chips: myChips, winnings: myWinnings || 0, cards: myCards || [], isHost: true });
    }

    if (!estadoSaveInterval) {
        estadoSaveInterval = setInterval(salvarEstadoJogo, 2000);
    }

    if (!tem) {
        iniciarAutoStart();
        return;
    }

    renderizarTabuleiroRestaurado();
    updatePlayerListUI();
    updatePhaseUI();
    updateJackpotPanel();
    if (typeof renderCloseCardsPanel === 'function') renderCloseCardsPanel();
    if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
    if (typeof renderMissingNumbersPanel === 'function') renderMissingNumbersPanel();

    const btnStart = document.getElementById('btnStartGame');
    if (btnStart) btnStart.disabled = gameActive;
    const btnUndo = document.getElementById('btnUndo');
    if (btnUndo) btnUndo.disabled = drawnBalls.length === 0;

    sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex, gameActive, gameEnded });

    if (gameActive) {
        if (typeof setRestartButtonState === 'function') setRestartButtonState(false);
        scheduleNextDraw();
    } else {
        if (gameEnded) {
            drawnBalls = [];
            currentPhaseIndex = 0;
            gameEnded = false;
            renderizarTabuleiroRestaurado();
        }
        iniciarAutoStart();
    }
}

// ==================== PIX - DEPOSITO ====================
let pixPolling = null;

function abrirModalDeposito() {
    document.getElementById('pixQrArea').style.display = 'none';
    document.getElementById('pixStatus').textContent = '';
    document.getElementById('pixLoader').style.display = 'none';
    document.getElementById('pixValor').value = 10;
    document.getElementById('modalPix').style.display = 'flex';
}

function fecharModal(id) {
    if (pixPolling) {
        clearInterval(pixPolling);
        pixPolling = null;
    }
    document.getElementById(id).style.display = 'none';
}

async function gerarPix() {
    const valor = parseFloat(document.getElementById('pixValor').value);
    if (!valor || valor < 0.50) {
        showToast('Valor mínimo: R$0,50', 'warning', 4000);
        return;
    }

    const btn = document.querySelector('#pixQrArea').previousElementSibling.querySelector('button');
    if (btn) btn.disabled = true;

    document.getElementById('pixStatus').textContent = 'Gerando QR Code...';
    document.getElementById('pixLoader').style.display = 'block';

    try {
        // ✅ CÓDIGO CORRIGIDO:
const res = await fetch(API_BASE + '/api/criar-pix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        valor, 
        nome: myName, 
        cpf: meuCpf, 
        email: meuEmail // 👈 Mudamos aqui para enviar o e-mail de verdade!
    })
});

        if (!res.ok) {
            const err = await res.json();
            showToast('Erro: ' + (err.error || 'Falha ao gerar PIX'), 'error', 5000);
            if (btn) btn.disabled = false;
            document.getElementById('pixLoader').style.display = 'none';
            return;
        }

        const data = await res.json();
        console.log('Resposta do servidor:', data);

        const pixCode = data.copyPaste || data.qrCode || '';
        console.log('PIX code length:', pixCode.length, 'PIX code:', pixCode.slice(0, 60) + '...');

        const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(pixCode);
        console.log('QR URL:', qrUrl.slice(0, 100) + '...');

        const img = document.getElementById('pixQrCode');
        img.src = qrUrl;
        img.onload = function() { console.log('QR Code loaded successfully'); };
        img.onerror = function() {
            console.error('QR Code image failed to load');
            img.alt = 'QR Code indisponivel';
            img.style.display = 'none';
            document.getElementById('pixStatus').textContent = '⚠️ Erro ao carregar QR Code. Copie o codigo PIX manualmente.';
        };

        document.getElementById('pixCopyText').value = pixCode;
        document.getElementById('pixQrArea').style.display = 'block';
        document.getElementById('pixLoader').style.display = 'none';
        if (btn) btn.disabled = false;

        console.log('modoSimulado:', data.modoSimulado);
        if (data.modoSimulado) {
            let segundos = 15;
            document.getElementById('pixStatus').textContent = `🧪 MODO SIMULADO - Confirmando em ${segundos}s...`;
            document.getElementById('pixStatus').style.color = '#f59e0b';

            const countdown = setInterval(() => {
                segundos--;
                if (segundos > 0) {
                    document.getElementById('pixStatus').textContent = `🧪 MODO SIMULADO - Confirmando em ${segundos}s...`;
                } else {
                    clearInterval(countdown);
                    confirmarRecargaSimulada(data);
                }
            }, 1000);
        } else {
            document.getElementById('pixStatus').textContent = 'Aguardando pagamento...';
            document.getElementById('pixStatus').style.color = '#fbbf24';

            if (pixPolling) clearInterval(pixPolling);
            pixPolling = setInterval(async () => {
                try {
                    const statusRes = await fetch(API_BASE + '/api/status-pix/' + data.paymentId);
                    const statusData = await statusRes.json();
                    if (statusData.status === 'approved') {
                        clearInterval(pixPolling);
                        pixPolling = null;
                        await processarConfirmacaoPix(statusData, data.paymentId);
                    }
                } catch (e) {}
            }, 3000);
        }

        // Timeout de 5 minutos
        setTimeout(() => {
            if (pixPolling) {
                clearInterval(pixPolling);
                pixPolling = null;
                document.getElementById('pixStatus').textContent = '⏰ Tempo expirado. Gere um novo QR Code.';
            }
        }, 300000);

    } catch (err) {
        showToast('Erro de conexão com o servidor.', 'error', 5000);
        if (btn) btn.disabled = false;
        document.getElementById('pixLoader').style.display = 'none';
    }
}

function copiarPix() {
    const input = document.getElementById('pixCopyText');
    input.select();
    document.execCommand('copy');
    showToast('Código PIX copiado!', 'success', 3000);
}

async function confirmarRecargaSimulada(data) {
    document.getElementById('pixStatus').textContent = '✅ Pagamento confirmado!';
    document.getElementById('pixStatus').style.color = '#10b981';
    document.getElementById('pixLoader').style.display = 'none'; // 👈 Faltava fechar aqui
    
    // Opcional: Adicione aqui a chamada para atualizar o saldo do jogador localmente
    if (data && data.valor) {
        showToast(`Recarga simulada de R$ ${data.valor} com sucesso!`, 'success');
    }
}

    // Chamar servidor para adicionar fichas + bonus (se primeiro depósito)
    async function confirmarRecargaSimulada(data) {
    const serverRes = await fetch(API_BASE + '/api/confirmar-recarga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: myName, valor: data.valor, paymentId: data.paymentId })
    }).catch(() => null);

    let fichasAdicionadas = Math.round(data.valor * 1000);
    let bonusConcedido = 0;
    let primeiroDeposito = false;

    if (serverRes && serverRes.ok) {
        const serverData = await serverRes.json();
        fichasAdicionadas = serverData.fichas || fichasAdicionadas;
        bonusConcedido = serverData.bonusConcedido || 0;
        primeiroDeposito = serverData.primeiroDeposito || false;
    }

    myChips += fichasAdicionadas;
    saveChips(myName, myChips);
    updateChipsDisplay();

    if (isHost) {
        const hostPlayer = allPlayers.find(p => p.id === 'host');
        if (hostPlayer) hostPlayer.chips = myChips;
        sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
    } else {
        sendToHost({ type: 'recargaFeita', nome: myName, fichas: fichasAdicionadas });
    }

    const baseFichas = Math.round(data.valor * 1000);
    const msg = primeiroDeposito && bonusConcedido > 0
        ? `💰 Depósito confirmado! + ${fichasAdicionadas.toLocaleString('pt-BR')} fichas (🎁 Bônus 1º deps: +${bonusConcedido.toLocaleString('pt-BR')})`
        : `💰 Depósito de ${fichasAdicionadas.toLocaleString('pt-BR')} fichas confirmado!`;
    showToast(msg, 'success', 7000);
    setTimeout(() => fecharModal('modalPix'), 2000);
}

async function processarConfirmacaoPix(statusData, paymentId) {
    document.getElementById('pixStatus').textContent = '✅ Pagamento confirmado!';
    document.getElementById('pixStatus').style.color = '#10b981';
    document.getElementById('pixLoader').style.display = 'none';

    // Chamar servidor para adicionar fichas + bonus (se primeiro depósito)
    const serverRes = await fetch(API_BASE + '/api/confirmar-recarga', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: myName, valor: statusData.valor, paymentId })
    }).catch(() => null);

    let fichasAdicionadas = statusData.fichas || Math.round(statusData.valor * 1000);
    let bonusConcedido = 0;
    let primeiroDeposito = false;

    if (serverRes && serverRes.ok) {
        const serverData = await serverRes.json();
        fichasAdicionadas = serverData.fichas || fichasAdicionadas;
        bonusConcedido = serverData.bonusConcedido || 0;
        primeiroDeposito = serverData.primeiroDeposito || false;
    }

    myChips += fichasAdicionadas;
    saveChips(myName, myChips);
    updateChipsDisplay();

    if (isHost) {
        const hostPlayer = allPlayers.find(p => p.id === 'host');
        if (hostPlayer) hostPlayer.chips = myChips;
        sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
    } else {
        sendToHost({ type: 'recargaFeita', nome: myName, fichas: fichasAdicionadas });
    }

    const baseFichas = Math.round(statusData.valor * 1000);
    const msg = primeiroDeposito && bonusConcedido > 0
        ? `💰 Depósito confirmado! + ${fichasAdicionadas.toLocaleString('pt-BR')} fichas (🎁 Bônus 1º deps: +${bonusConcedido.toLocaleString('pt-BR')})`
        : `💰 Depósito de ${fichasAdicionadas.toLocaleString('pt-BR')} fichas confirmado!`;
    showToast(msg, 'success', 7000);
    setTimeout(() => fecharModal('modalPix'), 2000);
}

async function verificarRecargas() {
    try {
        const res = await fetch(API_BASE + '/api/recargas-pendentes/' + encodeURIComponent(myName));
        const recargas = await res.json();
        for (const r of recargas) {
            // Chamar servidor para adicionar fichas + bonus (se primeiro depósito)
            const serverRes = await fetch(API_BASE + '/api/confirmar-recarga', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: myName, valor: r.valor || (r.fichas / 1000), paymentId: r.paymentId })
            }).catch(() => null);

            let fichasAdicionadas = r.fichas;
            let bonusConcedido = 0;
            let primeiroDeposito = false;

            if (serverRes && serverRes.ok) {
                const serverData = await serverRes.json();
                fichasAdicionadas = serverData.fichas || fichasAdicionadas;
                bonusConcedido = serverData.bonusConcedido || 0;
                primeiroDeposito = serverData.primeiroDeposito || false;
            }

            myChips += fichasAdicionadas;
            saveChips(myName, myChips);
            updateChipsDisplay();

            if (isHost) {
                const hostPlayer = allPlayers.find(p => p.id === 'host');
                if (hostPlayer) hostPlayer.chips = myChips;
                sendToGuest({ type: 'gameState', players: allPlayers, drawnBalls, currentPhaseIndex });
            } else {
                sendToHost({ type: 'adminUpdateChips', players: allPlayers });
            }

            await fetch(API_BASE + '/api/sincronizar-recarga', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId: r.paymentId })
            });

            const msg = primeiroDeposito && bonusConcedido > 0
                ? `💰 Depósito verificado: +${fichasAdicionadas.toLocaleString('pt-BR')} fichas (🎁 Bônus 1º deps: +${bonusConcedido.toLocaleString('pt-BR')})`
                : `💰 Depósito de ${fichasAdicionadas.toLocaleString('pt-BR')} fichas confirmado!`;
            showToast(msg, 'success', 7000);
        }
    } catch (e) {
        console.warn('Erro ao verificar recargas:', e);
    }
}

// ==================== SAQUE ====================
function abrirModalSaque() {
    fetch(API_BASE + '/api/admin/modo-teste')
        .then(r => r.json())
        .then(d => {
            modoTesteSaque = !!(d && d.ligado);
        })
        .catch(() => {})
        .finally(() => {
            let saldoSacavel = myWinnings;
            let nota = '';
            const regraEl = document.getElementById('saqueRegra');
            if (modoTesteSaque) {
                saldoSacavel = myAdminCredits;
                nota = ' 🧪 MODO TESTE: apenas créditos admin disponíveis para saque';
                if (regraEl) regraEl.innerHTML = '<strong>Créditos Admin</strong> podem ser sacados (Modo Teste).';
            } else {
                nota = ' (apenas ganhos em jogos - Kuadra/Kina/Keno)';
                if (regraEl) regraEl.innerHTML = 'Apenas <strong>Ganhos em Jogo (Kuadra, Kina, Keno)</strong> podem ser sacados.';
            }
            document.getElementById('saqueSaldo').textContent = 'R$ ' + (saldoSacavel / 1000).toFixed(2).replace('.', ',') + nota;
            document.getElementById('saqueValor').value = 10;
            const msgEl = document.getElementById('saqueMsg');
            if (saldoSacavel < 10000) {
                msgEl.innerHTML = '<p class="saque-erro" style="color:#ef4444;font-size:0.85em">⚠️ Saldo sacável insuficiente. Saldo sacável: R$ ' + (saldoSacavel / 1000).toFixed(2).replace('.', ',') + '</p>';
            } else {
                msgEl.innerHTML = '';
            }
            document.getElementById('modalSaque').style.display = 'flex';
        });
}

async function solicitarSaque() {
    const valor = parseFloat(document.getElementById('saqueValor').value);
    const chavePix = document.getElementById('saqueChave').value.trim();
    const tipoChave = document.getElementById('saqueTipoChave').value;

    if (!valor || valor < 10) {
        showToast('Valor mínimo para saque: R$ 10,00. Somente valores ganhos podem ser sacados.', 'warning', 5000);
        return;
    }

    const fichasNecessarias = valor * 1000;
    const saldoDisponivel = modoTesteSaque ? myAdminCredits : myWinnings;
    if (saldoDisponivel < fichasNecessarias) {
        const msgEl = document.getElementById('saqueMsg');
        if (msgEl) msgEl.innerHTML = '<p class="saque-erro" style="color:#ef4444;font-size:0.9em">⚠️ Saldo sacável insuficiente. Saldo sacável: R$ ' + (saldoDisponivel / 1000).toFixed(2).replace('.', ',') + '</p>';
        showToast('Saldo sacável insuficiente. Saldo sacável: R$ ' + (saldoDisponivel / 1000).toFixed(2).replace('.', ','), 'warning', 5000);
        return;
    }

    if (!chavePix) {
        showToast('Digite sua chave PIX', 'info', 4000);
        return;
    }

    const btn = document.querySelector('#modalSaque .btn-success');
    if (btn) btn.disabled = true;

    try {
        const payload = { nome: myName, valor, chavePix, tipoChave, sessionToken: minhaSessaoToken };
        console.log('[SAQUE FRONTEND] Enviando:', payload);
        const res = await fetch(API_BASE + '/api/solicitar-saque', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('[SAQUE FRONTEND] Response status:', res.status);
        const data = await res.json();
        console.log('[SAQUE FRONTEND] Response data:', data);

        if (data.success) {
            if (modoTesteSaque) {
                myAdminCredits -= fichasNecessarias;
            } else {
                myWinnings -= fichasNecessarias;
            }
            myChips = Math.max(0, myChips - fichasNecessarias);
            saveWinnings();
            if (typeof saveAdminCredits === 'function') saveAdminCredits();
            if (typeof saveChips === 'function') saveChips(myName, myChips);
            if (typeof updateChipsDisplay === 'function') updateChipsDisplay();
            document.getElementById('saqueMsg').innerHTML = '<p class="saque-sucesso">✅ Solicitação enviada! O administrador processará em breve.</p>';
            const saldoRestante = modoTesteSaque ? myAdminCredits : myWinnings;
            document.getElementById('saqueSaldo').textContent = 'R$ ' + (saldoRestante / 1000).toFixed(2).replace('.', ',');

            // Notifica host se for guest
            if (!isHost) {
                sendToHost({ type: 'saqueSolicitado', nome: myName, valor, chavePix });
            }
        } else {
            document.getElementById('saqueMsg').innerHTML = '<p class="saque-erro">❌ ' + (data.error || 'Erro ao solicitar saque') + '</p>';
        }
    } catch (err) {
        document.getElementById('saqueMsg').innerHTML = '<p class="saque-erro">❌ Erro de conexão com o servidor.</p>';
    }

    if (btn) btn.disabled = false;
}

// Mostra o botão de saque para todos os jogadores logados
function atualizarBotaoSaque() {
    const btn = document.getElementById('btnSacar');
    if (btn && myName) {
        btn.style.display = 'inline-block';
    }
}

// Patch updateChipsDisplay para também atualizar botão de saque
const _origUpdateChipsDisplay = updateChipsDisplay;
updateChipsDisplay = function() {
    _origUpdateChipsDisplay();
    atualizarBotaoSaque();
};

// Verifica recargas ao entrar na tela de jogo
const _origGoToScreen = goToScreen;
goToScreen = function(screenId) {
    _origGoToScreen(screenId);
    const overlay = document.getElementById('countdownOverlay');
    if (screenId === 'screenAdmin') {
        document.body.classList.add('admin-mode');
        if (overlay) overlay.classList.remove('visible');
        pararAutoStart();
    } else if (screenId === 'screenGame') {
        document.body.classList.remove('admin-mode');
        initDrawnGrid();
        syncDrawnGrid();
        setTimeout(verificarRecargas, 1000);
        if (isHost && !gameActive && !gameEnded) {
            setTimeout(iniciarAutoStart, 2000);
        }
    } else {
        document.body.classList.remove('admin-mode');
        pararAutoStart();
    }
};

// ==================== LOGOUT ====================
function sairDaConta() {
    if (!confirm('Tem certeza que deseja sair da sua conta?')) return;

    localStorage.removeItem('bingo_session_token');
    localStorage.removeItem('bingo_meu_cpf');
    localStorage.removeItem('bingo_last_name');
    minhaSessaoToken = '';
    meuCpf = '';
    myName = '';
    myChips = 0;
    myCards = [];
    myWinnings = 0;
    allPlayers = [];
    drawnBalls = [];
    currentPhaseIndex = 0;
    gameActive = false;
    gameEnded = false;
    isHost = false;
    myRole = '';
    myRoomId = '';
    myId = '';
    souDono = false;
    pendingConnect = null;
    isReady = false;
    readyPlayers = {};
    latestCloseCards = {};

    if (socket) {
        try { socket.close(1000, 'Logout'); } catch (e) {}
        socket = null;
        socketReady = false;
    }
    cancelReconnect();
    cancelJoinRetry();
    stopHeartbeat();
    releaseWakeLock();
    hideSpinner();
    showOfflineBanner(false);

    const loginCpf = document.getElementById('loginCpf');
    const loginSenha = document.getElementById('loginSenha');
    if (loginCpf) loginCpf.value = '';
    if (loginSenha) loginSenha.value = '';
    document.getElementById('loginError').textContent = '';

    mostrarAba('login');
    goToScreen('screenHome');
    showToast('Você saiu da sua conta.', 'info');
}
