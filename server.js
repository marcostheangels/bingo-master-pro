require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const engine = require('./engine');
const db = require('./db');

const DONO_CPF = '05893761600';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'marcostheangels@gmail.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ===================== CONFIGURAÇÃO DE EMAIL (RESEND API HTTP) =====================
async function enviarEmailNotificacao(assunto, texto) {
    if (!RESEND_API_KEY) {
        console.log('[EMAIL] AVISO: RESEND_API_KEY não definida no painel do Render. Pulando envio:', assunto);
        return;
    }
    console.log('[EMAIL] Tentando enviar via Resend API (HTTP):', assunto);
    try {
        const htmlTexto = texto.replace(/\n/g, '<br>');
        
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'Bingo Master Pro <onboarding@resend.dev>',
                to: [ADMIN_EMAIL],
                subject: assunto,
                html: `<div style="font-family: sans-serif; line-height: 1.6; color: #2c3e50;">${htmlTexto}</div>`
            })
        });

        const data = await response.json();
        if (response.ok) {
            console.log('[EMAIL] Notificação enviada com sucesso via Resend HTTP! ID:', data.id);
        } else {
            console.error('[EMAIL] Erro retornado pela API do Resend:', data);
        }
    } catch (err) {
        console.error('[EMAIL] Erro de conexão ao tentar chamar a API do Resend:', err.message);
    }
}

const PORT = process.env.PORT || 3000;

// ===================== EXPRESS =====================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===================== USUARIOS =====================
function carregarUsuarios() {
    return db.getUsuarios();
}
function salvarUsuarios(lista) {
    db.setUsuarios(lista);
}

// Sessoes ativas: cpf -> { ws, sessionToken, nome }
const sessoesAtivas = new Map();

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

function formatarCPF(cpf) {
    const n = cpf.replace(/\D/g, '');
    return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

// ===================== WEBSOCKET =====================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===================== JOGO AUTORITATIVO (SERVIDOR) =====================
const DEFAULT_ROOM = 'bingo-master-pro-marcos';
const DRAW_SPEED = 3000;
const AUTO_START_INTERVAL = 150;

let fichasStore = {};
function loadFichas() {
    return db.getFichasStore();
}
function saveFichas() {
    db.syncFichasStore();
}
function getChips(nome) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    // Busca exata
    for (const k of Object.keys(fichasStore)) {
        if (k.normalize('NFC') === key) return fichasStore[k];
    }
    // Busca por prefixo
    for (const k of Object.keys(fichasStore)) {
        if (k.normalize('NFC').startsWith(key)) return fichasStore[k];
    }
    return { chips: engine.INITIAL_CHIPS, winnings: 0 };
}
function setChips(nome, chips, winnings) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    let targetKey = key;
    for (const k of Object.keys(fichasStore)) {
        if (k.normalize('NFC').startsWith(key) || key.startsWith(k.normalize('NFC'))) {
            targetKey = k;
            break;
        }
    }
    fichasStore[targetKey] = { chips: Math.max(0, Math.round(chips)), winnings: Math.round(winnings || 0) };
    saveFichas();
}

const gameRooms = new Map();

function getRoom(roomId) {
    if (!gameRooms.has(roomId)) {
        const room = {
            id: roomId,
            players: new Map(),
            clients: new Map(),
            drawnBalls: [],
            currentPhaseIndex: 0,
            gameActive: false,
            gameEnded: false,
            currentRound: 0,
            jackpot: engine.JACKPOT_REWARD,
            autoStartSeconds: 0,
            autoStartTimer: null,
            drawTimer: null,
            phasePauseTimer: null,
            log: []
        };
        loadRoomSnapshot(room);
        gameRooms.set(roomId, room);
    }
    return gameRooms.get(roomId);
}

function sanitizePlayers(room) {
    // Remove bankrupt bots from the system, hide zero-balance humans
    const toDelete = [];
    const visible = Array.from(room.players.values()).filter(p => {
        if (p.isBot && p.chips <= 0) {
            toDelete.push(p.id);
            return false;
        }
        if (!p.isBot && p.chips <= 0 && (!p.cards || p.cards.length === 0)) {
            return false; // hide from list but keep in system
        }
        return true;
    });
    toDelete.forEach(id => room.players.delete(id));
    return visible.map(p => ({
        id: p.id, name: p.name, chips: p.chips, winnings: p.winnings, cards: p.cards, isBot: !!p.isBot,
        adminCredits: p.adminCredits || 0
    }));
}

function broadcastSpectatorCount(room) {
    let count = 0;
    room.clients.forEach(ws => {
        if (ws.role === 'spectator') count++;
    });
    broadcast(room, { type: 'updateSpectators', count });
}

function broadcast(room, message) {
    const payload = { type: 'relay', from: 'host', id: 'server', name: 'Servidor', data: message };
    const data = JSON.stringify(payload);
    room.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
}

function sendGameState(room, ws) {
    const msg = {
        type: 'gameState',
        players: sanitizePlayers(room),
        drawnBalls: room.drawnBalls,
        currentPhaseIndex: room.currentPhaseIndex,
        gameActive: room.gameActive,
        gameEnded: room.gameEnded,
        currentRound: room.currentRound,
        jackpot: room.jackpot,
        autoStartSeconds: room.autoStartSeconds,
        totalCardsAtStart: room.totalCardsAtStart || 0
    };
    broadcast(room, msg);
}

// ===================== SERVER-SIDE GAME LOOP =====================
function addHistorico(room, msg) {
    room.log.push(msg);
    if (room.log.length > 50) room.log.shift();
}

function addLog(room, msg) {
    addHistorico(room, msg);
    broadcast(room, { type: 'notice', text: msg });
}

function iniciarAutoStartServer(room) {
    pararAutoStartServer(room);
    if (room.gameActive || room.gameEnded) return;
    broadcast(room, { type: 'preparingNewRound', seconds: 50 });
    addLog(room, '⏳ Novo sorteio em 50 segundos. Compre suas cartelas!');
    room.autoStartSeconds = 50;
    console.log(`[AUTOSTART] Iniciando contagem de ${room.autoStartSeconds}s para sala ${room.id}`);
    room.autoStartTimer = setInterval(() => {
        room.autoStartSeconds--;
        broadcast(room, { type: 'autoStart', seconds: room.autoStartSeconds });
        if (room.autoStartSeconds <= 0) {
            pararAutoStartServer(room);
            iniciarNovaRodada(room);
        }
    }, 1000);
}

function pararAutoStartServer(room) {
    if (room.autoStartTimer) {
        clearInterval(room.autoStartTimer);
        room.autoStartTimer = null;
    }
}

function iniciarNovaRodada(room) {
    if (room.gameActive) return;
    room.currentRound++;
    room.drawnBalls = [];
    room.currentPhaseIndex = 0;
    room.gameActive = true;
    room.gameEnded = false;
    
    // Give bots cards, reset awards
    room.players.forEach(p => {
        if (p.isBot) {
            const maxCards = engine.BOT_MAX_CARDS; // 15
            const qtd = Math.floor(Math.random() * maxCards) + 1; // 1 a 15
            p.cards = [];
            for (let i = 0; i < qtd; i++) {
                p.cards.push(engine.generateBingoCardData());
            }
            p.chips = Math.max(0, p.chips - p.cards.length * engine.CARD_COST);
        }
        (p.cards || []).forEach(card => {
            card.awards = { kuadra: false, kina: false, keno: false };
        });
    });
    
    const initialCards = Array.from(room.players.values()).reduce((sum, p) => sum + (p.cards ? p.cards.length : 0), 0);
    room.totalCardsAtStart = initialCards;
    room.jackpot = engine.JACKPOT_REWARD;
    
    saveRoomSnapshot(room);
    sendGameState(room);
    addLog(room, `🎯 Rodada #${room.currentRound} iniciada!`);
    broadcast(room, { type: 'notice', text: '🎯 Nova rodada iniciada!', kind: 'success' });
    const playersArr2 = Array.from(room.players.values());
    const closeInfo = engine.computeCloseCardsForAllPlayers(playersArr2, room.currentPhaseIndex, room.drawnBalls);
    broadcast(room, { type: 'closeCards', data: closeInfo });
    agendarProximoDraw(room);
}

