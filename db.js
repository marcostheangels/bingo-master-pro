const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

// In-memory caches (same structure as current JSON files)
let usuariosCache = [];
let fichasCache = {};
let saquesCache = [];
let transacoesCache = [];
let recargasCache = [];
let historicoCache = [];
let adminCreditsCache = {};
let botFichasCache = {};
let roomsStateCache = {};
let bonusPrimeiroDepositoCache = {}; // nomeLowercase -> true (já recebeu bônus)

async function init(connectionString) {
    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    await createTables();
    await loadCache();

    console.log('[DB] PostgreSQL inicializado com ' + usuariosCache.length + ' usuarios, ' + Object.keys(fichasCache).length + ' fichas, ' + saquesCache.length + ' saques, ' + transacoesCache.length + ' transacoes, ' + recargasCache.length + ' recargas, ' + historicoCache.length + ' historicos');
    return true;
}

async function createTables() {
    // Drop ALL existing tables to ensure clean schema (data will be migrated from JSON)
    await pool.query(`DROP TABLE IF EXISTS
        usuarios, fichas, saques, transacoes, recargas, historico,
        admin_creditos, bot_fichas, modo_teste, rooms_state,
        admin_logs, auditoria, creditos, recargas_old, saques_old, tokens
    CASCADE`);
    console.log('[DB] Existing tables dropped, creating new ones...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            "nomeCompleto" TEXT NOT NULL,
            "cpf" TEXT PRIMARY KEY,
            "cpfFormatado" TEXT,
            "email" TEXT NOT NULL,
            "senha" TEXT NOT NULL,
            "chavePix" TEXT,
            "sessionToken" TEXT,
            "data" TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS fichas (
            "nome" TEXT PRIMARY KEY,
            "chips" BIGINT NOT NULL DEFAULT 0,
            "winnings" BIGINT NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS saques (
            "id" BIGINT PRIMARY KEY,
            "nome" TEXT,
            "valor" REAL,
            "chavePix" TEXT,
            "tipoChave" TEXT,
            "status" TEXT DEFAULT 'pendente',
            "data" TEXT,
            "paymentId" TEXT,
            "dataPagamento" TEXT,
            "qrCode" TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS transacoes (
            "id" SERIAL PRIMARY KEY,
            "tipo" TEXT,
            "nome" TEXT,
            "nomeExibicao" TEXT,
            "valor" REAL,
            "detalhe" TEXT,
            "data" TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS recargas (
            "paymentId" TEXT PRIMARY KEY,
            "nome" TEXT,
            "fichas" INTEGER,
            "data" TEXT,
            "sincronizado" BOOLEAN DEFAULT false
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS historico (
            "numero" INTEGER PRIMARY KEY,
            "data" TEXT,
            "bolasSorteadas" INTEGER[],
            "totalBolas" INTEGER,
            "vencedores" JSONB
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_creditos (
            "nome" TEXT PRIMARY KEY,
            "valor" BIGINT NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_fichas (
            "nome" TEXT PRIMARY KEY,
            "chips" BIGINT NOT NULL DEFAULT 10000
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS modo_teste (
            "id" INTEGER PRIMARY KEY DEFAULT 1,
            "ligado" BOOLEAN NOT NULL DEFAULT false
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms_state (
            "id" TEXT PRIMARY KEY,
            "state" JSONB NOT NULL DEFAULT '{}'
        )
    `);
}

async function loadCache() {
    try {
        const r = await pool.query('SELECT * FROM usuarios');
        usuariosCache = r.rows;
    } catch (e) { usuariosCache = []; }

    try {
        const r = await pool.query('SELECT * FROM fichas');
        fichasCache = {};
        for (const row of r.rows) {
            fichasCache[row.nome] = { chips: Number(row.chips), winnings: Number(row.winnings) };
        }
    } catch (e) { fichasCache = {}; }

    try {
        const r = await pool.query('SELECT * FROM saques ORDER BY id');
        saquesCache = r.rows.map(row => {
            const obj = { ...row };
            if (obj.paymentId !== null && obj.paymentId !== undefined) obj.paymentId = isNaN(Number(obj.paymentId)) ? obj.paymentId : Number(obj.paymentId);
            if (obj.qrCode) obj.qrCode = obj.qrCode;
            return obj;
        });
    } catch (e) { saquesCache = []; }

    try {
        const r = await pool.query('SELECT * FROM transacoes ORDER BY id');
        transacoesCache = r.rows;
    } catch (e) { transacoesCache = []; }

    try {
        const r = await pool.query('SELECT * FROM recargas');
        recargasCache = r.rows.map(row => {
            const obj = { ...row };
            if (obj.paymentId !== null && obj.paymentId !== undefined) obj.paymentId = isNaN(Number(obj.paymentId)) ? obj.paymentId : Number(obj.paymentId);
            return obj;
        });
    } catch (e) { recargasCache = []; }

    try {
        const r = await pool.query('SELECT * FROM historico ORDER BY numero');
        historicoCache = r.rows.map(row => ({
            ...row,
            vencedores: typeof row.vencedores === 'string' ? JSON.parse(row.vencedores) : row.vencedores
        }));
    } catch (e) { historicoCache = []; }

    try {
        const r = await pool.query('SELECT * FROM admin_creditos');
        adminCreditsCache = {};
        for (const row of r.rows) {
            adminCreditsCache[row.nome] = Number(row.valor);
        }
    } catch (e) { adminCreditsCache = {}; }

    try {
        const r = await pool.query('SELECT * FROM bot_fichas');
        botFichasCache = {};
        for (const row of r.rows) {
            botFichasCache[row.nome] = Number(row.chips);
        }
    } catch (e) { botFichasCache = {}; }

    try {
        const r = await pool.query('SELECT * FROM rooms_state');
        roomsStateCache = {};
        for (const row of r.rows) {
            roomsStateCache[row.id] = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        }
    } catch (e) { roomsStateCache = {}; }

    console.log('[DB] Cache loaded:', {
        usuarios: usuariosCache.length,
        fichas: Object.keys(fichasCache).length,
        saques: saquesCache.length,
        transacoes: transacoesCache.length,
        recargas: recargasCache.length,
        historico: historicoCache.length,
        admin_creditos: Object.keys(adminCreditsCache).length,
        bot_fichas: Object.keys(botFichasCache).length,
        rooms_state: Object.keys(roomsStateCache).length
    });
}

// ===================== SYNC CACHE TO DB (fire-and-forget) =====================

async function syncUsuarios() {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM usuarios');
        for (const u of usuariosCache) {
            await pool.query(
                `INSERT INTO usuarios ("nomeCompleto", "cpf", "cpfFormatado", "email", "senha", "chavePix", "sessionToken", "data")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [u.nomeCompleto, u.cpf, u.cpfFormatado || null, u.email, u.senha, u.chavePix || null, u.sessionToken || null, u.data || null]
            );
        }
    } catch (e) { console.error('[DB] syncUsuarios error:', e.message); }
}

async function syncFichas() {
    if (!pool) return;
    try {
        for (const [nome, data] of Object.entries(fichasCache)) {
            await pool.query(
                `INSERT INTO fichas ("nome", "chips", "winnings") VALUES ($1,$2,$3) ON CONFLICT ("nome") DO UPDATE SET "chips"=EXCLUDED."chips", "winnings"=EXCLUDED."winnings"`,
                [nome, Math.round(data.chips), Math.round(data.winnings)]
            );
        }
    } catch (e) { console.error('[DB] syncFichas error:', e.message); }
}

async function syncSaques() {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM saques');
        for (const s of saquesCache) {
            const pid = s.paymentId !== null && s.paymentId !== undefined ? String(s.paymentId) : null;
            await pool.query(
                `INSERT INTO saques ("id", "nome", "valor", "chavePix", "tipoChave", "status", "data", "paymentId", "dataPagamento", "qrCode")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [s.id, s.nome || null, s.valor || null, s.chavePix || null, s.tipoChave || null, s.status || 'pendente',
                 s.data || null, pid, s.dataPagamento || null, s.qrCode || null]
            );
        }
    } catch (e) { console.error('[DB] syncSaques error:', e.message); }
}

async function syncTransacoes() {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM transacoes');
        for (const t of transacoesCache) {
            await pool.query(
                `INSERT INTO transacoes ("tipo", "nome", "nomeExibicao", "valor", "detalhe", "data") VALUES ($1,$2,$3,$4,$5,$6)`,
                [t.tipo, t.nome || null, t.nomeExibicao || null, t.valor || 0, t.detalhe || null, t.data || null]
            );
        }
    } catch (e) { console.error('[DB] syncTransacoes error:', e.message); }
}

async function syncRecargas() {
    if (!pool) return;
    try {
        for (const r of recargasCache) {
            const pid = r.paymentId !== null && r.paymentId !== undefined ? String(r.paymentId) : '';
            await pool.query(
                `INSERT INTO recargas ("paymentId", "nome", "fichas", "data", "sincronizado") VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT ("paymentId") DO UPDATE SET "sincronizado"=EXCLUDED."sincronizado"`,
                [pid, r.nome || null, r.fichas || 0, r.data || null, r.sincronizado || false]
            );
        }
    } catch (e) { console.error('[DB] syncRecargas error:', e.message); }
}

async function syncHistorico() {
    if (!pool) return;
    try {
        for (const h of historicoCache) {
            await pool.query(
                `INSERT INTO historico ("numero", "data", "bolasSorteadas", "totalBolas", "vencedores") VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT ("numero") DO UPDATE SET "data"=EXCLUDED."data", "bolasSorteadas"=EXCLUDED."bolasSorteadas", "totalBolas"=EXCLUDED."totalBolas", "vencedores"=EXCLUDED."vencedores"`,
                [h.numero, h.data || null, h.bolasSorteadas || [], h.totalBolas || 0, JSON.stringify(h.vencedores || {})]
            );
        }
    } catch (e) { console.error('[DB] syncHistorico error:', e.message); }
}

async function syncAdminCreditos() {
    if (!pool) return;
    try {
        for (const [nome, valor] of Object.entries(adminCreditsCache)) {
            await pool.query(
                `INSERT INTO admin_creditos ("nome", "valor") VALUES ($1,$2) ON CONFLICT ("nome") DO UPDATE SET "valor"=EXCLUDED."valor"`,
                [nome, Math.round(valor)]
            );
        }
    } catch (e) { console.error('[DB] syncAdminCreditos error:', e.message); }
}

async function syncBotFichas() {
    if (!pool) return;
    try {
        for (const [nome, chips] of Object.entries(botFichasCache)) {
            await pool.query(
                `INSERT INTO bot_fichas ("nome", "chips") VALUES ($1,$2) ON CONFLICT ("nome") DO UPDATE SET "chips"=EXCLUDED."chips"`,
                [nome, Math.round(chips)]
            );
        }
    } catch (e) { console.error('[DB] syncBotFichas error:', e.message); }
}

// ===================== PUBLIC INTERFACE (sync wrappers for server.js) =====================

// Usuarios
function getUsuarios() { return usuariosCache; }
function setUsuarios(lista) {
    usuariosCache = lista;
    syncUsuarios().catch(e => console.error('[DB] syncUsuarios failed:', e.message));
}

// Fichas
function getFichasStore() { return fichasCache; }
function setFichasStore(store) {
    fichasCache = store;
    syncFichas().catch(e => console.error('[DB] syncFichas failed:', e.message));
}
function syncFichasStore() {
    syncFichas().catch(e => console.error('[DB] syncFichas failed:', e.message));
}

// Saques
function getSaques() { return saquesCache; }
function setSaques(lista) {
    saquesCache = lista;
    syncSaques().catch(e => console.error('[DB] syncSaques failed:', e.message));
}
function syncSaquesStore() {
    syncSaques().catch(e => console.error('[DB] syncSaques failed:', e.message));
}

// Transacoes
function getTransacoes() { return transacoesCache; }
function setTransacoes(lista) {
    transacoesCache = lista;
    syncTransacoes().catch(e => console.error('[DB] syncTransacoes failed:', e.message));
}

// Recargas
function getRecargas() { return recargasCache; }
function setRecargas(lista) {
    recargasCache = lista;
    syncRecargas().catch(e => console.error('[DB] syncRecargas failed:', e.message));
}

// Historico
function getHistorico() { return historicoCache; }
function setHistorico(lista) {
    historicoCache = lista;
    syncHistorico().catch(e => console.error('[DB] syncHistorico failed:', e.message));
}

// Admin Creditos
function getAdminCreditsStore() { return adminCreditsCache; }
function setAdminCreditsStore(store) {
    adminCreditsCache = store;
    syncAdminCreditos().catch(e => console.error('[DB] syncAdminCreditos failed:', e.message));
}
function syncAdminCreditsStore() {
    syncAdminCreditos().catch(e => console.error('[DB] syncAdminCreditos failed:', e.message));
}

// Bonus Primeiro Depósito (persistente em arquivo, uma vez por usuário)
function getBonusPrimeiroDeposito() { return bonusPrimeiroDepositoCache; }
function setBonusPrimeiroDepositoJaUsado(nome) {
    const key = (nome || '').toLowerCase().trim();
    bonusPrimeiroDepositoCache[key] = true;
    syncBonusCache();
}
function syncBonusCache() {
    const path = path.join(__dirname, 'bonus_deposito.json');
    fs.writeFileSync(path, JSON.stringify(bonusPrimeiroDepositoCache, null, 2));
}
function loadBonusCache() {
    const path = path.join(__dirname, 'bonus_deposito.json');
    if (fs.existsSync(path)) {
        try {
            const data = JSON.parse(fs.readFileSync(path, 'utf8'));
            Object.keys(data).forEach(k => { bonusPrimeiroDepositoCache[k] = data[k]; });
            console.log('[DB] Bonus cache carregado:', Object.keys(bonusPrimeiroDepositoCache).length, 'usuários');
        } catch (e) { console.error('[DB] Erro ao carregar bonus cache:', e.message); }
    }
}

// Bot Fichas
function getBotFichas() { return botFichasCache; }
function setBotFichas(store) {
    botFichasCache = store;
    syncBotFichas().catch(e => console.error('[DB] syncBotFichas failed:', e.message));
}

// Modo Teste
async function loadModoTeste() {
    if (!pool) return false;
    try {
        const r = await pool.query('SELECT "ligado" FROM modo_teste WHERE "id"=1');
        if (r.rows.length > 0) return r.rows[0].ligado;
        return false;
    } catch (e) { return false; }
}
async function saveModoTeste(ligado) {
    if (!pool) return;
    try {
        await pool.query('INSERT INTO modo_teste ("id", "ligado") VALUES (1,$1) ON CONFLICT ("id") DO UPDATE SET "ligado"=EXCLUDED."ligado"', [!!ligado]);
    } catch (e) { console.error('[DB] saveModoTeste error:', e.message); }
}

// Rooms State
function loadRoomState(roomId) {
    return roomsStateCache[roomId] || null;
}
function saveRoomState(roomId, state) {
    roomsStateCache[roomId] = state;
    if (!pool) return;
    pool.query(
        'INSERT INTO rooms_state ("id", "state") VALUES ($1,$2::jsonb) ON CONFLICT ("id") DO UPDATE SET "state"=EXCLUDED."state"',
        [roomId, JSON.stringify(state)]
    ).catch(e => console.error('[DB] saveRoomState error:', e.message));
}

// ===================== MIGRATION FROM JSON FILES =====================

async function migrateFromJson() {
    console.log('[DB] Migrating data from JSON files to PostgreSQL...');
    const dir = process.cwd();

    // usuarios.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'usuarios.json'), 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
            usuariosCache = data;
            await syncUsuarios();
            console.log('[DB] Migrated ' + data.length + ' usuarios');
        }
    } catch (e) { console.log('[DB] usuarios.json: ' + e.message); }

    // fichas.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'fichas.json'), 'utf8'));
        if (typeof data === 'object' && Object.keys(data).length > 0) {
            fichasCache = data;
            await syncFichas();
            console.log('[DB] Migrated ' + Object.keys(data).length + ' fichas entries');
        }
    } catch (e) { console.log('[DB] fichas.json: ' + e.message); }

    // saques.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'saques.json'), 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
            saquesCache = data;
            await syncSaques();
            console.log('[DB] Migrated ' + data.length + ' saques');
        }
    } catch (e) { console.log('[DB] saques.json: ' + e.message); }

    // transacoes.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'transacoes.json'), 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
            transacoesCache = data;
            await syncTransacoes();
            console.log('[DB] Migrated ' + data.length + ' transacoes');
        }
    } catch (e) { console.log('[DB] transacoes.json: ' + e.message); }

    // recargas.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'recargas.json'), 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
            recargasCache = data;
            await syncRecargas();
            console.log('[DB] Migrated ' + data.length + ' recargas');
        }
    } catch (e) { console.log('[DB] recargas.json: ' + e.message); }

    // historico.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'historico.json'), 'utf8'));
        if (Array.isArray(data) && data.length > 0) {
            historicoCache = data;
            await syncHistorico();
            console.log('[DB] Migrated ' + data.length + ' historicos');
        }
    } catch (e) { console.log('[DB] historico.json: ' + e.message); }

    // admin_creditos.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'admin_creditos.json'), 'utf8'));
        if (typeof data === 'object' && Object.keys(data).length > 0) {
            adminCreditsCache = data;
            await syncAdminCreditos();
            console.log('[DB] Migrated ' + Object.keys(data).length + ' admin_creditos entries');
        }
    } catch (e) { console.log('[DB] admin_creditos.json: ' + e.message); }

    // bot_fichas.json
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, 'bot_fichas.json'), 'utf8'));
        if (typeof data === 'object' && Object.keys(data).length > 0) {
            botFichasCache = data;
            await syncBotFichas();
            console.log('[DB] Migrated ' + Object.keys(data).length + ' bot_fichas entries');
        }
    } catch (e) { console.log('[DB] bot_fichas.json: ' + e.message); }

    console.log('[DB] Migration complete!');
    return true;
}

// ===================== CLOSE =====================

async function close() {
    if (pool) await pool.end();
}

module.exports = {
    init,
    migrateFromJson,
    close,
    getUsuarios,
    setUsuarios,
    getFichasStore,
    setFichasStore,
    syncFichasStore,
    getSaques,
    setSaques,
    syncSaquesStore,
    getTransacoes,
    setTransacoes,
    getRecargas,
    setRecargas,
    getHistorico,
    setHistorico,
    getAdminCreditsStore,
    setAdminCreditsStore,
    syncAdminCreditsStore,
    getBotFichas,
    setBotFichas,
    loadModoTeste,
    saveModoTeste,
    loadRoomState,
    saveRoomState,
    getBonusPrimeiroDeposito,
    setBonusPrimeiroDepositoJaUsado
};
