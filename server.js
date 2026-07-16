require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const engine = require('./engine');
const db = require('./db');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { console.log('[EMAIL] nodemailer não disponível.'); }

// ===================== HELPERS DE VALIDAÃ‡ÃƒO / SANITIZAÃ‡ÃƒO =====================
function sanitizeText(str, maxLen = 40) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, maxLen);
}
function normalizeCpf(cpf) {
    const digits = typeof cpf === 'string' ? cpf.replace(/\D/g, '') : '';
    if (digits.length !== 11) return null;
    return digits;
}
function validarValorSaque(v) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0 || n > 1000000) return null;
    return n;
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({ status: 'online', name: 'Bingo Master Pro API', version: '2.0.0' });
});

const DONO_CPF = '05893761600';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'marcostheangels@gmail.com';

// ===================== GLOBAL ERROR HANDLERS =====================
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason?.message || reason);
});

// ===================== CONFIGURAÃ‡ÃƒO DE EMAIL (SENDGRID + RESEND + SMTP FALLBACK) =====================
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || ADMIN_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS;
let transporter = null;
const EMAIL_FROM = 'BingoVipClub <marcostheangels@gmail.com>';

if (SMTP_PASS && nodemailer) {
    (async () => {
        try {
            const dns = require('dns');
            const ipv4 = await new Promise((resolve, reject) => {
                dns.lookup(SMTP_HOST, { family: 4 }, (err, address) => err ? reject(err) : resolve(address));
            });
            transporter = nodemailer.createTransport({
                host: ipv4, port: SMTP_PORT,
                secure: SMTP_PORT === 465,
                requireTLS: SMTP_PORT === 587,
                auth: { user: SMTP_USER, pass: SMTP_PASS },
                tls: { rejectUnauthorized: true, servername: SMTP_HOST }
            });
            console.log('[EMAIL] Transportador SMTP configurado:', SMTP_USER, '->', ipv4);
        } catch (e) { console.log('[EMAIL] Erro SMTP:', e.message); }
    })();
}

async function enviarEmailSendGrid(to, subject, html, unsubscribeUrl) {
    if (!SENDGRID_API_KEY) return false;
    try {
        const headers = {
            'Authorization': 'Bearer ' + SENDGRID_API_KEY,
            'Content-Type': 'application/json'
        };
        const messageId = '<' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@bingovipclub.shop>';
        const extraHeaders = [
            { key: 'Message-ID', value: messageId },
            { key: 'Precedence', value: 'bulk' },
            { key: 'X-Auto-Response-Suppress', value: 'All' },
            { key: 'List-Id', value: '<bingovipclub.shop>' }
        ];
        if (unsubscribeUrl) {
            extraHeaders.push({ key: 'List-Unsubscribe', value: '<' + unsubscribeUrl + '>' });
            extraHeaders.push({ key: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
        }
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                personalizations: [{ to: [{ email: to }], headers: extraHeaders.reduce((o, h) => { o[h.key] = h.value; return o; }, {}) }],
                from: { email: 'contato@bingovipclub.shop', name: 'BingoVipClub' },
                reply_to: { email: 'contato@bingovipclub.shop', name: 'BingoVipClub' },
                subject,
                content: [{ type: 'text/html', value: html }],
                headers: extraHeaders.reduce((o, h) => { o[h.key] = h.value; return o; }, {}),
                asm: { group_id: 1 }
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error('SendGrid: ' + res.status + ' ' + errText.slice(0, 200));
        }
        console.log('[EMAIL] Enviado via SendGrid para', to);
        return true;
    } catch (e) {
        console.error('[EMAIL] SendGrid falhou:', e.message);
        return false;
    }
}

const SITE_URL = process.env.SITE_URL || 'https://bingo-vip-club-e8164.web.app';
const API_URL = process.env.API_URL || 'https://bingo-master-pro-fcty.onrender.com';
const LOGO_URL = API_URL + '/logo-bingo';

async function enviarEmailBonus(nomeUsuario, emailUsuario, valorReais) {
    console.log('[EMAIL-DIAG] Iniciando envio. Para:', JSON.stringify(emailUsuario), 'Nome:', JSON.stringify(nomeUsuario));
    const emailLimpo = (emailUsuario || '').toString().trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo);
    console.log('[EMAIL-DIAG] Email limpo:', JSON.stringify(emailLimpo), 'Valido:', emailValido, 'Tem SENDGRID:', !!SENDGRID_API_KEY, 'Tem RESEND:', !!RESEND_API_KEY);
    if (!emailValido) {
        console.error('[EMAIL-DIAG] Email INVALIDO, abortando envio.');
        return;
    }
    const valorFmt = valorReais.toFixed(2).replace('.', ',');
    const unsubscribeUrl = SITE_URL + '/unsubscribe?email=' + encodeURIComponent(emailLimpo);
    const htmlJogador = `
        <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
            <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                <div style="background:#0a0a2e;text-align:center;padding:22px 16px">
                    <div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div>
                    <div style="color:#9aa0c0;font-size:12px;margin-top:4px">Bingo online e credenciado</div>
                </div>
                <div style="padding:28px 24px">
                    <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Olá ${nomeUsuario},</div>
                    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Temos uma novidade para a sua conta. Um bônus de <strong style="color:#10b981">R$ ${valorFmt}</strong> em fichas foi creditado e já está disponível para você usar nas salas de bingo.</p>
                    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px 0">Acesse sua conta para conferir o saldo atualizado e aproveitar. Se tiver dúvidas, responda este email que nossa equipe responde.</p>
                    <div style="text-align:center;margin:8px 0 4px">
                        <a href="${SITE_URL}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Acessar minha conta</a>
                    </div>
                </div>
                <div style="background:#f5f5f7;padding:16px 24px;text-align:center;border-top:1px solid #ececf0">
                    <p style="color:#999;font-size:11px;margin:2px 0">BingoVipClub ÷ Este é um email transacional da sua conta.</p>
                    <p style="color:#bbb;font-size:11px;margin:2px 0"><a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline">Cancelar inscrição</a></p>
                </div>
            </div>
        </div>
    `;
    const assunto = 'Seu bônus de R$ ' + valorFmt + ' chegou, ' + nomeUsuario + '!';

    let enviado = false;

    // 1) Resend em primeiro lugar (canal comprovado funcionando em produção)
    if (!enviado && RESEND_API_KEY) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'BingoVipClub <contato@bingovipclub.shop>',
                    to: [emailLimpo],
                    subject: assunto,
                    html: htmlJogador,
                    headers: { 'List-Unsubscribe': '<' + unsubscribeUrl + '>' }
                })
            });
            if (res.ok) {
                enviado = true;
                console.log('[EMAIL] Enviado via Resend para', emailLimpo);
            } else {
                const txt = await res.text();
                console.error('[EMAIL] Resend retornou', res.status, txt.slice(0, 200));
            }
        } catch (e) { console.error('[EMAIL] Resend falhou:', e.message); }
    }

    // 2) SendGrid como alternativa
    if (!enviado && SENDGRID_API_KEY) {
        enviado = await enviarEmailSendGrid(emailLimpo, assunto, htmlJogador, unsubscribeUrl);
    }

    // 3) SMTP (Gmail) como último recurso
    if (!enviado && transporter) {
        try {
            const info = await transporter.sendMail({
                from: '"BingoVipClub" <' + SMTP_USER + '>',
                to: emailLimpo,
                subject: assunto,
                html: htmlJogador,
                headers: { 'List-Unsubscribe': '<' + unsubscribeUrl + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            });
            enviado = true;
            console.log('[EMAIL] Enviado via SMTP (Gmail)! ID:', info.messageId);
        } catch (e) { console.error('[EMAIL] SMTP falhou:', e.message); }
    }
    console.log('[EMAIL-DIAG] Resultado final enviado=', enviado, 'para', emailLimpo);

        if (enviado) {
            console.log('[EMAIL] Bonus enviado para', emailUsuario);
            enviarEmailAdmin(
                'Bônus enviado para ' + nomeUsuario,
                '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + nomeUsuario + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Email</p><p style="font-size:15px;color:#222;margin:0">' + emailUsuario + '</p></div><div style="background:#ecfdf5;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Valor creditado</p><p style="font-size:22px;color:#10b981;font-weight:bold;margin:0">R$ ' + valorFmt + '</p></div>',
                'BÃ”NUS CONCEDIDO'
            ).catch(() => {});
        }
    }

// Envia um email transacional para o PRÃ“PRIO JOGADOR (usado em crÃ©dito, depÃ³sito, PIX, etc.)
// Prioriza Resend (canal comprovado em produÃ§Ã£o).
async function notificarJogador(nomeUsuario, emailUsuario, assunto, htmlCorpo) {
    const emailLimpo = (emailUsuario || '').toString().trim().toLowerCase();
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo);
    if (!emailValido) {
        console.log('[EMAIL] notificarJogador: email invÃ¡lido para', nomeUsuario, '(', emailLimpo, ') - pulando');
        return false;
    }
    let enviado = false;
    if (RESEND_API_KEY) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'BingoVipClub <contato@bingovipclub.shop>',
                    to: [emailLimpo],
                    subject: assunto,
                    html: htmlCorpo,
                    headers: { 'List-Unsubscribe': '<' + SITE_URL + '/unsubscribe?email=' + encodeURIComponent(emailLimpo) + '>' }
                })
            });
            if (res.ok) { enviado = true; console.log('[EMAIL] notificarJogador: enviado via Resend para', emailLimpo); }
            else { const t = await res.text(); console.error('[EMAIL] notificarJogador Resend', res.status, t.slice(0, 200)); }
        } catch (e) { console.error('[EMAIL] notificarJogador Resend falhou:', e.message); }
    }
    if (!enviado && SENDGRID_API_KEY) {
        enviado = await enviarEmailSendGrid(emailLimpo, assunto, htmlCorpo, SITE_URL + '/unsubscribe?email=' + encodeURIComponent(emailLimpo));
    }
    if (!enviado && transporter) {
        try {
            await transporter.sendMail({ from: '"BingoVipClub" <' + SMTP_USER + '>', to: emailLimpo, subject: assunto, html: htmlCorpo });
            enviado = true;
        } catch (e) { console.error('[EMAIL] notificarJogador SMTP falhou:', e.message); }
    }
    return enviado;
}