const DRAW_SPEED_MS = 3000;

function agendarProximoDraw(room, delay) {
    if (room.drawTimer) clearTimeout(room.drawTimer);
    room.drawTimer = setTimeout(() => sortearProximaBola(room), delay || DRAW_SPEED_MS);
}

function sortearProximaBola(room) {
    room.drawTimer = null;
    
    if (room.drawnBalls.length >= 90) {
        finalizarRodada(room);
        return;
    }
    
    // Se a fase atual já foi ganha por alguém, não sortear mais bolas nesta fase
    const phaseKey = engine.PHASE_SEQUENCE[room.currentPhaseIndex];
    let jaTemVencedor = false;
    room.players.forEach(p => {
        (p.cards || []).forEach(c => {
            if (c.awards && c.awards[phaseKey]) jaTemVencedor = true;
        });
    });
    if (jaTemVencedor) {
        room.phasePauseTimer = setTimeout(() => {
            room.phasePauseTimer = null;
            avancarParaProximaFase(room);
        }, 3000);
        return;
    }
    
    let ball;
    do { ball = Math.floor(Math.random() * 90) + 1; } while (room.drawnBalls.includes(ball));
    room.drawnBalls.push(ball);
    
    broadcast(room, { type: 'syncBall', ball, drawnBalls: [...room.drawnBalls] });
    
    // Broadcast close cards status
    const playersArr = Array.from(room.players.values());
    const closeInfo = engine.computeCloseCardsForAllPlayers(playersArr, room.currentPhaseIndex, room.drawnBalls);
    broadcast(room, { type: 'closeCards', data: closeInfo });
    
    // Check winners
    const winners = engine.checkAwardsForAllPlayers(playersArr, room.currentPhaseIndex, room.drawnBalls);
    
    if (winners.length > 0) {
        const phaseKey = engine.PHASE_SEQUENCE[room.currentPhaseIndex];
        const totalCards = Array.from(room.players.values()).reduce((sum, p) => sum + (p.cards ? p.cards.length : 0), 0);
        const { results, isJackpot } = engine.processPhaseWinners(winners, phaseKey, room.drawnBalls, totalCards);
        
        // Update persistent chips/winnings
        results.forEach(r => {
            const player = r.player;
            if (!player.isBot) {
                setChips(player.name, player.chips, player.winnings);
            }
            // Register prize transaction
            const transacoes = db.getTransacoes();
            transacoes.push({
                tipo: 'premio', nome: player.name, nomeExibicao: player.name, valor: r.totalReward / 1000,
                data: new Date().toISOString(), detalhe: `Prêmio ${phaseKey}`
            });
            db.setTransacoes(transacoes);
        });
        
        const phaseLabel = engine.PHASES[phaseKey].label;
        results.forEach(r => {
            const jt = r.jackpotCount ? ` + Jackpot ${r.jackpotCount}x!` : '';
            addLog(room, `${r.player.name} ganhou ${(r.totalReward / 1000).toFixed(2)} fichas em ${phaseLabel}.${jt}`);
        });
        
        // Build winning card data for each winner
        const resultsWithCards = results.map(r => {
            const winnerEntry = winners.find(w => w.player === r.player);
            let cardData = null;
            if (winnerEntry && winnerEntry.player.cards[winnerEntry.cardIndex]) {
                const card = winnerEntry.player.cards[winnerEntry.cardIndex];
                const lastBall = room.drawnBalls.length ? room.drawnBalls[room.drawnBalls.length - 1] : null;
                let winningRow = -1;
                let winningNum = null;
                if (phaseKey === 'kuadra' || phaseKey === 'kina') {
                    const target = phaseKey === 'kuadra' ? 4 : 5;
                    for (let row = 0; row < 3; row++) {
                        const rowMarks = card.numbers[row].reduce((c, v) => c + (v !== '' && room.drawnBalls.includes(Number(v)) ? 1 : 0), 0);
                        if (rowMarks >= target) { winningRow = row; break; }
                    }
                }
                if (phaseKey === 'keno') {
                    winningNum = lastBall;
                } else if (winningRow >= 0 && lastBall !== null) {
                    for (let col = 0; col < 9; col++) {
                        const v = card.numbers[winningRow][col];
                        if (v !== '' && Number(v) === lastBall) { winningNum = lastBall; break; }
                    }
                }
                cardData = {
                    numbers: card.numbers,
                    codigo: card.codigo || '',
                    winningRow,
                    winningNum,
                    phaseKey
                };
            }
            return {
                name: r.player.name,
                totalReward: r.totalReward,
                jackpotCount: r.jackpotCount,
                card: cardData
            };
        });
        // Broadcast winner event
        broadcast(room, {
            type: 'winnerEvent',
            phaseKey,
            results: resultsWithCards,
            winningBall: room.drawnBalls.length ? room.drawnBalls[room.drawnBalls.length - 1] : null
        });
        broadcast(room, { type: 'confetti' });
        
        if (isJackpot) {
            room.jackpot = engine.JACKPOT_REWARD;
            room.totalCardsAtStart = Array.from(room.players.values()).reduce((sum, p) => sum + (p.cards ? p.cards.length : 0), 0);
            broadcast(room, { type: 'jackpotUpdate', value: room.jackpot });
        }
        
        // Advance phase or end round
        if (room.currentPhaseIndex < engine.PHASE_SEQUENCE.length - 1) {
            avancarParaProximaFase(room);
        } else {
            // All phases done (keno finished) - end round
            finalizarRodada(room);
        }
        return;
    }
    
    sendGameState(room);
    agendarProximoDraw(room);
}

function avancarParaProximaFase(room) {
    room.currentPhaseIndex++;
    broadcast(room, { type: 'advancePhase', currentPhaseIndex: room.currentPhaseIndex });
    sendGameState(room);
    // Pausa antes de começar a sortear bolas da próxima fase
    room.phasePauseTimer = setTimeout(() => {
        room.phasePauseTimer = null;
        agendarProximoDraw(room);
    }, 8000);
}

function salvarHistoricoSorteio(room) {
    if (room.currentRound === 0) return;
    const vencedores = { kuadra: [], kina: [], keno: [] };
    room.players.forEach(player => {
        (player.cards || []).forEach(card => {
            if (card.awards.kuadra) vencedores.kuadra.push({ nome: player.name, premio: engine.PHASES.kuadra.reward });
            if (card.awards.kina) vencedores.kina.push({ nome: player.name, premio: engine.PHASES.kina.reward });
            if (card.awards.keno) {
                const jackpot = room.drawnBalls.length <= engine.JACKPOT_BALL_LIMIT ? room.jackpot : 0;
                vencedores.keno.push({ nome: player.name, premio: engine.PHASES.keno.reward + jackpot });
            }
        });
    });
    const dados = {
        numero: room.currentRound,
        data: new Date().toISOString(),
        bolasSorteadas: [...room.drawnBalls],
        totalBolas: room.drawnBalls.length,
        vencedores
    };
    const historico = db.getHistorico();
    historico.push(dados);
    db.setHistorico(historico);
    addLog(room, `📋 Sorteio #${room.currentRound} salvo no histórico.`);
}

