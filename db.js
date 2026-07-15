const { Pool } = require('pg');

let pool = null;

let usuariosCache = [];
let fichasCache = {};
let saquesCache = [];
let transacoesCache = [];
let recargasCache = [];
let historicoCache = [];
let adminCreditsCache = {};
let botFichasCache = {};
let roomsStateCache = {};
let bonusPrimeiroDepositoCache = {};
let bonusGivenCache = {};
let comprasPendentesCache = [];

async function init(connectionString) {
    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
        console.error('[DB] Pool error:', err.message);
    });

    await createTables();
    await loadCache();
    await loadBonusCache();

    console.log('[DB] PostgreSQL inicializado com ' + usuariosCache.length + ' usuarios, ' + Object.keys(fichasCache).length + ' fichas, ' + saquesCache.length + ' saques, ' + transacoesCache.length + ' transacoes, ' + recargasCache.length + ' recargas, ' + historicoCache.length + ' historicos');
    return true;
}

async function createTables() {
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
            "id" BIGINT PRIMARY KEY,
            "tipo" TEXT,
            "nome" TEXT,
            "nomeExibicao" TEXT,
            "valor" REAL,
            "detalhe" TEXT,
            "data" TEXT
        )
    `);
    try {
        await pool.query(`ALTER TABLE transacoes ALTER COLUMN "id" TYPE BIGINT`);
    } catch (e) {
        console.error('[DB] ALTER transacoes id BIGINT (ignorado):', e.message);
    }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS compras_pendentes (
            "id" BIGINT PRIMARY KEY,
            "nome" TEXT,
            "sala" TEXT,
            "rodada" BIGINT,
            "qty" INTEGER,
            "custo" BIGINT,
            "status" TEXT
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
        CREATE TABLE IF NOT EXISTS bonus_given (
            "nome" TEXT PRIMARY KEY,
            "valor" BIGINT NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms_state (
            "id" TEXT PRIMARY KEY,
            "state" JSONB NOT NULL DEFAULT '{}'
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bonus_deposito (
            "nome" TEXT PRIMARY KEY,
            "recebeu" BOOLEAN NOT NULL DEFAULT true
        )
    `);
    console.log('[DB] Tables ensured (created if not existing).');
}

async function loadCache() {
    try {
        const r = await pool.query('SELECT * FROM usuarios');
        usuariosCache = r.rows;
    } catch (e) {
        console.error('[DB] Erro ao carregar usuarios:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM fichas');
        fichasCache = {};
        for (const row of r.rows) {
            fichasCache[row.nome] = { chips: Number(row.chips), winnings: Number(row.winnings) };
        }
    } catch (e) {
        console.error('[DB] Erro ao carregar fichas:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM saques ORDER BY id');
        saquesCache = r.rows.map(row => {
            const obj = { ...row };
            if (obj.paymentId !== null && obj.paymentId !== undefined) obj.paymentId = isNaN(Number(obj.paymentId)) ? obj.paymentId : Number(obj.paymentId);
            if (obj.qrCode) obj.qrCode = obj.qrCode;
            return obj;
        });
    } catch (e) {
        console.error('[DB] Erro ao carregar saques:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM transacoes ORDER BY id');
        transacoesCache = r.rows;
    } catch (e) {
        console.error('[DB] Erro ao carregar transacoes:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM compras_pendentes');
        comprasPendentesCache = r.rows.map(row => ({ ...row }));

        const r2 = await pool.query('SELECT * FROM recargas');
        recargasCache = r2.rows.map(row => {
            const obj = { ...row };
            if (obj.paymentId !== null && obj.paymentId !== undefined) obj.paymentId = isNaN(Number(obj.paymentId)) ? obj.paymentId : Number(obj.paymentId);
            return obj;
        });
    } catch (e) {
        console.error('[DB] Erro ao carregar recargas:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM historico ORDER BY numero');
        historicoCache = r.rows.map(row => ({
            ...row,
            vencedores: typeof row.vencedores === 'string' ? JSON.parse(row.vencedores) : row.vencedores
        }));
    } catch (e) {
        console.error('[DB] Erro ao carregar historico:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM admin_creditos');
        adminCreditsCache = {};
        for (const row of r.rows) {
            adminCreditsCache[row.nome] = Number(row.valor);
        }
    } catch (e) {
        console.error('[DB] Erro ao carregar admin_creditos:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM bot_fichas');
        botFichasCache = {};
        for (const row of r.rows) {
            botFichasCache[row.nome] = Number(row.chips);
        }
    } catch (e) {
        console.error('[DB] Erro ao carregar bot_fichas:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM rooms_state');
        roomsStateCache = {};
        for (const row of r.rows) {
            roomsStateCache[row.id] = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        }
    } catch (e) {
        console.error('[DB] Erro ao carregar rooms_state:', e.message);
        throw e;
    }

    try {
        const r = await pool.query('SELECT * FROM bonus_given');
        bonusGivenCache = {};
        for (const row of r.rows) {
            bonusGivenCache[row.nome] = Number(row.valor);
        }
    } catch (e) {
        console.error('[DB] Erro ao carregar bonus_given:', e.message);
        throw e;
    }

    console.log('[DB] Cache loaded:', {
        usuarios: usuariosCache.length,
        fichas: Object.keys(fichasCache).length,
        saques: saquesCache.length,
        transacoes: transacoesCache.length,
        recargas: recargasCache.length,
        historico: historicoCache.length,
        admin_creditos: Object.keys(adminCreditsCache).length,
        bot_fichas: Object.keys(botFichasCache).length,
        rooms_state: Object.keys(roomsStateCache).length,
        bonus_given: Object.keys(bonusGivenCache).length
    });
}