async function montarEmailAdmin(assunto, corpoHtml, badge) {
    const badgeHtml = badge ? '<div style="display:inline-block;background:#10b981;color:#fff;font-size:12px;font-weight:bold;padding:4px 12px;border-radius:20px;letter-spacing:1px;margin-bottom:14px">' + badge + '</div>' : '';
    return `
        <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
            <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                <div style="background:#0a0a2e;text-align:center;padding:20px 16px">
                    <img src="${LOGO_URL}" alt="BingoVipClub" style="max-width:200px;height:auto;display:inline-block" />
                </div>
                <div style="padding:28px 24px">
                    ${badgeHtml}
                    <h2 style="color:#1a1a3c;font-size:20px;margin:0 0 18px 0">${assunto}</h2>
                    ${corpoHtml}
                    <p style="font-size:12px;color:#aaa;text-align:center;margin:18px 0 0 0">BingoVipClub ÷ Painel administrativo</p>
                </div>
            </div>
        </div>
    `;
}

async function enviarEmailAdmin(assunto, corpoHtml, badge) {
    const html = montarEmailAdmin(assunto, corpoHtml, badge);
    let enviado = false;
    if (SENDGRID_API_KEY) {
        enviado = await enviarEmailSendGrid(ADMIN_EMAIL, assunto, html);
    }
    if (!enviado && RESEND_API_KEY) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: 'BingoVipClub <contato@bingovipclub.shop>', to: [ADMIN_EMAIL], subject: assunto, html })
            });
            if (res.ok) enviado = true;
        } catch (e) { console.error('[EMAIL] Resend admin falhou:', e.message); }
    }
    console.log('[EMAIL] Notificação admin:', enviado ? 'enviada' : 'FALHOU', '-', assunto);
    return enviado;
}

async function enviarEmailNotificacao(assunto, texto) {
    if (RESEND_API_KEY) {
        try {
            console.log('[EMAIL] Enviando via Resend:', assunto, 'para', ADMIN_EMAIL);
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'BingoVipClub <contato@bingovipclub.shop>',
                    to: [ADMIN_EMAIL],
                    subject: assunto,
                    html: texto.replace(/\n/g, '<br>')
                })
            });
            if (!res.ok) throw new Error('Resend: ' + res.status + ' ' + (await res.text()).slice(0, 200));
            const data = await res.json();
            console.log('[EMAIL] Enviado via Resend! ID:', data.id);
            return;
        } catch (e) {
            console.error('[EMAIL] Resend falhou:', e.message);
        }
    }
    if (!transporter) {
        console.warn('[EMAIL] Nenhum método de email configurado (Resend/SMTP). Notificação ignorada.');
        return;
    }
    console.log('[EMAIL] Enviando via SMTP:', assunto, 'para', ADMIN_EMAIL);
    try {
        const info = await transporter.sendMail({
            from: `"Bingo Master Pro" <${SMTP_USER}>`, to: ADMIN_EMAIL,
            subject: assunto, text: texto, html: texto.replace(/\n/g, '<br>')
        });
        console.log('[EMAIL] Enviado! ID:', info.messageId);
    } catch (err) {
        console.error('[EMAIL] Erro ao enviar (ignorado):', err.message);
    }
}

// ===================== USUARIOS =====================
function carregarUsuarios() {
    return db.getUsuarios();
}
async function salvarUsuarios(lista) {
    await db.setUsuarios(lista);
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

// ===================== JOGO AUTORITATIVO (SERVIDOR) =====================
const DEFAULT_ROOM = 'bingo-master-pro-marcos';
const DRAW_SPEED = 3000;
const AUTO_START_INTERVAL = 150;
let fichasStore = {};//

// Lista oficial de bots (deve espelhar a lista usada em usuarios-com-saldo)
const BOT_NAMES = [
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
function isNomeDeBot(nome) {
    const key = (nome || '').toLowerCase().trim();
    return BOT_NAMES.some(b => b.toLowerCase().trim() === key);
}
function loadFichas() {
    return db.getFichasStore();
}
async function saveFichas() {
    await db.syncFichasStore();
}
function getChips(nome) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    if (fichasStore[key]) return fichasStore[key];
    return { chips: engine.INITIAL_CHIPS, winnings: 0 };
}
async function setChips(nome, chips, winnings) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    fichasStore[key] = { chips: Math.max(0, Math.round(chips)), winnings: Math.round(winnings || 0) };
    await saveFichas();
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
            jackpot: engine.JACKPOT_INITIAL,
            jackpotAwarded: false,
            autoStartSeconds: 0,
            autoStartTimer: null,
            drawTimer: null,
            phasePauseTimer: null,
            watchdogTimer: null,
            log: []
        };
        loadRoomSnapshot(room);
        // Se o jogo estava ativo mas os timers morreram (servidor reiniciou), resetar
        if (room.gameActive && !room.drawTimer) {
            console.log('[ROOM] Estado fantasma detectado (gameActive sem timer), resetando sala', roomId);
            room.gameActive = false;
            room.gameEnded = false;
            room.drawnBalls = [];
            room.currentPhaseIndex = 0;
            room.players.clear();
        }
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
        totalCardsAtStart: room.totalCardsAtStart || 0,
        manutencao: db.getManutencao()
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
    room.autoStartSeconds = 60;
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
    liquidarComprasSala(room.id);
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
    // Jackpot é progressivo: mantém o acumulado; só semeia o valor inicial se estiver zerado
    if (!room.jackpot) room.jackpot = engine.JACKPOT_INITIAL;
    
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
const GAME_WATCHDOG_MS = 60000;

function iniciarWatchdog(room) {
    if (room.watchdogTimer) clearTimeout(room.watchdogTimer);
    room.watchdogTimer = setTimeout(() => {
        if (room.gameActive) {
            console.error('[WATCHDOG] Jogo travado! Resetando sala', room.id);
            room.gameActive = false;
            room.gameEnded = true;
            finalizarRodada(room);
        }
    }, GAME_WATCHDOG_MS);
}

function pararWatchdog(room) {
    if (room.watchdogTimer) {
        clearTimeout(room.watchdogTimer);
        room.watchdogTimer = null;
    }
}

function agendarProximoDraw(room, delay) {
    if (room.drawTimer) clearTimeout(room.drawTimer);
    room.drawTimer = setTimeout(() => {
        sortearProximaBola(room).catch(e => console.error('[GAME] agendarProximoDraw error:', e.message));
    }, delay || DRAW_SPEED_MS);
}