function finalizarRodada(room) {
    room.gameActive = false;
    room.gameEnded = true;
    if (room.drawTimer) { clearTimeout(room.drawTimer); room.drawTimer = null; }
    if (room.phasePauseTimer) { clearTimeout(room.phasePauseTimer); room.phasePauseTimer = null; }
    
    salvarHistoricoSorteio(room);
    sendGameState(room);
    addLog(room, '🏁 Rodada encerrada!');
    broadcast(room, { type: 'notice', text: '🏁 Rodada encerrada! Cartelas serão limpas...', kind: 'info' });
    
    // After 10s, clear cards and restart auto-start
    setTimeout(() => {
        if (room.gameActive) return;
        // Clear all cards, refund humans
        room.players.forEach(p => {
            const qtd = p.cards ? p.cards.length : 0;
            if (!p.isBot && qtd > 0) {
                p.chips += qtd * engine.CARD_COST;
                setChips(p.name, p.chips, p.winnings);
            }
            p.cards = [];
        });
        room.drawnBalls = [];
        room.currentPhaseIndex = 0;
        room.gameEnded = false;
        cleanUpBots(room);
        broadcast(room, { type: 'resetGame', players: sanitizePlayers(room), drawnBalls: [], currentPhaseIndex: 0, gameActive: false, gameEnded: false, totalCardsAtStart: 0 });
        addLog(room, '🔄 Cartelas limpas. Novo sorteio em breve!');
        broadcast(room, { type: 'notice', text: '🔄 Compre suas cartelas! Novo sorteio em 2 minutos.', kind: 'info' });
        saveRoomSnapshot(room);
        // Auto-start after 30 seconds
        setTimeout(() => iniciarAutoStartServer(room), 30000);
    }, 10000);
}

function undoLastBall(room) {
    if (room.gameActive && room.drawnBalls.length > 0) {
        const removed = room.drawnBalls.pop();
        addLog(room, `↩ Bola ${removed} desfeita.`);
        // Reset awards for all cards
        room.players.forEach(p => {
            (p.cards || []).forEach(card => {
                card.awards = { kuadra: false, kina: false, keno: false };
            });
        });
        // Re-check all awards except the last ball
        const playersArr = Array.from(room.players.values());
        const tempBalls = [...room.drawnBalls];
        for (let i = 0; i < engine.PHASE_SEQUENCE.length; i++) {
            const w = engine.checkAwardsForAllPlayers(playersArr, i, tempBalls);
            w.forEach(({ player, cardIndex, phase }) => {
                const p = playersArr.find(p => p.id === player.id);
                if (p && p.cards[cardIndex]) p.cards[cardIndex].awards[phase] = true;
            });
        }
        broadcast(room, { type: 'undoBall', drawnBalls: [...room.drawnBalls] });
        sendGameState(room);
    }
}

function saveRoomSnapshot(room) {
    try {
        const snap = {
            id: room.id,
            drawnBalls: room.drawnBalls,
            currentPhaseIndex: room.currentPhaseIndex,
            gameActive: room.gameActive,
            gameEnded: room.gameEnded,
            currentRound: room.currentRound,
            jackpot: room.jackpot,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id, name: p.name, chips: p.chips, winnings: p.winnings, cards: p.cards, isBot: !!p.isBot
            }))
        };
        db.saveRoomState(room.id, snap);
    } catch (e) {}
}

function loadRoomSnapshot(room) {
    try {
        const snap = db.loadRoomState(room.id);
        if (!snap) return;
        room.drawnBalls = snap.drawnBalls || [];
        room.currentPhaseIndex = snap.currentPhaseIndex || 0;
        room.gameActive = false;
        room.gameEnded = false;
        room.currentRound = snap.currentRound || 0;
        room.jackpot = snap.jackpot || engine.JACKPOT_REWARD;
        if (Array.isArray(snap.players)) {
            snap.players.forEach(p => {
                room.players.set(p.id, {
                    id: p.id, name: p.name, chips: p.chips, winnings: p.winnings,
                    cards: p.cards || [], isBot: !!p.isBot, cpf: null,
                    adminCredits: p.adminCredits || 0
                });
            });
        }
    } catch (e) {}
}

function generateBotName() {
    const nomes = [
        'Gabriel Costa', 'Lucas Almeida', 'Amanda Silva', 'Beatriz Souza',
        'Rafael Oliveira', 'Juliana Santos', 'Matheus Lima', 'Camila Pereira',
        'Felipe Rodrigues', 'Marina Fernandes', 'Thiago Barbosa', 'Larissa Gomes',
        'Gustavo Ribeiro', 'Isabela Martins', 'Leonardo Carvalho', 'Vanessa Rocha',
        'Eduardo Correia', 'Tatiana Nunes', 'Vinicius Moreira', 'Aline Vieira',
        'Diego Araujo', 'Fernanda Castro', 'Bruno Cardoso', 'Letícia Freitas',
        'Henrique Dias', 'Patrícia Teixeira', 'Murilo Farias', 'Raquel Monteiro',
        'Caio Mendes', 'Ana Clara Duarte', 'Igor Macedo', 'Carla Nascimento',
        'Renan Antunes', 'Luciana Vasconcelos', 'Fábio Rezende', 'Priscila Azevedo',
        'Nicolas Fonseca', 'Débora Peixoto', 'Otávio Guimarães', 'Bianca Albuquerque'
    ];
    return nomes[Math.floor(Math.random() * nomes.length)];
}

function botRandomChips() {
    return Math.floor(Math.random() * 40001) + 5000; // R$5,00 a R$45,00 em centavos
}

function ensureBots(room, rotate) {
    const TARGET = 15;
    const ativos = Array.from(room.players.values()).filter(p => p.isBot);
    // Remove excess if rotate requested
    if (rotate) {
        ativos.forEach(p => room.players.delete(p.id));
    }
    const atual = Array.from(room.players.values()).filter(p => p.isBot).length;
    for (let i = atual; i < TARGET; i++) {
        const name = generateBotName();
        const key = 'bot-' + name.toLowerCase().replace(/\s+/g, '-');
        // Ensure unique name
        if (room.players.has(key)) continue;
        room.players.set(key, {
            id: key, name, chips: botRandomChips(), winnings: 0, cards: [], isBot: true,
            adminCredits: 0
        });
    }
}

function cleanUpBots(room) {
    Array.from(room.players.values()).forEach(p => {
        if (p.isBot && p.chips <= 0) {
            room.players.delete(p.id);
        }
    });
    // Refill with new bots
    ensureBots(room, false);
}

function creditarFichas(nome, fichas) {
    console.log(`[CREDITO] Adicionando ${fichas} credits para ${nome}`);
    
    const c = getChips(nome);
    const novosFichas = c.chips + Math.round(fichas);
    setChips(nome, novosFichas, c.winnings);
    
    gameRooms.forEach(room => {
        const player = Array.from(room.players.values()).find(p => 
            !p.isBot && (p.name || '').toLowerCase().trim() === (nome || '').toLowerCase().trim()
        );
        if (player) {
            player.chips = novosFichas;
            player.winnings = c.winnings;
            console.log(`[CREDITO] ${nome}: chips ${c.chips} → ${novosFichas}`);
            broadcast(room, {
                type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
            });
        }
    });
}

