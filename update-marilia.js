const fs = require('fs');
const { Pool } = require('pg');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((o, l) => { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); return o; }, {});
const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
    try {
        const antes = await pool.query("SELECT cpf, nomecompleto, email FROM usuarios WHERE LOWER(nomecompleto) LIKE '%marília%' OR LOWER(nomecompleto) LIKE '%marilia%'");
        console.log('ANTES:', JSON.stringify(antes.rows));
        const res = await pool.query(
            "UPDATE usuarios SET email = $1 WHERE LOWER(nomecompleto) LIKE '%marília%' OR LOWER(nomecompleto) LIKE '%marilia%' RETURNING cpf, nomecompleto, email",
            ['estacaosertanejamontesclaros@gmail.com']
        );
        console.log('DEPOIS:', JSON.stringify(res.rows));
    } catch (e) {
        console.error('ERRO:', e.message);
    } finally {
        await pool.end();
    }
})();