async function loadBonusCache() {
    if (!pool) return;
    try {
        const r = await pool.query('SELECT * FROM bonus_deposito');
        bonusPrimeiroDepositoCache = {};
        for (const row of r.rows) {
            bonusPrimeiroDepositoCache[row.nome] = row.recebeu;
        }
        console.log('[DB] Bonus cache carregado:', Object.keys(bonusPrimeiroDepositoCache).length, 'usuários');
    } catch (e) {
        console.error('[DB] Erro ao carregar bonus_deposito:', e.message);
        bonusPrimeiroDepositoCache = {};
    }
}

// ===================== SYNC CACHE TO DB =====================

async function syncUsuarios() {
    if (!pool) return;
    try {
        for (const u of usuariosCache) {
            await pool.query(
                `INSERT INTO usuarios ("nomeCompleto", "cpf", "cpfFormatado", "email", "senha", "chavePix", "sessionToken", "data")
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT ("cpf") DO UPDATE SET
                    "nomeCompleto"=EXCLUDED."nomeCompleto",
                    "cpfFormatado"=EXCLUDED."cpfFormatado",
                    "email"=EXCLUDED."email",
                    "senha"=EXCLUDED."senha",
                    "chavePix"=EXCLUDED."chavePix",
                    "sessionToken"=EXCLUDED."sessionToken",
                    "data"=EXCLUDED."data"`,
                [u.nomeCompleto, u.cpf, u.cpfFormatado || null, u.email, u.senha, u.chavePix || null, u.sessionToken || null, u.data || null]
            );
        }
    } catch (e) { console.error('[DB] syncUsuarios error:', e.message); throw e; }
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
    } catch (e) { console.error('[DB] syncFichas error:', e.message); throw e; }
}

async function syncSaques() {
    if (!pool) return;
    try {
        for (const s of saquesCache) {
            const pid = s.paymentId !== null && s.paymentId !== undefined ? String(s.paymentId) : null;
            await pool.query(
                `INSERT INTO saques ("id", "nome", "valor", "chavePix", "tipoChave", "status", "data", "paymentId", "dataPagamento", "qrCode")
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT ("id") DO UPDATE SET
                    "nome"=EXCLUDED."nome", "valor"=EXCLUDED."valor", "chavePix"=EXCLUDED."chavePix",
                    "tipoChave"=EXCLUDED."tipoChave", "status"=EXCLUDED."status", "data"=EXCLUDED."data",
                    "paymentId"=EXCLUDED."paymentId", "dataPagamento"=EXCLUDED."dataPagamento", "qrCode"=EXCLUDED."qrCode"`,
                [s.id, s.nome || null, s.valor || null, s.chavePix || null, s.tipoChave || null, s.status || 'pendente', s.data || null, pid, s.dataPagamento || null, s.qrCode || null]
            );
        }
    } catch (e) { console.error('[DB] syncSaques error:', e.message); throw e; }
}

async function syncTransacoes() {
    if (!pool) return;
    try {
        for (const t of transacoesCache) {
            const tid = t.id != null ? Number(t.id) : null;
            await pool.query(
                `INSERT INTO transacoes ("id", "tipo", "nome", "nomeExibicao", "valor", "detalhe", "data")
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT ("id") DO NOTHING`,
                [tid, t.tipo, t.nome || null, t.nomeExibicao || null, t.valor || 0, t.detalhe || null, t.data || null]
            );
        }
    } catch (e) { console.error('[DB] syncTransacoes error:', e.message); throw e; }
}

async function syncComprasPendentes() {
    if (!pool) return;
    try {
        for (const c of comprasPendentesCache) {
            await pool.query(
                `INSERT INTO compras_pendentes ("id", "nome", "sala", "rodada", "qty", "custo", "status")
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT ("id") DO UPDATE SET "status"=EXCLUDED."status"`,
                [c.id, c.nome || null, c.sala || null, c.rodada || 0, c.qty || 0, c.custo || 0, c.status || 'pendente']
            );
        }
    } catch (e) { console.error('[DB] syncComprasPendentes error:', e.message); throw e; }
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
    } catch (e) { console.error('[DB] syncRecargas error:', e.message); throw e; }
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
    } catch (e) { console.error('[DB] syncHistorico error:', e.message); throw e; }
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
    } catch (e) { console.error('[DB] syncAdminCreditos error:', e.message); throw e; }
}