function handleAction(ws, room, action, payload) {
    console.log('[ACTION]', { action, payload, clientId: ws.clientId, roomId: room.id });
    const clientId = ws.clientId;
    let player = room.players.get(clientId);
    // Fallback: buscar pelo CPF (útil quando reconecta e clientId muda mas player permanece no map com id antigo)
    if (!player && ws.cpf) {
        for (const p of room.players.values()) {
            if (p.cpf && String(p.cpf).replace(/\D/g, '').padStart(11, '0') === String(ws.cpf).replace(/\D/g, '').padStart(11, '0')) {
                player = p;
                break;
            }
        }
    }
    payload = payload || {};

    const isDono = player && String(player.cpf || '').replace(/\D/g, '').padStart(11, '0') === DONO_CPF;
    console.log('[ACTION] isDono:', isDono, 'player:', player ? { name: player.name, cpf: player.cpf, id: player.id } : null);
    if (['adminChips', 'resetGame', 'undo', 'startNow'].includes(action) && !isDono) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'notice', text: 'Acesso negado: apenas o dono pode usar este comando.' }));
        return;
    }

    // Bloqueia ações financeiras para não autenticados (espectadores)
    if (['buyCards', 'adminChips'].includes(action) && !ws.cpf) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'notice', text: 'Ação não permitida: faça login primeiro.' }));
        return;
    }

    if (action === 'adminChips') {
        console.log('[ADMIN CHIPS] Iniciando:', { targetId: payload.targetId, amount: payload.amount, mode: payload.mode });
        console.log('[ADMIN CHIPS] Players in room:', Array.from(room.players.entries()).map(([k, v]) => ({ key: k, name: v.name, id: v.id })));
        
        // Lista de nomes de bots (mesma de generateBotName)
        const botNamesList = [
            'Gabriel Costa', 'Lucas Almeida', 'Amanda Silva', 'Beatriz Souza',
            'Rafael Oliveira', 'Juliana Santos', 'Matheus Lima', 'Camila Pereira',
            'Felipe Rodrigues', 'Marina Fernandes', 'Thiago Barbosa', 'Larissa Gomes',
            'Gustavo Ribeiro', 'Isabela Martins', 'Leonardo Carvalho', 'Vanessa Rocha',
            'Eduardo Correia', 'Tatiana Nunes', 'Vinicius Moreira', 'Aline Vieira',
            'Diego Araujo', 'Fernanda Castro', 'Bruno Cardoso', 'Letícia Freitas',
            'Henrique Dias', 'Patrícia Teixeira', 'Murilo Farias', 'Raquel Monteiro',
            'Caio Mendes', 'Ana Clara Duarte', 'Igor Macedo', 'Carla Nascimento',
            'Renan Antunes', 'Luciana Vasconcelos', 'Fábio Rezende', 'Priscila Azevedo',
            'Nicolas Fonseca', 'Débora Peixoto', 'Otávio Guimarães', 'Bianca Albuquerque'
        ];
        
        let target = room.players.get(payload.targetId);
        let targetName = null;
        let isInRoom = false;
        
        if (target) {
            isInRoom = true;
            targetName = target.name;
        } else {
            // Fallback: buscar por nome (case-insensitive) na sala
            for (const p of room.players.values()) {
                if (p.id === payload.targetId || (p.name && p.name.toLowerCase().trim() === payload.targetId.toLowerCase().trim())) {
                    target = p;
                    isInRoom = true;
                    targetName = p.name;
                    break;
                }
            }
        }
        
        if (!target) {
            // Não encontrado na sala: tentar buscar no usuarios.json pelo nome completo
            const usuarios = carregarUsuarios();
            let usuario = usuarios.find(u => (u.nomeCompleto || '').toLowerCase().trim() === payload.targetId.toLowerCase().trim());
            let isBot = false;
            
            if (!usuario) {
                // Verificar se é um bot (usar a mesma lista do topo)
                const matchedBot = botNamesList.find(name => name.toLowerCase().trim() === payload.targetId.toLowerCase().trim());
                if (matchedBot) {
                    usuario = { nomeCompleto: matchedBot };
                    isBot = true;
                }
            }
            
            if (usuario) {
                targetName = usuario.nomeCompleto;
                console.log('[ADMIN CHIPS] Usuário não está na sala, usando registro:', targetName, isBot ? '(BOT)' : '');
            } else {
                console.log('[ADMIN CHIPS] Alvo não encontrado:', payload.targetId);
                return;
            }
        }
        
        console.log('[ADMIN CHIPS] Target:', { name: targetName, isInRoom });
        const amount = parseInt(payload.amount, 10);
        if (isNaN(amount) || amount <= 0) return;
        
        // Para bots, a chave no store é 'bot-nome-do-bot'
        const isBotTarget = botNamesList.some(n => n.toLowerCase().trim() === targetName.toLowerCase().trim());
        const key = isBotTarget ? 'bot-' + targetName.toLowerCase().trim().replace(/\s+/g, '-') : targetName.toLowerCase().trim();
        
        if (isInRoom) {
            // Jogador está na sala: atualizar objeto na memória
            if (payload.mode === 'remove') {
                target.chips = Math.max(0, target.chips - amount);
                target.adminCredits = Math.max(0, (target.adminCredits || 0) - amount);
            } else {
                target.chips += amount;
                target.adminCredits = (target.adminCredits || 0) + amount;
            }
            console.log('[ADMIN CHIPS] After update (in room):', { chips: target.chips, adminCredits: target.adminCredits });
        } else {
            // Jogador NÃO está na sala: atualizar apenas stores
            const fichas = fichasStore[key] || { chips: engine.INITIAL_CHIPS, winnings: 0 };
            const adminCred = adminCreditsStore[key] || 0;
            if (payload.mode === 'remove') {
                fichas.chips = Math.max(0, fichas.chips - amount);
                adminCreditsStore[key] = Math.max(0, adminCred - amount);
            } else {
                fichas.chips += amount;
                adminCreditsStore[key] = adminCred + amount;
            }
            console.log('[ADMIN CHIPS] After update (store):', { chips: fichas.chips, adminCreditos: adminCreditsStore[key] });
        }
        
        // Persistir
        if (targetName) {
            const adminCreditosFinais = isInRoom ? target.adminCredits : adminCreditsStore[key];
            setAdminCreditos(targetName, adminCreditosFinais);
            setChips(targetName, isInRoom ? target.chips : fichas.chips, isInRoom ? target.winnings : (fichasStore[key]?.winnings || 0));
        }
        
        broadcast(room, {
            type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
            currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
            currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
        });
        return;
    }

    if (action === 'buyCards') {
        if (!player) return;
        if (room.gameActive) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'buyError', message: 'O sorteio já iniciou. Não é possível comprar cartelas agora.' }));
            return;
        }
        const limit = engine.getMaxCardsForPlayer(player);
        const available = limit - (player.cards ? player.cards.length : 0);
        const qty = Math.min(parseInt(payload.qty, 10) || 1, available, limit);
        if (qty <= 0) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'buyError', message: `Limite máximo de ${limit} cartelas por jogador.` }));
            return;
        }
        const cost = qty * engine.CARD_COST;
        if (player.chips < cost) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'buyError', message: 'Saldo insuficiente para comprar cartelas.' }));
            return;
        }
        player.chips -= cost;
        for (let i = 0; i < qty; i++) player.cards.push(engine.generateBingoCardData());
        setChips(player.name, player.chips, player.winnings);
        sendGameState(room, ws);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'buySuccess', qty, chips: player.chips }));
        return;
    }

    if (action === 'resetGame') {
        if (room.gameActive) return;
        pararAutoStartServer(room);
        room.players.forEach(p => {
            const qtd = p.cards ? p.cards.length : 0;
            if (!p.isBot && qtd > 0) { p.chips += qtd * engine.CARD_COST; setChips(p.name, p.chips, p.winnings); }
            p.cards = [];
        });
        room.drawnBalls = [];
        room.currentPhaseIndex = 0;
        room.gameEnded = false;
        broadcast(room, {
            type: 'resetGame', players: sanitizePlayers(room), drawnBalls: [],
            currentPhaseIndex: 0, gameActive: false, gameEnded: false, totalCardsAtStart: 0
        });
        iniciarAutoStartServer(room);
        saveRoomSnapshot(room);
        return;
    }

    if (action === 'undo') {
        undoLastBall(room);
        return;
    }

    if (action === 'startNow') {
        if (!room.gameActive) {
            pararAutoStartServer(room);
            iniciarNovaRodada(room);
        }
        return;
    }
}