async function sortearProximaBola(room) {
    room.drawTimer = null;
    iniciarWatchdog(room);
    
    try {
        if (room.drawnBalls.length >= 90) {
            await finalizarRodada(room);
            return;
        }
        
        // Se a fase atual já foi ganha, não sortear mais bolas nesta fase.
        // Em sala com humanos, a fase avança SÃ“ quando um humano ganha (bots não snipam o prêmio).
        // Em sala SÃ“ de bots, avança pela conclusão dos próprios bots (senão a rodada travava em Kuadra).
        // Em ambos os casos, bots NÃƒO recebem prêmio nem entram no Hall da Fama.
        const phaseKey = engine.PHASE_SEQUENCE[room.currentPhaseIndex];
        const salaTemHumanos = Array.from(room.players.values()).some(p => !p.isBot && p.cards && p.cards.length > 0);
        let jaTemVencedor = false;
        room.players.forEach(p => {
            if (p.isBot && salaTemHumanos) return; // com humanos na sala, só humanos avançam a fase
            (p.cards || []).forEach(c => {
                engine.computeCardAwards(c, room.currentPhaseIndex, room.drawnBalls);
                if (c.awards && c.awards[phaseKey]) jaTemVencedor = true;
            });
        });
        if (jaTemVencedor) {
            room.phasePauseTimer = setTimeout(() => {
                room.phasePauseTimer = null;
                if (room.currentPhaseIndex < engine.PHASE_SEQUENCE.length - 1) {
                    avancarParaProximaFase(room);
                } else {
                    finalizarRodada(room);
                }
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
            const humanCards = playersArr.filter(p => !p.isBot).reduce((sum, p) => sum + (p.cards ? p.cards.length : 0), 0);
            const { results, isJackpot } = engine.processPhaseWinners(winners, phaseKey, room.drawnBalls, humanCards, room.jackpot);

            // Update persistent chips/winnings (cache instantâneo, sync em background)
            // Bots ganham no jogo (fichas/banner) para dar vida à sala, mas NÃƒO vão para o
            // ledger de saque nem para o Hall da Fama (não podem sacar).
            for (const r of results) {
                const player = r.player;
                if (player.isBot) continue; // bots não persistem no ledger de saque
                setChips(player.name, player.chips, player.winnings).catch(e => console.error('[GAME] Erro setChips winner:', e.message));
                const transacoes = db.getTransacoes();
                transacoes.push({
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    tipo: 'premio', nome: player.name, nomeExibicao: player.name, valor: r.totalReward / 1000,
                    data: new Date().toISOString(), detalhe: `Prêmio ${phaseKey}`
                });
                db.setTransacoes(transacoes).catch(e => console.error('[GAME] Erro setTransacoes winner:', e.message));
            }
        
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
            winningBall: room.drawnBalls.length ? room.drawnBalls[room.drawnBalls.length - 1] : null,
            jackpotValue: isJackpot ? room.jackpot : 0
        });
        broadcast(room, { type: 'confetti' });
        
        room.jackpotAwarded = isJackpot;
        if (isJackpot) {
            const awardedPool = room.jackpot;
            room.jackpotAwardedValue = awardedPool;
            room.jackpot = engine.JACKPOT_INITIAL;
            room.jackpotAwarded = false;
            room.totalCardsAtStart = Array.from(room.players.values()).reduce((sum, p) => sum + (p.cards ? p.cards.length : 0), 0);
            broadcast(room, { type: 'jackpotUpdate', value: room.jackpot });
        }
        
        // Advance phase or end round
        if (room.currentPhaseIndex < engine.PHASE_SEQUENCE.length - 1) {
            avancarParaProximaFase(room);
        } else {
            // All phases done (keno finished) - end round
            await finalizarRodada(room);
        }
        return;
    }
    
    sendGameState(room);
    agendarProximoDraw(room);
    } catch (e) {
        console.error('[GAME] Erro em sortearProximaBola:', e.message, e.stack);
        agendarProximoDraw(room, 1000);
    }
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

async function salvarHistoricoSorteio(room) {
    if (room.currentRound === 0) return;
    const vencedores = { kuadra: [], kina: [], keno: [] };
    room.players.forEach(player => {
        (player.cards || []).forEach(card => {
            if (card.awards.kuadra) vencedores.kuadra.push({ nome: player.name, premio: engine.PHASES.kuadra.reward });
            if (card.awards.kina) vencedores.kina.push({ nome: player.name, premio: engine.PHASES.kina.reward });
            if (card.awards.keno) {
                // Jackpot agora pode ser de humanos OU bots (transparência). Registra para todos.
                const jackpot = room.jackpotAwarded ? (room.jackpotAwardedValue || 0) : 0;
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
    await db.setHistorico(historico);
    addLog(room, `📋 Sorteio #${room.currentRound} salvo no histórico.`);
}

async function finalizarRodada(room) {
    room.gameActive = false;
    room.gameEnded = true;
    pararWatchdog(room);
    if (room.drawTimer) { clearTimeout(room.drawTimer); room.drawTimer = null; }
    if (room.phasePauseTimer) { clearTimeout(room.phasePauseTimer); room.phasePauseTimer = null; }
    
    await salvarHistoricoSorteio(room);
    sendGameState(room);
    addLog(room, '🏁 Rodada encerrada!');
    broadcast(room, { type: 'notice', text: '🏁 Rodada encerrada! Cartelas serão limpas...', kind: 'info' });
    
    // After 10s, clear cards and restart auto-start
    setTimeout(async () => {
        if (room.gameActive) return;
        // Clear all cards, refund humans
        for (const p of room.players.values()) {
            const qtd = p.cards ? p.cards.length : 0;
            if (!p.isBot && qtd > 0) {
                p.chips += qtd * engine.CARD_COST;
                await setChips(p.name, p.chips, p.winnings);
            }
            p.cards = [];
        }
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
        addLog(room, `â†© Bola ${removed} desfeita.`);
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
        room.gameActive = snap.gameActive === true;
        room.gameEnded = snap.gameEnded === true;
        room.currentRound = snap.currentRound || 0;
        room.jackpot = snap.jackpot || engine.JACKPOT_INITIAL;
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

async function creditarFichas(nome, fichas) {
    console.log(`[CREDITO] Adicionando ${fichas} credits para ${nome}`);
    
    const c = getChips(nome);
    const novosFichas = c.chips + Math.round(fichas);
    await setChips(nome, novosFichas, c.winnings);
    
    gameRooms.forEach(room => {
        const player = Array.from(room.players.values()).find(p => 
            !p.isBot && (p.name || '').toLowerCase().trim() === (nome || '').toLowerCase().trim()
        );
        if (player) {
            player.chips = novosFichas;
            player.winnings = c.winnings;
            console.log(`[CREDITO] ${nome}: chips ${c.chips} â†’ ${novosFichas}`);
            broadcast(room, {
                type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
            });
        }
    });
}

async function liquidarComprasSala(sala) {
    try {
        const compras = db.getComprasPendentes();
        let changed = false;
        for (const c of compras) {
            if (c.sala === sala && c.status === 'pendente') { c.status = 'liquidada'; changed = true; }
        }
        if (changed) await db.setComprasPendentes(compras);
    } catch (e) {
        console.error('[COMPRA] Erro ao liquidar compras da sala:', e.message);
    }
}

async function reembolsarComprasPendentes() {
    try {
        const compras = db.getComprasPendentes();
        const pendentes = compras.filter(c => c.status === 'pendente');
        if (pendentes.length === 0) { console.log('[REEMBOLSO] Nenhuma compra pendente para reembolsar.'); return; }
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        for (const c of pendentes) {
            const u = usuariosArray.find(x => (x.nomeCompleto || '').toLowerCase().trim() === String(c.nome).toLowerCase().trim());
            if (u && u.isBot) { c.status = 'cancelada'; continue; }
            const chipsAtuais = getChips(c.nome);
            await setChips(c.nome, chipsAtuais.chips + c.custo, chipsAtuais.winnings);
            c.status = 'reembolsada';
            console.log(`[REEMBOLSO] Jogador ${c.nome} recebeu ${c.custo} fichas (cartelas de rodada interrompida)`);
        }
        await db.setComprasPendentes(compras);
        console.log(`[REEMBOLSO] ${pendentes.length} compra(s) pendente(s) reembolsada(s).`);
    } catch (e) {
        console.error('[REEMBOLSO] Erro:', e.message);
    }
}

async function handleAction(ws, room, action, payload) {
    try {
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
        const botNamesList = BOT_NAMES;
        
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
            // Jogador NÃƒO está na sala: atualizar apenas stores
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
            await setAdminCreditos(targetName, adminCreditosFinais);
            await setChips(targetName, isInRoom ? target.chips : fichas.chips, isInRoom ? target.winnings : (fichasStore[key]?.winnings || 0));

            // Notifica o admin (Marcos) sobre o crédito/admin concedido/removido
            try {
                const valorReaisCred = amount / 1000;
                const operacao = payload.mode === 'remove' ? 'removido' : 'concedido';
                await enviarEmailAdmin(
                    'Crédito admin ' + operacao,
                    '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + targetName + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Valor ' + operacao + '</p><p style="font-size:20px;color:#3b82f6;font-weight:bold;margin:0">R$ ' + valorReaisCred.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Operação</p><p style="font-size:14px;color:#222;margin:0">' + (payload.mode === 'remove' ? 'Remoção de crédito' : 'Adição de crédito') + '</p></div>',
                    'CRÃ‰DITO ADMIN'
                );
            } catch (e) { console.error('[EMAIL] Falha ao notificar crédito admin:', e.message); }

            // Notifica o PRÃ“PRIO JOGADOR sobre o crÃ©dito recebido/removido
            try {
                const usuariosCred = carregarUsuarios();
                const listaCred = Array.isArray(usuariosCred) ? usuariosCred : Object.values(usuariosCred);
                const cpfAlvo = (payload.targetCpf ? String(payload.targetCpf).replace(/\D/g, '').padStart(11, '0') : '') ||
                                (target && target.cpf ? String(target.cpf).replace(/\D/g, '').padStart(11, '0') : '') ||
                                (payload.targetId && /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(payload.targetId) ? payload.targetId.replace(/\D/g, '').padStart(11, '0') : '');
                const nomeAlvoNorm = (targetName || payload.targetId || '').toLowerCase().trim();
                const uCred = listaCred.find(u =>
                    (cpfAlvo && String(u.cpf).replace(/\D/g, '').padStart(11, '0') === cpfAlvo) ||
                    (u.nomeCompleto || '').toLowerCase().trim() === nomeAlvoNorm ||
                    (nomeAlvoNorm && (u.nomeCompleto || '').toLowerCase().includes(nomeAlvoNorm))
                );
                console.log('[CREDITO EMAIL] targetName=', targetName, 'cpfAlvo=', cpfAlvo, 'achouUsuario=', !!uCred, 'email=', uCred ? uCred.email : null);
                if (uCred && uCred.email) {
                    const valorReaisCred = amount / 1000;
                    const operacao = payload.mode === 'remove' ? 'removido' : 'creditado';
                    const htmlCred = `
                        <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
                            <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                                <div style="background:#0a0a2e;text-align:center;padding:22px 16px"><div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div></div>
                                <div style="padding:28px 24px">
                                    <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Olá ${targetName},</div>
                                    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Um crédito de <strong style="color:#3b82f6">R$ ${valorReaisCred.toFixed(2).replace('.', ',')}</strong> em fichas foi ${operacao} na sua conta pela administração.</p>
                                    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px 0">Acesse sua conta para conferir o saldo atualizado.</p>
                                    <div style="text-align:center"><a href="${SITE_URL}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Acessar minha conta</a></div>
                                </div>
                            </div>
                        </div>`;
                    await notificarJogador(targetName, uCred.email, 'Crédito de R$ ' + valorReaisCred.toFixed(2).replace('.', ',') + ' na sua conta', htmlCred);
                }
            } catch (e) { console.error('[EMAIL] Falha ao notificar jogador (crédito):', e.message); }
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
        // Jackpot progressivo: só CARTELAS HUMANAS alimentam o poço (dinheiro real do depósito).
        // Bots NÃƒO contribuem (suas fichas são de brincadeira). Teto de segurança JACKPOT_MAX.
        if (!player.isBot) {
            const base = (typeof room.jackpot === 'number' && room.jackpot > 0) ? room.jackpot : engine.JACKPOT_INITIAL;
            room.jackpot = Math.min(base + qty * engine.JACKPOT_CONTRIBUTION_PER_CARD, engine.JACKPOT_MAX);
        }
        for (let i = 0; i < qty; i++) player.cards.push(engine.generateBingoCardData());
        await setChips(player.name, player.chips, player.winnings);
        try {
            const key = player.name.toLowerCase().trim();
            const bonusStore = db.getBonusGivenStore();
            if (bonusStore[key]) {
                const gasto = Math.min(bonusStore[key], cost);
                if (gasto > 0) {
                    bonusStore[key] -= gasto;
                    await db.setBonusGivenStore(bonusStore);
                }
            }
        } catch (e) {
            console.error('[BONUS] Erro ao descontar bônus gasto em cartelas:', e.message);
        }
        try {
            const compras = db.getComprasPendentes();
            compras.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                nome: player.name,
                sala: room.id,
                rodada: room.currentRound,
                qty,
                custo: cost,
                status: 'pendente'
            });
            await db.setComprasPendentes(compras);
        } catch (e) {
            console.error('[COMPRA] Erro ao registrar compra pendente:', e.message);
        }
        sendGameState(room, ws);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'buySuccess', qty, chips: player.chips }));
        return;
    }

    if (action === 'resetGame') {
        if (room.gameActive) return;
        pararAutoStartServer(room);
        for (const p of room.players.values()) {
            const qtd = p.cards ? p.cards.length : 0;
            if (!p.isBot && qtd > 0) { p.chips += qtd * engine.CARD_COST; await setChips(p.name, p.chips, p.winnings); }
            p.cards = [];
        }
        liquidarComprasSala(room.id);
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
    } catch (err) {
        console.error('[ACTION ERRO]', err.message, err.stack);
    }
}

wss.on('connection', (ws) => {
    ws.clientId = null;
    ws.role = null;
    ws.roomId = null;
    ws.cpf = null;

    ws.on('message', async (message) => {
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
            ws.send(JSON.stringify({ type: 'connected', role: finalRole, roomId, id: clientId, dono: isAuth ? dono : false, modoTeste: modoTesteSaque }));
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
            await handleAction(ws, room, action, payload);
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

// Alteramos para "async (req, res)" para o servidor conseguir enviar o e-mail sem travar o jogo
app.post('/api/register', async (req, res) => {
    try {
        let { nomeCompleto, cpf, email, senha, chavePix, fingerprint } = req.body;
        if (!nomeCompleto || !cpf || !email || !senha || !chavePix) {
            return res.status(400).json({ error: 'Preencha todos os campos.' });
        }
        nomeCompleto = sanitizeText(nomeCompleto, 60);
        if (!nomeCompleto) {
            return res.status(400).json({ error: 'Nome inválido.' });
        }
        const cpfNormalizado = normalizeCpf(cpf);
        if (!cpfNormalizado) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        cpf = cpfNormalizado;
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
            fingerprint: fingerprint ? sanitizeText(String(fingerprint), 128) : null,
            sessionToken: crypto.randomBytes(24).toString('hex'),
            data: new Date().toISOString()
        };
        usuarios.push(novoUsuario);
        await salvarUsuarios(usuarios);

        // 1ï¸âƒ£ RESPONDE O JOGADOR IMEDIATAMENTE (Entra na tela sem travar!)
        res.json({ success: true, sessionToken: novoUsuario.sessionToken, cpf, nome: nomeCompleto });
        console.log(`[REGISTER] ${nomeCompleto} (${novoUsuario.cpfFormatado}) - Conta criada`);

        // 2ï¸âƒ£ DISPARA O E-MAIL EM SEGUNDO PLANO
        setImmediate(() => {
            enviarEmailAdmin(
                'Novo jogador cadastrado',
                '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Nome</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + (nomeCompleto || '') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">E-mail</p><p style="font-size:15px;color:#222;margin:0">' + (email || 'não informado') + '</p></div>',
                'NOVO CADASTRO'
            ).catch(err => {
                console.error('Erro na fila de execução do e-mail:', err.message);
            });

            // E-mail de boas-vindas para o PRÃ“PRIO JOGADOR
            try {
                const htmlBoasVindas = `
                    <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
                        <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                            <div style="background:#0a0a2e;text-align:center;padding:22px 16px"><div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div></div>
                            <div style="padding:28px 24px">
                                <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Bem-vindo(a), ${nomeCompleto}!</div>
                                <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Sua conta foi criada com sucesso. Você já pode entrar nas salas de bingo, comprar cartelas e concorrer a prêmios.</p>
                                <div style="text-align:center"><a href="${SITE_URL}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Entrar no Bingo</a></div>
                            </div>
                        </div>
                    </div>`;
                notificarJogador(nomeCompleto, email, 'Bem-vindo ao BingoVipClub! Sua conta foi criada', htmlBoasVindas).catch(() => {});
            } catch (e) { console.error('[EMAIL] Falha ao notificar jogador (cadastro):', e.message); }
        });

    } catch (err) {
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        console.log('-> Dados recebidos no login:', req.body);
        let { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ error: 'CPF e senha são obrigatórios.' });
        }
        const cpfNormalizado = normalizeCpf(cpf);
        if (!cpfNormalizado) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        cpf = cpfNormalizado;
        console.log('-> CPF limpo para busca:', cpf);
        senha = String(senha);
        const usuarios = carregarUsuarios();
        const user = usuarios.find(u => String(u.cpf).padStart(11, '0') === cpf && u.senha === senha);
        if (!user) {
            return res.status(400).json({ error: 'CPF ou senha incorretos.' });
        }
        const sessionToken = crypto.randomBytes(24).toString('hex');
        user.sessionToken = sessionToken;
        await salvarUsuarios(usuarios);
        console.log(`[LOGIN] ${user.nomeCompleto} (${user.cpfFormatado})`);
        res.json({ success: true, sessionToken, nome: user.nomeCompleto, cpf });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// ===================== APIs =====================

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

// ===================== AUTENTICAÃ‡ÃƒO DE ADMIN =====================
// Todas as rotas /api/admin/* exigem o cabeçalho x-admin-token igual a
// process.env.ADMIN_SENHA (definida no painel do Render). Sem isso -> 401.
function verificarAdmin(req, res, next) {
    const senha = req.headers['x-admin-token'];
    if (!senha || senha !== process.env.ADMIN_SENHA) {
        return res.status(401).json({ erro: 'Acesso negado: senha mestre inválida.' });
    }
    next();
}
app.use('/api/admin', verificarAdmin);

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
        const bonusGivenStore = db.getBonusGivenStore();
        const usuarios = carregarUsuarios();
        const usuariosComSaldo = usuarios.map(u => {
            const key = (u.nomeCompleto || '').toLowerCase().trim();
            const fichas = fichasStore[key] || { chips: engine.INITIAL_CHIPS, winnings: 0 };
            const adminCreditos = adminCreditsStore[key] || 0;
            const bonusGiven = bonusGivenStore[key] || 0;
            const depositos = Math.max(0, fichas.chips - fichas.winnings - adminCreditos - bonusGiven);
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
                bonusGiven: bonusGiven,
                depositos: depositos,
                isBot: false
            };
        });

        const botNames = BOT_NAMES;

        botNames.forEach(name => {
            const key = 'bot-' + name.toLowerCase().replace(/\s+/g, '-');
            const fichas = fichasStore[key] || { chips: engine.BOT_INITIAL_CHIPS, winnings: 0 };
            const adminCreditos = adminCreditsStore[key] || 0;
            const bonusGiven = bonusGivenStore[key] || 0;
            const depositos = Math.max(0, fichas.chips - fichas.winnings - adminCreditos - bonusGiven);
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
                bonusGiven: bonusGiven,
                depositos: depositos,
                isBot: true
            });
        });

        res.json(usuariosComSaldo);
    } catch (err) {
        console.error('[API] Erro ao buscar usuários com saldo:', err);
        res.json([]);
    }
});

// Admin - Dar bônus de fichas para usuário
app.post('/api/admin/usuario/bonus', async (req, res) => {
    try {
        const { cpf, nome, bonus } = req.body;
        if ((!cpf && !nome) || !bonus || bonus <= 0) {
            return res.status(400).json({ error: 'Identificador (CPF ou nome) e bônus válido são obrigatórios.' });
        }
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        let usuario = null;
        if (cpf) {
            const cpfLimpo = String(cpf).replace(/\D/g, '').padStart(11, '0');
            usuario = usuariosArray.find(u => String(u.cpf).padStart(11, '0') === cpfLimpo);
        } else {
            const key = String(nome).toLowerCase().trim();
            usuario = usuariosArray.find(u => (u.nomeCompleto || '').toLowerCase().trim() === key);
        }
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        if (usuario.isBot) {
            return res.status(400).json({ error: 'Não é possível conceder bônus a bots.' });
        }

        const key = usuario.nomeCompleto.toLowerCase().trim();
        const fichasStore = db.getFichasStore();
        if (!fichasStore[key]) {
            fichasStore[key] = { chips: engine.INITIAL_CHIPS, winnings: 0 };
        }
        fichasStore[key].chips += parseInt(bonus);
        await db.setFichasStore(fichasStore);

        // Track bonus given separately (not sacável em modo normal)
        const bonusGivenStore = db.getBonusGivenStore();
        bonusGivenStore[key] = (bonusGivenStore[key] || 0) + parseInt(bonus);
        await db.setBonusGivenStore(bonusGivenStore);

        // Sincroniza jogador conectado na sala para que possa gastar o bônus em cartelas
        gameRooms.forEach(room => {
            const player = Array.from(room.players.values()).find(p =>
                !p.isBot && (p.name || '').toLowerCase().trim() === key
            );
            if (player) {
                player.chips = fichasStore[key].chips;
                broadcast(room, {
                    type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                    currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                    currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
                });
            }
        });

        console.log(`[BONUS] ${bonus} fichas concedidas para ${usuario.nomeCompleto} via painel admin`);

        const valorReaisBonus = parseInt(bonus) / 1000;
        if (usuario.email) {
            enviarEmailBonus(usuario.nomeCompleto, usuario.email, valorReaisBonus);
        }

        // Notifica o admin (Marcos) sobre o bônus concedido
        try {
            await enviarEmailAdmin(
                'Bônus concedido',
                '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + (usuario.nomeCompleto || '') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Bônus creditado</p><p style="font-size:20px;color:#10b981;font-weight:bold;margin:0">R$ ' + valorReaisBonus.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Email do jogador</p><p style="font-size:14px;color:#222;margin:0">' + (usuario.email || 'não informado') + '</p></div>',
                'BÃ”NUS CONCEDIDO'
            );
        } catch (e) { console.error('[EMAIL] Falha ao notificar bônus:', e.message); }

        res.json({ success: true, bonusConcedido: parseInt(bonus), novoSaldo: fichasStore[key].chips, emailEnviado: !!usuario.email, emailUsuario: usuario.email || null });
    } catch (err) {
        console.error('[API] Erro ao conceder bônus:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Admin - Dar crédito admin (sacável) para usuário - MESMA LÓGICA DO BÔNUS (acha por CPF/nome no banco)
app.post('/api/admin/usuario/credito', async (req, res) => {
    try {
        const { cpf, nome, credito, mode } = req.body;
        const valor = parseInt(credito || req.body.valor || 0, 10);
        if ((!cpf && !nome) || !valor || valor <= 0) {
            return res.status(400).json({ error: 'Identificador (CPF ou nome) e crédito válido são obrigatórios.' });
        }
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        let usuario = null;
        if (cpf) {
            const cpfLimpo = String(cpf).replace(/\D/g, '').padStart(11, '0');
            usuario = usuariosArray.find(u => String(u.cpf).replace(/\D/g, '').padStart(11, '0') === cpfLimpo);
        } else {
            const key = String(nome).toLowerCase().trim();
            usuario = usuariosArray.find(u => (u.nomeCompleto || '').toLowerCase().trim() === key);
        }
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const key = usuario.nomeCompleto.toLowerCase().trim();
        const fichasStore = db.getFichasStore();
        if (!fichasStore[key]) {
            fichasStore[key] = { chips: engine.INITIAL_CHIPS, winnings: 0 };
        }
        const operacao = mode === 'remove' ? 'remover' : 'add';
        if (operacao === 'remove') {
            fichasStore[key].chips = Math.max(0, fichasStore[key].chips - valor);
        } else {
            fichasStore[key].chips += valor;
        }
        await db.setFichasStore(fichasStore);

        const adminCreditsStore = db.getAdminCreditsStore();
        const atual = adminCreditsStore[key] || 0;
        adminCreditsStore[key] = operacao === 'remove' ? Math.max(0, atual - valor) : atual + valor;
        await db.setAdminCreditsStore(adminCreditsStore);

        // Sincroniza jogador conectado na sala
        gameRooms.forEach(room => {
            const player = Array.from(room.players.values()).find(p =>
                !p.isBot && (p.name || '').toLowerCase().trim() === key
            );
            if (player) {
                player.chips = fichasStore[key].chips;
                player.adminCredits = adminCreditsStore[key];
                broadcast(room, {
                    type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                    currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                    currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
                });
            }
        });

        console.log(`[CREDITO] ${valor} fichas (admin) ${operacao === 'remove' ? 'removidas' : 'concedidas'} para ${usuario.nomeCompleto} via painel admin`);

        // Notifica o PRÓPRIO JOGADOR (email direcionado ao cadastro dele)
        const valorReais = valor / 1000;
        if (usuario.email) {
            const operacaoTxt = operacao === 'remove' ? 'removido' : 'creditado';
            const htmlCred = `
                <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
                    <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                        <div style="background:#0a0a2e;text-align:center;padding:22px 16px"><div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div></div>
                        <div style="padding:28px 24px">
                            <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Olá ${usuario.nomeCompleto},</div>
                            <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Um crédito de <strong style="color:#3b82f6">R$ ${valorReais.toFixed(2).replace('.', ',')}</strong> em fichas foi ${operacaoTxt} na sua conta pela administração.</p>
                            <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 20px 0">Acesse sua conta para conferir o saldo atualizado.</p>
                            <div style="text-align:center"><a href="${SITE_URL}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Acessar minha conta</a></div>
                        </div>
                    </div>
                </div>`;
            await notificarJogador(usuario.nomeCompleto, usuario.email, 'Crédito de R$ ' + valorReais.toFixed(2).replace('.', ',') + ' na sua conta', htmlCred);
        }

        // Notifica o admin (Marcos)
        try {
            await enviarEmailAdmin(
                'Crédito admin ' + (operacao === 'remove' ? 'removido' : 'concedido'),
                '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + (usuario.nomeCompleto || '') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Crédito ' + (operacao === 'remove' ? 'removido' : 'concedido') + '</p><p style="font-size:20px;color:#3b82f6;font-weight:bold;margin:0">R$ ' + valorReais.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Email do jogador</p><p style="font-size:14px;color:#222;margin:0">' + (usuario.email || 'não informado') + '</p></div>',
                'CRÃ‰DITO ADMIN'
            );
        } catch (e) { console.error('[EMAIL] Falha ao notificar crédito admin:', e.message); }

        res.json({ success: true, creditoConcedido: valor, modo: operacao, novoSaldo: fichasStore[key].chips, emailEnviado: !!usuario.email, emailUsuario: usuario.email || null });
    } catch (err) {
        console.error('[API] Erro ao conceder crédito:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Admin - Retirar (remover) bônus de fichas do usuário
app.post('/api/admin/usuario/remover-bonus', async (req, res) => {
    try {
        const { cpf, nome, bonus } = req.body;
        if ((!cpf && !nome) || !bonus || bonus <= 0) {
            return res.status(400).json({ error: 'Identificador (CPF ou nome) e bônus válido são obrigatórios.' });
        }
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        let usuario = null;
        if (cpf) {
            const cpfLimpo = String(cpf).replace(/\D/g, '').padStart(11, '0');
            usuario = usuariosArray.find(u => String(u.cpf).padStart(11, '0') === cpfLimpo);
        } else {
            const key = String(nome).toLowerCase().trim();
            usuario = usuariosArray.find(u => (u.nomeCompleto || '').toLowerCase().trim() === key);
        }
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const key = usuario.nomeCompleto.toLowerCase().trim();
        const fichasStore = db.getFichasStore();
        if (!fichasStore[key]) fichasStore[key] = { chips: engine.INITIAL_CHIPS, winnings: 0 };
        const bonusGivenStore = db.getBonusGivenStore();
        const atual = bonusGivenStore[key] || 0;
        const remover = Math.min(atual, parseInt(bonus));
        bonusGivenStore[key] = atual - remover;
        await db.setBonusGivenStore(bonusGivenStore);

        // Reflete a remoção também no saldo total (chips)
        fichasStore[key].chips = Math.max(0, fichasStore[key].chips - remover);
        await db.setFichasStore(fichasStore);

        // Sincroniza jogador conectado na sala
        gameRooms.forEach(room => {
            const player = Array.from(room.players.values()).find(p =>
                !p.isBot && (p.name || '').toLowerCase().trim() === key
            );
            if (player) {
                player.chips = fichasStore[key].chips;
                broadcast(room, {
                    type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                    currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                    currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
                });
            }
        });

        console.log(`[BONUS] Removido ${remover} fichas de bônus de ${usuario.nomeCompleto} via painel admin`);
        res.json({ success: true, bonusRemovido: remover, bonusRestante: bonusGivenStore[key], novoSaldo: fichasStore[key].chips });
    } catch (err) {
        console.error('[API] Erro ao remover bônus:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Buscar fichas do usuário (para sincronização com servidor)
app.get('/api/fichas/:cpf', (req, res) => {
    try {
        const cpf = String(req.params.cpf).replace(/\D/g, '').padStart(11, '0');
        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        const usuario = usuariosArray.find(u => String(u.cpf).padStart(11, '0') === cpf);
        if (!usuario) {
            return res.json({ chips: 0, winnings: 0 });
        }
        const key = usuario.nomeCompleto.toLowerCase().trim();
        const fichasStore = db.getFichasStore();
        const fichas = fichasStore[key] || { chips: engine.INITIAL_CHIPS, winnings: 0 };
        res.json({ chips: fichas.chips, winnings: fichas.winnings });
    } catch (err) {
        res.json({ chips: 0, winnings: 0 });
    }
});

// Admin - Listar usuários com bônus já concedidos
app.get('/api/admin/usuarios-com-bonus', (req, res) => {
    try {
        const bonusGiven = db.getBonusGivenStore();
        res.json(Object.keys(bonusGiven));
    } catch (err) {
        res.json([]);
    }
});

// Admin - Editar senha ou chave PIX (versão simples)
app.post('/api/admin/usuarios/:cpf/edicao', async (req, res) => {
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
        } else if (campo === 'email') {
            usuario.email = valor;
        } else if (campo === 'nomeCompleto') {
            usuario.nomeCompleto = valor;
        }
        
        await salvarUsuarios(usuariosArray);
        res.json({ success: true, usuario });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Admin - Excluir usuário completamente (todos os dados)
app.delete('/api/admin/usuario/excluir', async (req, res) => {
    try {
        const { cpf } = req.body;
        if (!cpf) {
            return res.status(400).json({ error: 'CPF é obrigatório.' });
        }
        const cpfLimpo = String(cpf).replace(/\D/g, '').padStart(11, '0');

        const usuarios = carregarUsuarios();
        const usuariosArray = Array.isArray(usuarios) ? usuarios : Object.values(usuarios);
        const usuarioIdx = usuariosArray.findIndex(u => String(u.cpf).padStart(11, '0') === cpfLimpo);
        if (usuarioIdx === -1) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        const nomeUsuario = usuariosArray[usuarioIdx].nomeCompleto || usuariosArray[usuarioIdx].nome || '';
        const keyNome = (nomeUsuario || '').toLowerCase().trim();
        const keyBot = 'bot-' + keyNome.replace(/\s+/g, '-');
        await db.deleteUsuario(cpfLimpo);

        // Desconectar jogador deletado (essencial, feito antes de responder)
        try {
            let desconectado = false;
            const sessao = sessoesAtivas.get(cpfLimpo);
            if (sessao && sessao.ws && sessao.ws.readyState === WebSocket.OPEN) {
                try {
                    sessao.ws.send(JSON.stringify({
                        type: 'accountDeleted',
                        message: `Sua conta "${nomeUsuario}" foi removida pelo administrador. Você será desconectado.`
                    }));
                } catch (e) {}
                try { sessao.ws.close(); } catch (e) {}
                desconectado = true;
            }

            if (!desconectado) {
                for (const room of gameRooms) {
                    for (const [clientId, ws] of room.clients) {
                        try {
                            if (ws.nome && ws.nome.toLowerCase().trim() === keyNome && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'accountDeleted',
                                    message: `Sua conta "${nomeUsuario}" foi removida pelo administrador. Você será desconectado.`
                                }));
                                try { ws.close(); } catch (e) {}
                                console.log(`[ADMIN EXCLUIR] Jogador "${nomeUsuario}" desconectado via room.`);
                                desconectado = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    if (desconectado) break;
                }
            }

            if (sessao) sessoesAtivas.delete(cpfLimpo);
        } catch (e) {
            console.error('[ADMIN EXCLUIR] Erro ao forçar logout:', e.message);
        }

        console.log(`[ADMIN EXCLUIR] Usuário "${nomeUsuario}" (CPF: ${cpfLimpo}) excluído. Respondendo ao admin...`);

        // Responde imediatamente para a tela admin voltar na hora
        res.json({ success: true, message: `Usuário "${nomeUsuario}" excluído com sucesso. Todos os dados foram removidos.` });

        // Sincronizações pesadas em background (não bloqueiam a resposta)
        (async () => {
            try {
                const fichasStore = db.getFichasStore();
                if (fichasStore[keyNome]) delete fichasStore[keyNome];
                if (fichasStore[keyBot]) delete fichasStore[keyBot];
                await db.setFichasStore(fichasStore);

                const adminCreditsStore = db.getAdminCreditsStore();
                if (adminCreditsStore[keyNome]) delete adminCreditsStore[keyNome];
                if (adminCreditsStore[keyBot]) delete adminCreditsStore[keyBot];
                await db.setAdminCreditsStore(adminCreditsStore);

                const saques = db.getSaques();
                await db.setSaques(saques.filter(s => (s.nome || '').toLowerCase().trim() !== keyNome));

                const transacoes = db.getTransacoes();
                await db.setTransacoes(transacoes.filter(t => (t.nome || '').toLowerCase().trim() !== keyNome));

                const recargas = db.getRecargas();
                await db.setRecargas(recargas.filter(r => (r.nome || '').toLowerCase().trim() !== keyNome));

                console.log(`[ADMIN EXCLUIR] Limpeza de dados de "${nomeUsuario}" concluída em background.`);
            } catch (bgErr) {
                console.error('[ADMIN EXCLUIR] Erro em background:', bgErr);
            }
        })();
    } catch (err) {
        console.error('[ADMIN EXCLUIR] Erro:', err);
        res.status(500).json({ error: 'Erro interno ao excluir usuário.' });
    }
});

// Admin - Enviar PIX
app.post('/api/admin/enviar-pix', async (req, res) => {
    try {
        const { para, chavePix, valor, tipoChave, saqueId } = req.body;
        const saques = db.getSaques();
        
        let saqueExistente = saqueId
            ? saques.find(s => String(s.id) === String(saqueId))
            : saques.find(s => s.status === 'pendente' && s.nome === para && s.valor === valor);
        
        let asaasTransferId = null;
        if (chavePix && valor > 0) {
            if (!ASAAS_API_KEY) {
                console.log('[ASAAS] AVISO: ASAAS_API_KEY não definida no painel do Render. PIX automático não enviado.');
            } else {
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
        
        await db.setSaques(saques);
        res.json({ success: true, saque: saqueExistente, asaasTransferId });
    } catch (err) {
        console.error('[ASAAS] Erro enviar-pix:', err.message);
        res.status(500).json({ error: 'Erro ao enviar PIX.' });
    }
});

// Admin - Marcar saque como pago
app.post('/api/admin/saque-pago', async (req, res) => {
    try {
        const { saqueId } = req.body;
        const saques = db.getSaques();
        
        const saqueIndex = saques.findIndex(s => String(s.id) === String(saqueId));
        if (saqueIndex === -1) {
            return res.status(404).json({ error: 'Saque não encontrado.' });
        }
        
        saques[saqueIndex].status = 'pago';
        saques[saqueIndex].dataPagamento = new Date().toISOString();
        
        await db.setSaques(saques);
        res.json({ success: true, saque: saques[saqueIndex] });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao marcar saque como pago.' });
    }
});

// Wrapper para capturar erros de async handlers (Express 4 não pega automaticamente)
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
    console.error('[ERRO] Async handler:', err.message);
    res.status(500).json({ error: 'Erro interno no servidor.' });
});

app.post('/api/solicitar-saque', async (req, res) => {
 try {
    const { nome, valor, chavePix, tipoChave, sessionToken } = req.body;
    console.log('[SAQUE DEBUG] Recebido:', { nome, valor, chavePix, tipoChave, hasToken: !!sessionToken });
    if (!nome || !valor || !chavePix) {
        return res.status(400).json({ error: 'Parâmetros incompletos.' });
    }
    const valorValidado = validarValorSaque(valor);
    if (valorValidado === null) {
        return res.status(400).json({ error: 'Valor de saque inválido' });
    }
    valor = valorValidado;
    if (sessionToken) {
        const usuarios = carregarUsuarios();
        const user = usuarios.find(u => u.sessionToken === sessionToken && u.nomeCompleto === nome);
        console.log('[SAQUE DEBUG] user match:', user ? user.nomeCompleto : 'NÃƒO ENCONTRADO');
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

        // REGRA DE SAQUE:
        // SACAVEL = Creditos concedidos pelo admin + Premios ganhos (Kuadra/Kina/Keno/Jackpot)
        // NAO SACAVEL = Depositos e Bonus
        const saldoSacavel = adminCred + c.winnings;
        console.log('[SAQUE DEBUG] Balances:', { chips: c.chips, winnings: c.winnings, adminCred, saldoSacavel, fichasNecessarias });

        if (saldoSacavel < fichasNecessarias) {
            return res.status(400).json({ error: 'Saldo sacavel insuficiente. Podem ser sacados apenas: Creditos (admin) e Premios ganhos (Kuadra/Kina/Keno/Jackpot). Depositos e Bonus NAO podem ser sacados.' });
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
        await db.setSaques(saques);

        const transacoes = db.getTransacoes();
        transacoes.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            tipo: 'saque_pendente',
            nome,
            nomeExibicao: nome,
            valor,
            data: new Date().toISOString(),
            detalhe: `Saque solicitado - ${tipoChave || 'cpf'}: ${chavePix}`
        });
        await db.setTransacoes(transacoes);

        // Deducao do saldo sacavel (primeiro dos ganhos, depois dos creditos admin)
        const doWinnings = Math.min(c.winnings, fichasNecessarias);
        const doAdmin = fichasNecessarias - doWinnings;
        const novoChips = c.chips - fichasNecessarias;
        const novoWinnings = c.winnings - doWinnings;
        const novoAdminCred = adminCred - doAdmin;
        await setChips(nome, novoChips, novoWinnings);
        await setAdminCreditos(nome, novoAdminCred);

        // Notifica admin por email
        const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await enviarEmailAdmin(
            'Novo saque solicitado',
            '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + nome + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Valor</p><p style="font-size:20px;color:#10b981;font-weight:bold;margin:0">R$ ' + valor.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Chave PIX</p><p style="font-size:14px;color:#222;margin:0">' + chavePix + ' (' + (tipoChave || 'cpf') + ')</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Data</p><p style="font-size:14px;color:#222;margin:0">' + hora + '</p></div>',
            'SAQUE'
        );

        // Sincroniza com o jogador na sala (se estiver conectado) + broadcast
        gameRooms.forEach(room => {
            for (const p of room.players.values()) {
                if (p.name.toLowerCase().trim() === nome.toLowerCase().trim()) {
                    p.chips = novoChips;
                    p.winnings = Math.max(0, novoWinnings);
                    p.adminCredits = Math.max(0, novoAdminCred);
                    break;
                }
            }
            // Broadcast gameState atualizado para manter saldos em tempo real
            broadcast(room, {
                type: 'gameState', players: sanitizePlayers(room), drawnBalls: room.drawnBalls,
                currentPhaseIndex: room.currentPhaseIndex, gameActive: room.gameActive, gameEnded: room.gameEnded,
                currentRound: room.currentRound, jackpot: room.jackpot, autoStartSeconds: room.autoStartSeconds
            });
            const notif = JSON.stringify({ type: 'relay', from: 'host', id: 'server', name: 'Servidor', data: { type: 'saqueNotificacao', nome, valor } });
            room.clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) ws.send(notif);
            });
        });
        console.log(`[SAQUE] ${nome} solicitou saque de R$ ${valor.toFixed(2)} via ${tipoChave || 'cpf'}: ${chavePix}`);

        res.json({ success: true, saqueId: novoSaque.id });
    } catch (err) {
        console.error('[SAQUE ERRO]', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Erro ao processar saque.', detalhe: err && err.message ? err.message : String(err) });
    }
});

// Rota de teste para verificar email (admin)
app.post('/api/admin/testar-email', async (req, res) => {
    try {
        await enviarEmailNotificacao(
            '🔧 Teste de Email - Bingo Master Pro',
            `Este é um email de teste.\n\nSe você está recebendo esta mensagem, a configuração de email está funcionando corretamente!\n\nData: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        );
        res.json({ success: true, message: 'Email de teste enviado para ' + ADMIN_EMAIL });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao enviar email de teste: ' + err.message });
    }
});

// ===================== MANUTENÇÃO PROGRAMADA =====================
app.post('/api/admin/manutencao', async (req, res) => {
    try {
        const { data, horario, mensagem, ativo } = req.body;
        await db.setManutencao(data || '', horario || '', mensagem || '', ativo);
        console.log('[MANUTENCAO] Configurada: ativo=' + ativo + ' data=' + data + ' horario=' + horario);
        res.json({ success: true, manutencao: db.getManutencao() });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar manutenção: ' + err.message });
    }
});

app.get('/api/manutencao', (req, res) => {
    res.json(db.getManutencao());
});

app.get('/api/admin/testar-asaas', async (req, res) => {
    try {
        if (!ASAAS_API_KEY) {
            return res.json({ success: false, message: 'ASAAS_API_KEY não configurada nas variáveis de ambiente do Render.' });
        }
        const search = await asaasRequest('GET', '/finance/balance');
        if (search && search.balance !== undefined) {
            res.json({ success: true, message: 'Conectado! Saldo Asaas: R$ ' + Number(search.balance).toFixed(2) });
        } else {
            res.json({ success: false, message: 'Resposta inesperada: ' + JSON.stringify(search).slice(0, 200) });
        }
    } catch (err) {
        res.json({ success: false, message: 'Erro: ' + err.message });
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
async function saveAdminCreditos() {
    await db.syncAdminCreditsStore();
}

let adminCreditsStore = {};
let bonusGivenStore = {};
let modoTesteSaque = false;

function getAdminCreditos(nome) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    return adminCreditsStore[key] || 0;
}
async function setAdminCreditos(nome, valor) {
    const key = (nome || '').toLowerCase().trim().normalize('NFC');
    adminCreditsStore[key] = Math.max(0, Math.round(valor));
    await saveAdminCreditos();
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
        const req = https.request(options, (r) => {
            let responseBody = '';
            r.on('data', chunk => responseBody += chunk);
            r.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(responseBody); } catch (e) { parsed = { raw: responseBody }; }
                if (r.statusCode >= 400) {
                    const msg = parsed && parsed.errors ? JSON.stringify(parsed.errors) : (responseBody || ('HTTP ' + r.statusCode));
                    return reject(new Error('Asaas HTTP ' + r.statusCode + ': ' + msg));
                }
                resolve(parsed);
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
    const search = await asaasRequest('GET', `/customers?cpfCnpj=${cpf}`);
    if (search && search.data && search.data.length > 0) {
        asaasCustomerCache.set(cpf, search.data[0].id);
        return search.data[0].id;
    }

    const customer = await asaasRequest('POST', '/customers', {
        name: nome,
        cpfCnpj: cpf,
        email: email
    });

    if (customer && customer.id) {
        asaasCustomerCache.set(cpf, customer.id);
        return customer.id;
    }
    throw new Error('Asaas não retornou id do cliente: ' + JSON.stringify(customer));
}

// Deposito - Criar PIX
// Registra o mapeamento paymentId -> jogador para o webhook do Asaas confirmar o depósito
function registrarRecargaPendente(nome, cpf, valor, paymentId) {
    try {
        const recargas = db.getRecargas();
        recargas.push({
            nome: nome || '',
            cpf: cpf ? String(cpf).replace(/\D/g, '').padStart(11, '0') : '',
            valor,
            paymentId,
            sincronizado: false,
            origem: 'asaas',
            data: new Date().toISOString()
        });
        db.setRecargas(recargas);
    } catch (e) {
        console.error('[RECARGA] Erro ao registrar mapeamento:', e.message);
    }
}

app.post('/api/criar-pix', async (req, res) => {
    try {
        const { valor, nome, cpf, email } = req.body;
        if (!valor || valor < 0.50) {
            return res.status(400).json({ error: 'Valor mínimo: R$0,50' });
        }
        if (!ASAAS_API_KEY) {
            const paymentId = 'sim_' + Date.now();
            registrarRecargaPendente(nome, cpf, valor, paymentId);
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
            registrarRecargaPendente(nome, cpfLimpo, valor, payment.id);
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
            // Notifica o admin de que um jogador gerou um PIX
            try {
                const horaPix = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                await enviarEmailAdmin(
                    'Novo PIX gerado',
                    '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + nome + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Valor</p><p style="font-size:20px;color:#10b981;font-weight:bold;margin:0">R$ ' + valor.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">CPF</p><p style="font-size:14px;color:#222;margin:0">' + cpfLimpo + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Email</p><p style="font-size:14px;color:#222;margin:0">' + (email || 'não informado') + '</p></div>',
                    'NOVO PIX'
                );
            } catch (e) {
                console.error('[EMAIL] Falha ao notificar PIX gerado:', e.message);
            }

            // Notifica o PRÃ“PRIO JOGADOR de que o PIX foi gerado
            try {
                if (email) {
                    const htmlPix = `
                        <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
                            <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                                <div style="background:#0a0a2e;text-align:center;padding:22px 16px"><div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div></div>
                                <div style="padding:28px 24px">
                                    <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Olá ${nome},</div>
                                    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Seu PIX de <strong style="color:#10b981">R$ ${valor.toFixed(2).replace('.', ',')}</strong> para recarga foi gerado com sucesso.</p>
                                    <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 8px 0">Pague o código ou escaneie o QR Code no seu app do banco. Assim que o pagamento for confirmado, suas fichas caem na conta automaticamente.</p>
                                    <div style="text-align:center;margin:18px 0 4px"><a href="${SITE_URL}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Acessar minha conta</a></div>
                                </div>
                            </div>
                        </div>`;
                    await notificarJogador(nome, email, 'Seu PIX de R$ ' + valor.toFixed(2).replace('.', ',') + ' foi gerado', htmlPix);
                }
            } catch (e) { console.error('[EMAIL] Falha ao notificar jogador (PIX gerado):', e.message); }

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
        res.status(500).json({ error: 'Erro ao gerar PIX: ' + err.message });
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
// Lógica compartilhada de confirmação de recarga (usada pelo frontend e pelo webhook Asaas)
async function processarConfirmacaoRecarga(nome, valor, paymentId) {
    const fichas = Math.round(valor * 1000);

    // Idempotência: evita creditar 2x (webhook + polling do frontend)
    if (paymentId) {
        const recargas = db.getRecargas();
        const recarga = recargas.find(r => r.paymentId === paymentId);
        if (recarga && recarga.sincronizado) {
            return { success: true, jaCreditado: true, fichas: 0, bonusConcedido: 0, primeiroDeposito: false };
        }
    }

    // Bônus de 10% apenas no primeiro depósito (uma vez por usuário)
    const bonusStore = db.getBonusPrimeiroDeposito();
    const keyNome = (nome || '').toLowerCase().trim();
    const jaTemBonus = !!bonusStore[keyNome];
    const isBotRecarga = isNomeDeBot(keyNome);
    const bonus = (jaTemBonus || isBotRecarga) ? 0 : Math.round(fichas * 0.10);
    const totalFichas = fichas + bonus;

    const c = getChips(nome);
    await setChips(nome, c.chips + totalFichas, c.winnings);

    // Marcar que este usuário já recebeu bônus de primeiro depósito
    if (!jaTemBonus) {
        await db.setBonusPrimeiroDepositoJaUsado(nome);
    }

    gameRooms.forEach(room => {
        const player = Array.from(room.players.values()).find(p =>
            !p.isBot && (p.name || '').toLowerCase().trim() === keyNome
        );
        if (player) {
            player.chips = c.chips + totalFichas;
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
        id: Date.now() + Math.floor(Math.random() * 1000),
        tipo: 'deposito', nome, nomeExibicao: nome, valor,
        data: new Date().toISOString(),
        detalhe: paymentId ? `PIX: ${paymentId}` : 'Depósito manual'
    });
    await db.setTransacoes(transacoes);

    // Notifica o admin de depósito confirmado
    try {
        const horaDep = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await enviarEmailAdmin(
            'Depósito confirmado',
            '<div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Jogador</p><p style="font-size:16px;color:#222;font-weight:bold;margin:0">' + nome + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px;margin-bottom:8px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Valor depositado</p><p style="font-size:20px;color:#10b981;font-weight:bold;margin:0">R$ ' + valor.toFixed(2).replace('.', ',') + '</p></div><div style="background:#f7f8fc;border-radius:8px;padding:16px 18px"><p style="font-size:13px;color:#888;margin:0 0 4px 0">Data</p><p style="font-size:14px;color:#222;margin:0">' + horaDep + '</p></div>',
            'DEPÃ“SITO'
        );
    } catch (e) { console.error('[EMAIL] Falha ao notificar depósito:', e.message); }

    // Notifica o PRÃ“PRIO JOGADOR de que o depÃ³sito foi confirmado
    try {
        const usuariosDep = carregarUsuarios();
        const listaDep = Array.isArray(usuariosDep) ? usuariosDep : Object.values(usuariosDep);
        const uDep = listaDep.find(u => (u.nomeCompleto || '').toLowerCase().trim() === keyNome);
        if (uDep && uDep.email) {
            const valorFmt = valor.toFixed(2).replace('.', ',');
            const bonusFmt = (bonus / 1000).toFixed(2).replace('.', ',');
            const htmlDep = `
                <div style="background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;padding:24px">
                    <div style="background:#fff;max-width:520px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
                        <div style="background:#0a0a2e;text-align:center;padding:22px 16px"><div style="color:#ffd700;font-size:22px;font-weight:bold;letter-spacing:2px">BingoVipClub</div></div>
                        <div style="padding:28px 24px">
                            <div style="font-size:18px;color:#1a1a3c;margin:0 0 12px 0">Olá ${nome},</div>
                            <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px 0">Seu depósito de <strong style="color:#10b981">R$ ${valorFmt}</strong> foi confirmado e suas fichas já estão na sua conta${bonus > 0 ? ' (incluindo bônus de primeiro depósito de <strong style="color:#10b981">R$ ' + bonusFmt + '</strong>)' : ''}.</p>
                            <div style="text-align:center"><a href="${SITE_URL}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:13px 34px;border-radius:8px;font-weight:bold;font-size:15px">Acessar minha conta</a></div>
                        </div>
                    </div>
                </div>`;
            await notificarJogador(nome, uDep.email, 'Depósito de R$ ' + valorFmt + ' confirmado!', htmlDep);
        }
    } catch (e) { console.error('[EMAIL] Falha ao notificar jogador (depósito):', e.message); }

    // Marca a recarga como sincronizada (impede duplo crédito)
    if (paymentId) {
        const recargas = db.getRecargas();
        const recarga = recargas.find(r => r.paymentId === paymentId);
        if (recarga) {
            recarga.sincronizado = true;
            await db.setRecargas(recargas);
        }
    }

    return { success: true, fichas: totalFichas, bonusConcedido: bonus, primeiroDeposito: !jaTemBonus };
}

app.post('/api/confirmar-recarga', async (req, res) => {
    try {
        const { nome, valor, paymentId } = req.body;
        const r = await processarConfirmacaoRecarga(nome, valor, paymentId);
        res.json(r);
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
app.post('/api/registrar-premio', async (req, res) => {
    try {
        const { nome, valor, fase } = req.body;
        if (!nome || !valor) return res.json({ success: true });
        const transacoes = db.getTransacoes();
        transacoes.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            tipo: 'premio', nome, nomeExibicao: nome, valor,
            data: new Date().toISOString(),
            detalhe: `Prêmio ${fase || ''}`
        });
        await db.setTransacoes(transacoes);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

app.post('/api/sincronizar-recarga', async (req, res) => {
    try {
        const { paymentId } = req.body;
        if (!paymentId) return res.status(400).json({ error: 'paymentId obrigatório' });
        const recargas = db.getRecargas();
        const recarga = recargas.find(r => r.paymentId === paymentId);
        if (recarga) recarga.sincronizado = true;
        await db.setRecargas(recargas);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao sincronizar recarga.' });
    }
});

app.post('/api/salvar-historico', async (req, res) => {
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
        await db.setHistorico(historico);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar histórico.' });
    }
});

// ===================== HALL DA FAMA (histórico de ranking) =====================
app.get('/api/hall-da-fama', (req, res) => {
    try {
        const limite = Math.min(Math.max(parseInt(req.query.limite) || 20, 1), 50);
        const historico = db.getHistorico();
        const rodadas = historico
            .slice()
            .sort((a, b) => (b.numero || 0) - (a.numero || 0))
            .slice(0, limite)
            .map(h => {
                const v = h.vencedores || {};
                const normalizar = (arr) => (Array.isArray(arr) ? arr : []).map(x => ({
                    nome: x && x.nome ? x.nome : '',
                    premio: x && (x.premio !== undefined ? x.premio : 0)
                }));
                return {
                    numero: h.numero,
                    data: h.data || null,
                    vencedores: {
                        kuadra: normalizar(v.kuadra),
                        kina: normalizar(v.kina),
                        keno: normalizar(v.keno)
                    }
                };
            });
        res.json({ success: true, rodadas });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar hall da fama.' });
    }
});

// ===================== STATUS DE SAQUE DO JOGADOR =====================
app.get('/api/meus-saques', (req, res) => {
    try {
        const token = req.headers['x-session-token'];
        const usuarios = db.getUsuarios();
        const user = usuarios.find(u => u.sessionToken === token);
        if (!user) {
            return res.status(401).json({ error: 'Não autorizado.' });
        }
        const nomeLower = (user.nomeCompleto || '').toLowerCase().trim();
        const saques = db.getSaques()
            .filter(s => (s.nome || '').toLowerCase().trim() === nomeLower)
            .sort((a, b) => (b.id || 0) - (a.id || 0))
            .map(s => ({
                id: s.id,
                valor: s.valor,
                status: s.status,
                data: s.data,
                dataPagamento: s.dataPagamento || null
            }));
        res.json({ success: true, saques });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar saques.' });
    }
});

// ===================== ESTATÍSTICAS DO JOGADOR =====================
app.get('/api/minhas-estatisticas', (req, res) => {
    try {
        const token = req.headers['x-session-token'];
        const usuarios = db.getUsuarios();
        const user = usuarios.find(u => u.sessionToken === token);
        if (!user) {
            return res.status(401).json({ error: 'Não autorizado.' });
        }
        const nomeLower = (user.nomeCompleto || '').toLowerCase().trim();
        const historico = db.getHistorico();
        const vitorias = { kuadra: 0, kina: 0, keno: 0 };
        let premiosTotal = 0;
        historico.forEach(h => {
            const v = h.vencedores || {};
            ['kuadra', 'kina', 'keno'].forEach(fase => {
                const arr = Array.isArray(v[fase]) ? v[fase] : [];
                arr.forEach(x => {
                    if (x && (x.nome || '').toLowerCase().trim() === nomeLower) {
                        vitorias[fase] += 1;
                        const p = Number(x.premio);
                        if (isFinite(p)) premiosTotal += p;
                    }
                });
            });
        });
        const key = (user.nomeCompleto || '').toLowerCase().trim();
        const fichas = db.getFichasStore()[key] || { chips: 0, winnings: 0 };
        res.json({
            success: true,
            vitorias,
            premiosTotal,
            saldo: { chips: fichas.chips || 0, winnings: fichas.winnings || 0 }
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar estatísticas.' });
    }
});

// ===================== ANTI-FRAUDE: USUÁRIOS SUSPEITOS =====================
app.get('/api/admin/usuarios-suspeitos', (req, res) => {
    try {
        const usuarios = db.getUsuarios();
        const gruposMap = {};
        usuarios.forEach(u => {
            const fp = u.fingerprint;
            if (fp) {
                if (!gruposMap[fp]) gruposMap[fp] = [];
                gruposMap[fp].push({
                    nome: u.nomeCompleto,
                    cpf: u.cpf,
                    email: u.email,
                    data: u.data || null
                });
            }
        });
        const grupos = Object.keys(gruposMap)
            .filter(fp => gruposMap[fp].length > 1)
            .map(fp => ({ fingerprint: fp, contas: gruposMap[fp] }));
        res.json({ success: true, grupos });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar usuários suspeitos.' });
    }
});

// ===================== ASAAS WEBHOOK =====================
app.post('/api/asaas/webhook', express.json({ type: 'application/json' }), (req, res) => {
    try {
        const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
        if (webhookToken) {
            const h = req.headers || {};
            const provided = String(h['asaas-access-token'] || h['authorization'] || (req.query && req.query.token) || '')
                .replace(/^Bearer\s+/i, '').trim();
            // Só rejeita se um token foi enviado E está errado.
            // Permite webhooks sem header de token (ex.: Asaas nem sempre envia o authToken),
            // já que a confirmação só ocorre se o paymentId existir no nosso mapeamento.
            if (provided && provided !== webhookToken) {
                console.warn('[ASAAS WEBHOOK] Token de ativação inválido. Rejeitando.');
                return res.sendStatus(401);
            }
            if (provided) console.log('[ASAAS WEBHOOK] Token de ativação validado com sucesso.');
        }

        const event = req.body;
        console.log('[ASAAS WEBHOOK] Evento recebido:', (event && event.event) || '?', JSON.stringify(event).slice(0, 500));

        const ev = (event && event.event) || '';
        const pagamento = (event && (event.payment || event.data)) || {};
        const paymentId = pagamento.id || (pagamento.payment && pagamento.payment.id);
        const status = pagamento.status;
        const aprovado = ev.includes('PAYMENT_RECEIVED') || ev.includes('PAYMENT_CONFIRMED') ||
            ev.includes('PAYMENT_CREDITED') || ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(status);

        if (aprovado && paymentId) {
            const recargas = db.getRecargas();
            const recarga = recargas.find(r => r.paymentId === paymentId);
            if (recarga && !recarga.sincronizado) {
                processarConfirmacaoRecarga(recarga.nome, recarga.valor, paymentId)
                    .then(r => console.log('[ASAAS WEBHOOK] Depósito confirmado via webhook:', recarga.nome, r))
                    .catch(e => console.error('[ASAAS WEBHOOK] Erro ao confirmar:', e.message));
            } else if (!recarga) {
                console.log('[ASAAS WEBHOOK] paymentId não encontrado no mapeamento:', paymentId);
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('[ASAAS WEBHOOK] Erro:', err.message);
        res.sendStatus(200);
    }
});

app.get('/api/asaas/webhook-url', (req, res) => {
    const baseUrl = req.protocol + '://' + req.get('host');
    res.json({ url: baseUrl + '/api/asaas/webhook' });
});

app.get('/unsubscribe', (req, res) => {
    res.send('<html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;color:#333"><h2 style="color:#10b981">Inscrição cancelada</h2><p>Você não receberá mais emails do BingoVipClub.</p><p><a href="' + (SITE_URL) + '" style="color:#10b981">Voltar ao site</a></p></body></html>');
});

const LOGO_PATH = path.join(__dirname, 'bingo1.jpeg');
app.get('/logo-bingo', (req, res) => {
    res.sendFile(LOGO_PATH, (err) => { if (err) res.status(404).send('logo nao encontrada'); });
});

async function iniciarServidor() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('ERRO: DATABASE_URL nao definida. Defina a URL de conexao do Neon no .env ou nas variaveis de ambiente.');
        process.exit(1);
    }

    await db.init(dbUrl);

    fichasStore = db.getFichasStore();
    adminCreditsStore = db.getAdminCreditsStore();
    bonusGivenStore = db.getBonusGivenStore();
    modoTesteSaque = await db.loadModoTeste();

    await reembolsarComprasPendentes();

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