async function syncBonusGiven() {
    if (!pool) return;
    try {
        for (const [nome, valor] of Object.entries(bonusGivenCache)) {
            await pool.query(
                `INSERT INTO bonus_given ("nome", "valor") VALUES ($1,$2) ON CONFLICT ("nome") DO UPDATE SET "valor"=EXCLUDED."valor"`,
                [nome, Math.round(valor)]
            );
        }
    } catch (e) { console.error('[DB] syncBonusGiven error:', e.message); throw e; }
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
    } catch (e) { console.error('[DB] syncBotFichas error:', e.message); throw e; }
}

async function syncBonusDeposito() {
    if (!pool) return;
    try {
        for (const [nome, recebeu] of Object.entries(bonusPrimeiroDepositoCache)) {
            await pool.query(
                `INSERT INTO bonus_deposito ("nome", "recebeu") VALUES ($1,$2) ON CONFLICT ("nome") DO UPDATE SET "recebeu"=EXCLUDED."recebeu"`,
                [nome, !!recebeu]
            );
        }
    } catch (e) { console.error('[DB] syncBonusDeposito error:', e.message); throw e; }
}

// ===================== PUBLIC INTERFACE =====================

function getUsuarios() { return usuariosCache; }
async function setUsuarios(lista) {
    usuariosCache = lista;
    await syncUsuarios();
}

function getFichasStore() { return fichasCache; }
async function setFichasStore(store) {
    fichasCache = store;
    await syncFichas();
}
async function syncFichasStore() {
    await syncFichas();
}

function getSaques() { return saquesCache; }
async function setSaques(lista) {
    saquesCache = lista;
    await syncSaques();
}
async function syncSaquesStore() {
    await syncSaques();
}

function getTransacoes() { return transacoesCache; }
async function setTransacoes(lista) {
    transacoesCache = lista;
    await syncTransacoes();
}

function getRecargas() { return recargasCache; }
async function setRecargas(lista) {
    recargasCache = lista;
    await syncRecargas();
}

function getHistorico() { return historicoCache; }
async function setHistorico(lista) {
    historicoCache = lista;
    await syncHistorico();
}

function getAdminCreditsStore() { return adminCreditsCache; }
async function setAdminCreditsStore(store) {
    adminCreditsCache = store;
    await syncAdminCreditos();
}
async function syncAdminCreditsStore() {
    await syncAdminCreditos();
}

function getBonusPrimeiroDeposito() { return bonusPrimeiroDepositoCache; }
async function setBonusPrimeiroDepositoJaUsado(nome) {
    const key = (nome || '').toLowerCase().trim();
    bonusPrimeiroDepositoCache[key] = true;
    await syncBonusDeposito();
}

function getBonusGivenStore() { return bonusGivenCache; }
async function setBonusGivenStore(store) {
    bonusGivenCache = store;
    await syncBonusGiven();
}
async function syncBonusGivenStore() {
    await syncBonusGiven();
}

function getComprasPendentes() { return comprasPendentesCache; }
async function setComprasPendentes(lista) {
    comprasPendentesCache = lista;
    await syncComprasPendentes();
}
async function syncComprasPendentesStore() {
    await syncComprasPendentes();
}

function getBotFichas() { return botFichasCache; }
async function setBotFichas(store) {
    botFichasCache = store;
    await syncBotFichas();
}

async function loadModoTeste() {
    if (!pool) return false;
    try {
        const r = await pool.query('SELECT "ligado" FROM modo_teste WHERE "id"=1');
        if (r.rows.length > 0) return r.rows[0].ligado;
        return false;
    } catch (e) { console.error('[DB] loadModoTeste error:', e.message); return false; }
}

async function saveModoTeste(ligado) {
    if (!pool) return;
    try {
        await pool.query('INSERT INTO modo_teste ("id", "ligado") VALUES (1,$1) ON CONFLICT ("id") DO UPDATE SET "ligado"=EXCLUDED."ligado"', [!!ligado]);
    } catch (e) { console.error('[DB] saveModoTeste error:', e.message); }
}

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

async function close() {
    if (pool) await pool.end();
}

module.exports = {
    init,
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
    getBonusGivenStore,
    setBonusGivenStore,
    syncBonusGivenStore,
    getComprasPendentes,
    setComprasPendentes,
    syncComprasPendentesStore,
    loadModoTeste,
    saveModoTeste,
    loadRoomState,
    saveRoomState,
    getBonusPrimeiroDeposito,
    setBonusPrimeiroDepositoJaUsado
};