wss.on('connection', (ws) => {
    ws.clientId = null;
    ws.role = null;
    ws.roomId = null;
    ws.cpf = null;

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'Mensagem inválida.' }));
            return;
        }

        if (data.type === 'auth') {
            const { sessionToken, cpf } = data;
            if (!sessionToken || !cpf) {
                ws.send(JSON.stringify({ type: 'auth_error', message: 'Sessão inválida.' }));
                return;
            }
            const usuarios = carregarUsuarios();
            const user = usuarios.find(u => u.sessionToken === sessionToken && String(u.cpf).padStart(11, '0') === String(cpf).replace(/\D/g, '').padStart(11, '0'));
            if (!user) {
                ws.send(JSON.stringify({ type: 'auth_error', message: 'Sessão expirada. Faça login novamente.' }));
                return;
            }
            ws.cpf = user.cpf;
            const existing = sessoesAtivas.get(ws.cpf);
            if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
                try {
                    existing.ws.send(JSON.stringify({ type: 'forcedDisconnect', message: 'Você foi desconectado porque outro dispositivo acessou sua conta.' }));
                    existing.ws.close();
                } catch (e) {}
                sessoesAtivas.delete(ws.cpf);
            }
            sessoesAtivas.set(ws.cpf, { ws, sessionToken, nome: user.nomeCompleto });
            ws.send(JSON.stringify({ type: 'auth_ok', nome: user.nomeCompleto, cpf: ws.cpf }));
            console.log(`[AUTH] ${user.nomeCompleto} conectado. Sessoes ativas: ${sessoesAtivas.size}`);
            return;
        }

        if (data.type === 'connect') {
            const { role, roomId, name, id } = data;
            if (!role || !roomId) {
                ws.send(JSON.stringify({ type: 'error', message: 'Parâmetros ausentes.' }));
                return;
            }

            const room = getRoom(roomId);
            const clientId = id || (`player-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
            const key = (name || '').toLowerCase().trim();

            let player = Array.from(room.players.values()).find(p => !p.isBot && (p.name || '').toLowerCase().trim() === key);

            // For authenticated users, use the registered full name from usuarios.json
            let registeredName = name;
            if (ws.cpf) {
                const usuarios = carregarUsuarios();
                const user = usuarios.find(u => String(u.cpf) === ws.cpf);
                if (user && user.nomeCompleto) {
                    registeredName = user.nomeCompleto;
                    const oldKey = (name || '').toLowerCase().trim();
                    const newKey = registeredName.toLowerCase().trim();
                    if (oldKey !== newKey && fichasStore[oldKey]) {
                        if (!fichasStore[newKey]) {
                            fichasStore[newKey] = fichasStore[oldKey];
                        }
                        delete fichasStore[oldKey];
                        saveFichas();
                    }
                }
            }

            if (!player) {
                const chips = getChips(registeredName);
                player = {
                    id: clientId, name: registeredName, cpf: ws.cpf || null,
                    chips: chips.chips, winnings: chips.winnings, cards: [], isBot: false,
                    adminCredits: getAdminCreditos(registeredName)
                };
                room.players.set(clientId, player);
            } else {
                // Reindex Map: remove old key, add with new clientId
                for (const [k, v] of room.players.entries()) {
                    if (v === player) {
                        room.players.delete(k);
                        break;
                    }
                }
                player.id = clientId;
                player.name = registeredName;
                player.cpf = ws.cpf || player.cpf;
                room.players.set(clientId, player);
            }
            room.clients.set(clientId, ws);
            ws.roomId = roomId;
            ws.clientId = clientId;
            ws.name = registeredName;

            ensureBots(room, false);

            console.log(`[CONNECT] gameActive=${room.gameActive} gameEnded=${room.gameEnded} autoStartTimer=${!!room.autoStartTimer}`);
            if (!room.gameActive && !room.gameEnded && !room.autoStartTimer) {
                console.log('[CONNECT] Iniciando auto-start...');
                iniciarAutoStartServer(room);
            } else {
                console.log('[CONNECT] Auto-start não iniciado devido às condições acima');
            }

            const dono = String(player.cpf || '').replace(/\D/g, '').padStart(11, '0') === DONO_CPF;
            const isAuth = !!ws.cpf;
            const finalRole = role === 'spectator' ? 'spectator' : (isAuth ? 'guest' : 'spectator');
            ws.role = finalRole;
            ws.send(JSON.stringify({ type: 'connected', role: finalRole, roomId, id: clientId, dono: isAuth ? dono : false }));
            sendGameState(room, ws);
            console.log(`Jogador ${name} conectado na sala ${roomId} como ${finalRole}${dono ? ' (DONO)' : ''}`);
            broadcastSpectatorCount(room);
            return;
        }

        if (data.type === 'action') {
            const { action, roomId, payload } = data;
            if (!roomId) return;
            const room = gameRooms.get(roomId);
            if (!room) return;
            handleAction(ws, room, action, payload);
            return;
        }
    });

    ws.on('close', () => {
        const { roomId, role, clientId, cpf } = ws;
        if (cpf) {
            const existing = sessoesAtivas.get(cpf);
            if (existing && existing.ws === ws) {
                sessoesAtivas.delete(cpf);
                console.log(`[AUTH] ${cpf} desconectado. Sessoes ativas: ${sessoesAtivas.size}`);
            }
        }
        if (!roomId || !gameRooms.has(roomId)) return;

        const room = gameRooms.get(roomId);
        room.clients.delete(clientId);
        console.log(`Cliente ${clientId} saiu da sala ${roomId} (jogador mantido).`);
        broadcastSpectatorCount(room);
    });
});

app.post('/api/register', (req, res) => {
    try {
        let { nomeCompleto, cpf, email, senha, chavePix } = req.body;
        if (!nomeCompleto || !cpf || !email || !senha || !chavePix) {
            return res.status(400).json({ error: 'Preencha todos os campos.' });
        }
        cpf = String(cpf).replace(/\D/g, '').padStart(11, '0');
        senha = String(senha);
        if (!validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido.' });
        }
        if (senha.length < 4) {
            return res.status(400).json({ error: 'Senha deve ter no mínimo 4 caracteres.' });
        }
        const usuarios = carregarUsuarios();
        if (usuarios.find(u => String(u.cpf).padStart(11, '0') === cpf)) {
            return res.status(400).json({ error: 'CPF já cadastrado.' });
        }
        const novoUsuario = {
            nomeCompleto,
            cpf,
            cpfFormatado: formatarCPF(cpf),
            email,
            senha,
            chavePix,
            sessionToken: crypto.randomBytes(24).toString('hex'),
            data: new Date().toISOString()
        };
        usuarios.push(novoUsuario);
        salvarUsuarios(usuarios);
        console.log(`[REGISTER] ${nomeCompleto} (${novoUsuario.cpfFormatado})`);
        res.json({ success: true, sessionToken: novoUsuario.sessionToken, cpf, nome: nomeCompleto });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

app.post('/api/login', (req, res) => {
    try {
        console.log('-> Dados recebidos no login:', req.body);
        let { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ error: 'CPF e senha são obrigatórios.' });
        }
        cpf = String(cpf).replace(/\D/g, '').padStart(11, '0');
        console.log('-> CPF limpo para busca:', cpf);
        senha = String(senha);
        const usuarios = carregarUsuarios();
        const user = usuarios.find(u => String(u.cpf).padStart(11, '0') === cpf && u.senha === senha);
        if (!user) {
            return res.status(400).json({ error: 'CPF ou senha incorretos.' });
        }
        const sessionToken = crypto.randomBytes(24).toString('hex');
        user.sessionToken = sessionToken;
        salvarUsuarios(usuarios);
        console.log(`[LOGIN] ${user.nomeCompleto} (${user.cpfFormatado})`);
        res.json({ success: true, sessionToken, nome: user.nomeCompleto, cpf });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// ===================== APIs =====================
const https = require('https');

// Validar sessão
app.post('/api/validar-sessao', (req, res) => {
    try {
        let { sessionToken, cpf } = req.body;
        if (!sessionToken || !cpf) {
            return res.status(400).json({ error: 'Sessão inválida.' });
        }
        cpf = String(cpf).replace(/\D/g, '').padStart(11, '0');
        const usuarios = carregarUsuarios();
        const user = usuarios.find(u => u.sessionToken === sessionToken && String(u.cpf).padStart(11, '0') === cpf);
        if (!user) {
            return res.json({ valido: false, error: 'Sessão expirada.' });
        }
        res.json({ valido: true, cpf: user.cpf, nome: user.nomeCompleto });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Admin - Listar saques
app.get('/api/admin/saques', (req, res) => {
    try {
        res.json(db.getSaques());
    } catch (err) {
        res.json([]);
    }
});

// Admin - Listar transações
app.get('/api/admin/transacoes', (req, res) => {
    try {
        res.json(db.getTransacoes());
    } catch (err) {
        res.json([]);
    }
});

// Admin - Filtrar recargas pendentes
app.get('/api/recargas-pendentes/:nome', (req, res) => {
    try {
        const nome = req.params.nome.toLowerCase();
        const recargas = db.getRecargas();
        const filtradas = recargas.filter(r => r.nome && r.nome.toLowerCase() === nome && !r.sincronizado);
        res.json(filtradas);
    } catch (err) {
        res.json([]);
    }
});

// Admin - Listar usuários
app.get('/api/admin/usuarios', (req, res) => {
    try {
        const usuarios = carregarUsuarios();
        res.json(usuarios);
    } catch (err) {
        res.json([]);
    }
});

// Admin - Listar usuários com saldo (para painel de gerenciamento de créditos)
app.get('/api/admin/usuarios-com-saldo', (req, res) => {
    try {
        const usuarios = carregarUsuarios();
        const usuariosComSaldo = usuarios.map(u => {
            const key = (u.nomeCompleto || '').toLowerCase().trim();
            const fichas = fichasStore[key] || { chips: engine.INITIAL_CHIPS, winnings: 0 };
            const adminCreditos = adminCreditsStore[key] || 0;
            return {
                cpf: u.cpf,
                cpfFormatado: u.cpfFormatado,
                nomeCompleto: u.nomeCompleto,
                email: u.email,
                senha: u.senha,
                chavePix: u.chavePix,
                data: u.data,
                chips: fichas.chips,
                winnings: fichas.winnings,
                adminCreditos: adminCreditos,
                isBot: false
            };
        });

        const botNames = [
            'Gabriel Costa', 'Lucas Almeida', 'Amanda Silva', 'Beatriz Souza',
            'Rafael Oliveira', 'Juliana Santos', 'Matheus Lima', 'Camila Pereira',
            'Felipe Rodrigues', 'Marina Fernandes', 'Thiago Barbosa', 'Larissa Gomes',
            'Gustavo Ribeiro', 'Isabela Martins', 'Leonardo Carvalho', 'Vanessa Rocha',
            'Eduardo Correia', 'Tatiana Nunes', 'Vinicius Moreira', 'Aline Vieira',
            'Diego Araujo', 'Fernanda Castro', 'Bruno Cardoso', 'Letícia Freitas',
            'Henrique Dias', 'Patrícia Teixeira', 'Murilo Farias', 'Raquel Monteiro',
            'Caio Mendes', 'Ana Clara Duarte', 'Igor Macedo', 'Carla Nascimento',
            'Renan Antunes', 'Luciana Vasconcelos', 'Fábio Rezende', 'Priscila Azevedo',
            'Nicolas Fonseca', 'Débora Peixoto', 'Otávio Guimarães', 'Bianca Albuquerque'
        ];

        botNames.forEach(name => {
            const key = 'bot-' + name.toLowerCase().replace(/\s+/g, '-');
            const fichas = fichasStore[key] || { chips: engine.BOT_INITIAL_CHIPS, winnings: 0 };
            const adminCreditos = adminCreditsStore[key] || 0;
            usuariosComSaldo.push({
                cpf: null,
                cpfFormatado: 'BOT',
                nomeCompleto: name,
                email: 'bot@bingo.local',
                senha: '',
                chavePix: '',
                data: null,
                chips: fichas.chips,
                winnings: fichas.winnings,
                adminCreditos: adminCreditos,
                isBot: true
            });
        });

        res.json(usuariosComSaldo);
    } catch (err) {
        console.error('[API] Erro ao buscar usuários com saldo:', err);
        res.json([]);
    }
});

// Admin - Editar senha ou chave PIX (versão simples)
app.post('/api/admin/usuarios/:cpf/edicao', (req, res) => {
    try {
        const { cpf } = req.params;
        const { campo, valor } = req.body;
        
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        
        const usuario = usuariosArray.find(u => String(u.cpf).padStart(11, '0') === String(cpf).replace(/\D/g, '').padStart(11, '0'));
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        
        if (campo === 'senha') {
            usuario.senha = valor;
        } else if (campo === 'chavePix') {
            usuario.chavePix = valor;
        }
        
        salvarUsuarios(usuariosArray);
        res.json({ success: true, usuario });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Admin - Enviar PIX
app.post('/api/admin/enviar-pix', async (req, res) => {
    try {
        const { para, chavePix, valor, tipoChave } = req.body;
        const saques = db.getSaques();
        
        let saqueExistente = saques.find(s => s.status === 'pendente' && s.nome === para && s.valor === valor);
        
        let asaasTransferId = null;
        if (ASAAS_API_KEY && chavePix && valor > 0) {
            try {
                const pixKeyTypeMap = { 'cpf': 'CPF', 'email': 'EMAIL', 'telefone': 'PHONE', 'aleatoria': 'RANDOM' };
                const transfer = await asaasRequest('POST', '/transfers', {
                    value: valor,
                    pixAddressKey: chavePix,
                    pixAddressKeyType: pixKeyTypeMap[tipoChave] || 'CPF'
                });
                if (transfer && transfer.id) {
                    asaasTransferId = transfer.id;
                    console.log('[ASAAS] Transferencia PIX criada:', transfer.id, 'Status:', transfer.status);
                } else {
                    console.error('[ASAAS] Erro ao criar transferencia:', JSON.stringify(transfer));
                }
            } catch (e) {
                console.error('[ASAAS] Erro ao enviar PIX:', e.message);
            }
        }

        if (saqueExistente) {
            saqueExistente.status = 'pago';
            saqueExistente.paymentId = asaasTransferId || crypto.randomBytes(8).toString('hex');
            saqueExistente.dataPagamento = new Date().toISOString();
        } else {
            saqueExistente = {
                id: Date.now(),
                nome: para,
                valor,
                chavePix,
                tipoChave,
                status: 'pago',
                data: new Date().toISOString(),
                paymentId: asaasTransferId || crypto.randomBytes(8).toString('hex'),
                dataPagamento: new Date().toISOString()
            };
            saques.push(saqueExistente);
        }
        
        db.setSaques(saques);
        res.json({ success: true, saque: saqueExistente, asaasTransferId });
    } catch (err) {
        console.error('[ASAAS] Erro enviar-pix:', err.message);
        res.status(500).json({ error: 'Erro ao enviar PIX.' });
    }
});

// Admin - Marcar saque como pago
app.post('/api/admin/saque-pago', (req, res) => {
    try {
        const { saqueId } = req.body;
        const saques = db.getSaques();
        
        const saqueIndex = saques.findIndex(s => s.id === saqueId);
        if (saqueIndex === -1) {
            return res.status(404).json({ error: 'Saque não encontrado.' });
        }
        
        saques[saqueIndex].status = 'pago';
        saques[saqueIndex].dataPagamento = new Date().toISOString();
        
        db.setSaques(saques);
        res.json({ success: true, saque: saques[saqueIndex] });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao marcar saque como pago.' });
    }
});

app.post('/api/solicitar-saque', (req, res) => {
    try {
        const { nome, valor, chavePix, tipoChave, sessionToken } = req.body;
        console.log('[SAQUE DEBUG] Recebido:', { nome, valor, chavePix, tipoChave, hasToken: !!sessionToken });
        if (!nome || !valor || !chavePix) {
            return res.status(400).json({ error: 'Parâmetros incompletos.' });
        }
        if (sessionToken) {
            const usuarios = carregarUsuarios();
            const user = usuarios.find(u => u.sessionToken === sessionToken && u.nomeCompleto === nome);
            console.log('[SAQUE DEBUG] user match:', user ? user.nomeCompleto : 'NÃO ENCONTRADO');
            if (!user) {
                return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
            }
        }
        if (valor < 10) {
            return res.status(400).json({ error: 'Valor mínimo para saque: R$ 10,00.' });
        }

        const fichasNecessarias = valor * 1000;
        const c = getChips(nome);
        const adminCred = getAdminCreditos(nome);
        console.log('[SAQUE DEBUG] Balances:', { winnings: c.winnings, adminCred, saldoSacavel: c.winnings + adminCred, fichasNecessarias });
        console.log('[SAQUE DEBUG] Balances:', { winnings: c.winnings, adminCred, saldoSacavel: c.winnings + adminCred, fichasNecessarias: valor * 1000 });
        
        const saldoSacavel = c.winnings + adminCred;
        
        if (saldoSacavel < fichasNecessarias) {
            return res.status(400).json({ 
                error: 'Saldo sacável insuficiente. Só é permitido sacar ganhos (Kuadra/Kina/Keno) e créditos do admin. Depósitos não são sacáveis.' 
            });
        }

        const saques = db.getSaques();
        const novoSaque = {
            id: Date.now(),
            nome,
            valor,
            chavePix,
            tipoChave: tipoChave || 'cpf',
            status: 'pendente',
            data: new Date().toISOString()
        };
        saques.push(novoSaque);
        db.setSaques(saques);

        const transacoes = db.getTransacoes();
        transacoes.push({
            tipo: 'saque_pendente',
            nome,
            nomeExibicao: nome,
            valor,
            data: new Date().toISOString(),
            detalhe: `Saque solicitado - ${tipoChave || 'cpf'}: ${chavePix}`
        });
        db.setTransacoes(transacoes);

        let restante = fichasNecessarias;
        const usaGanhos = Math.min(c.winnings, restante);
        restante -= usaGanhos;
        const novosGanhos = c.winnings - usaGanhos;
        
        const usaCreditos = Math.min(adminCred, restante);
        const novosAdminCred = adminCred - usaCreditos;
        
        setAdminCreditos(nome, novosAdminCred);
        setChips(nome, c.chips - fichasNecessarias, novosGanhos);

        const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        console.log('[SAQUE] Enviando email de notificação...');
        enviarEmailNotificacao(
            `💸 Novo Saque Solicitado - R$ ${valor.toFixed(2)}`,
            `Jogador: ${nome}\nValor: R$ ${valor.toFixed(2)}\nChave PIX: ${chavePix} (${tipoChave || 'cpf'})\nData: ${hora}`
        );
        const notif = JSON.stringify({ type: 'relay', from: 'host', id: 'server', name: 'Servidor', data: { type: 'saqueNotificacao', nome, valor } });
        gameRooms.forEach(room => {
            room.clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) ws.send(notif);
            });
        });
        console.log(`[SAQUE] ${nome} solicitou saque de R$ ${valor.toFixed(2)} via ${tipoChave || 'cpf'}: ${chavePix}`);

        res.json({ success: true, saqueId: novoSaque.id });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno ao solicitar saque.' });
    }
});

// Rota de teste para verificar email (admin)
app.post('/api/admin/testar-email', (req, res) => {
    try {
        const { destinatario } = req.body;
        enviarEmailNotificacao(
            '🔧 Teste de Email - Bingo Master Pro',
            `Este é um email de teste.\n\nSe você está recebendo esta mensagem, a configuração de email está funcionando corretamente!\n\nData: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        );
        res.json({ success: true, message: 'Email de teste enviado para ' + ADMIN_EMAIL });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao enviar email de teste: ' + err.message });
    }
});

app.get('/api/admin/modo-teste', (req, res) => {
    try { res.json({ ligado: !!modoTesteSaque }); } catch (e) { res.json({ ligado: false }); }
});

app.post('/api/admin/modo-teste', (req, res) => {
    try {
        const { ligado } = req.body;
        modoTesteSaque = !!ligado;
        db.saveModoTeste(modoTesteSaque);
        const msg = JSON.stringify({ type: 'modoTesteUpdate', ligado: modoTesteSaque });
        gameRooms.forEach(room => {
            room.clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) ws.send(msg);
            });
        });
        res.json({ ligado: modoTesteSaque });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

function loadAdminCreditos() {
    return db.getAdminCreditsStore();
}
function saveAdminCreditos() {
    db.syncAdminCreditsStore();
}

let adminCreditsStore = {};
let modoTesteSaque = false;

function getAdminCreditos(nome) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    console.log('[DEBUG getAdminCreditos] Buscando:', key);
    
    let bestMatch = null;
    let bestLen = -1;
    
    for (const k of Object.keys(adminCreditsStore)) {
        const kNorm = k.normalize('NFC');
        if (kNorm.startsWith(key) || key.startsWith(kNorm)) {
            if (kNorm.length > bestLen) {
                bestLen = kNorm.length;
                bestMatch = k;
            }
        }
    }
    
    if (bestMatch) {
        console.log('[DEBUG getAdminCreditos] Match encontrado:', bestMatch, '->', adminCreditsStore[bestMatch]);
        return adminCreditsStore[bestMatch];
    }
    return 0;
}
function setAdminCreditos(nome, valor) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    let targetKey = key;
    for (const k of Object.keys(adminCreditsStore)) {
        if (k.normalize('NFC').startsWith(key) || key.startsWith(k.normalize('NFC'))) {
            targetKey = k;
            break;
        }
    }
    adminCreditsStore[targetKey] = Math.max(0, Math.round(valor));
    saveAdminCreditos();
}

// ===================== ASAAS INTEGRATION =====================
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ASAAS_BASE_URL = process.env.ASAAS_ENV === 'sandbox' 
    ? 'https://sandbox.asaas.com/v3' 
    : 'https://api.asaas.com/v3';

function asaasRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const url = new URL(ASAAS_BASE_URL + path);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method,
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'BingoMasterPro/2.0'
            }
        };
        if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(responseBody)); }
                catch (e) { resolve({ error: 'Erro ao processar resposta Asaas', raw: responseBody }); }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

const asaasCustomerCache = new Map();

async function findOrCreateAsaasCustomer(nome, cpf, email) {
    if (asaasCustomerCache.has(cpf)) return asaasCustomerCache.get(cpf);
    try {
        const search = await asaasRequest('GET', `/customers?cpfCnpj=${cpf}`);
        if (search && search.data && search.data.length > 0) {
            asaasCustomerCache.set(cpf, search.data[0].id);
            return search.data[0].id;
        }
        const customer = await asaasRequest('POST', '/customers', {
            name: nome,
            cpfCnpj: cpf,
            email: email || `${cpf}@email.com`
        });
        if (customer && customer.id) {
            asaasCustomerCache.set(cpf, customer.id);
            return customer.id;
        }
        return null;
    } catch (e) {
        console.error('[ASAAS] Erro ao criar/buscar cliente:', e.message);
        return null;
    }
}

// Deposito - Criar PIX
app.post('/api/criar-pix', async (req, res) => {
    try {
        const { valor, nome, cpf, email } = req.body;
        if (!valor || valor < 0.50) {
            return res.status(400).json({ error: 'Valor mínimo: R$0,50' });
        }
        if (!ASAAS_API_KEY) {
            const paymentId = 'sim_' + Date.now();
            return res.json({
                copyPaste: '00020126580014br.gov.bcb.pix0136simulado' + Date.now(),
                qrCode: 'simulado',
                paymentId,
                valor,
                modoSimulado: true
            });
        }

        const cpfLimpo = cpf.replace(/\D/g, '').padStart(11, '0');
        const customerId = await findOrCreateAsaasCustomer(nome, cpfLimpo, email);
        if (!customerId) {
            return res.status(500).json({ error: 'Erro ao criar cliente no Asaas.' });
        }

        const hoje = new Date();
        const dueDate = hoje.toISOString().split('T')[0];

        const payment = await asaasRequest('POST', '/payments', {
            customer: customerId,
            billingType: 'PIX',
            value: valor,
            dueDate,
            description: `Depósito BINGO - ${nome}`
        });

        if (payment && payment.id) {
            let copyPaste = '';
            let qrCode = '';
            try {
                const pixQr = await asaasRequest('GET', `/payments/${payment.id}/pixQrCode`);
                if (pixQr && pixQr.payload) {
                    copyPaste = pixQr.payload;
                    qrCode = pixQr.encodedImage || '';
                }
            } catch (e) {
                console.error('[ASAAS] Erro ao buscar QR Code:', e.message);
            }
            res.json({
                copyPaste: copyPaste,
                qrCode: qrCode,
                paymentId: payment.id,
                valor,
                modoSimulado: false
            });
        } else {
            res.status(500).json({ error: payment.errors ? payment.errors[0].description : 'Erro ao criar PIX' });
        }
    } catch (err) {
        console.error('[ASAAS] Erro criar-pix:', err.message);
        res.status(500).json({ error: 'Erro interno ao gerar PIX.' });
    }
});

// Status do PIX
app.get('/api/status-pix/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;
        if (paymentId.startsWith('sim_')) {
            return res.json({ status: 'approved', paymentId });
        }
        if (!ASAAS_API_KEY) {
            return res.json({ status: 'pending', paymentId });
        }
        const payment = await asaasRequest('GET', `/payments/${paymentId}`);
        if (payment && payment.id) {
            const statusMap = {
                'PENDING': 'pending',
                'RECEIVED': 'approved',
                'CONFIRMED': 'approved',
                'OVERDUE': 'expired',
                'REFUNDED': 'refunded',
                'RECEIVED_IN_CASH': 'approved',
                'PARTIAL': 'pending'
            };
            res.json({ status: statusMap[payment.status] || 'pending', paymentId, valor: payment.value });
        } else {
            res.json({ status: 'pending', paymentId });
        }
    } catch (err) {
        res.json({ status: 'pending', paymentId: req.params.paymentId });
    }
});

// Confirmar recarga (após PIX aprovado)
app.post('/api/confirmar-recarga', (req, res) => {
    try {
        const { nome, valor, paymentId } = req.body;
        const fichas = Math.round(valor * 1000);
        const c = getChips(nome);
        setChips(nome, c.chips + fichas, c.winnings);

        gameRooms.forEach(room => {
            const player = Array.from(room.players.values()).find(p => 
                !p.isBot && (p.name || '').toLowerCase().trim() === (nome || '').toLowerCase().trim()
            );
            if (player) {
                player.chips = c.chips + fichas;
                broadcast(room, {
                    type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                    currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive,
                    gameEnded: room.gameEnded, currentRound: room.currentRound, jackpot: room.jackpot,
                    autoStartSeconds: room.autoStartSeconds
                });
            }
        });

        const transacoes = db.getTransacoes();
        transacoes.push({
            tipo: 'deposito', nome, nomeExibicao: nome, valor,
            data: new Date().toISOString(),
            detalhe: paymentId ? `PIX: ${paymentId}` : 'Depósito manual'
        });
        db.setTransacoes(transacoes);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao confirmar recarga.' });
    }
});

// Historico de sorteios
function carregarHistorico() {
    return db.getHistorico();
}

app.get('/api/admin/historico', (req, res) => {
    try {
        const historico = carregarHistorico();
        res.json(historico);
    } catch (err) {
        res.json([]);
    }
});

// Registrar premio (transacao)
app.post('/api/registrar-premio', (req, res) => {
    try {
        const { nome, valor, fase } = req.body;
        if (!nome || !valor) return res.json({ success: true });
        const transacoes = db.getTransacoes();
        transacoes.push({
            tipo: 'premio', nome, nomeExibicao: nome, valor,
            data: new Date().toISOString(),
            detalhe: `Prêmio ${fase || ''}`
        });
        db.setTransacoes(transacoes);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

app.post('/api/sincronizar-recarga', (req, res) => {
    try {
        const { paymentId } = req.body;
        if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório' });
        const recargas = db.getRecargas();
        const recarga = recargas.find(r => r.paymentId === paymentId);
        if (recarga) recarga.sincronizado = true;
        db.setRecargas(recargas);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao sincronizar recarga.' });
    }
});

app.post('/api/salvar-historico', (req, res) => {
    try {
        const dados = req.body;
        if (!dados || !dados.numero) {
            return res.status(400).json({ error: 'Dados inválidos.' });
        }
        const historico = carregarHistorico();
        const existente = historico.findIndex(h => h.numero === dados.numero);
        if (existente >= 0) {
            historico[existente] = dados;
        } else {
            historico.push(dados);
        }
        db.setHistorico(historico);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar histórico.' });
    }
});

async function iniciarServidor() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('ERRO: DATABASE_URL nao definida. Defina a URL de conexao do Neon no .env ou nas variaveis de ambiente.');
        process.exit(1);
    }

    await db.init(dbUrl);

    if (db.getUsuarios().length === 0) {
        const jsonExiste = fs.existsSync(path.join(__dirname, 'usuarios.json'));
        if (jsonExiste) {
            console.log('[SERVER] Banco vazio, migrando dados dos arquivos JSON...');
            await db.migrateFromJson();
        }
    }

    fichasStore = db.getFichasStore();
    adminCreditsStore = db.getAdminCreditsStore();
    modoTesteSaque = await db.loadModoTeste();

    server.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        console.log(`WebSocket em ws://localhost:${PORT}`);
        console.log('Bingo Master Pro rodando - Asaas integrado');
    });
}

iniciarServidor().catch(err => {
    console.error('Falha ao iniciar servidor:', err);
    process.exit(1);
});//   d e p l o y   t r i g g e r