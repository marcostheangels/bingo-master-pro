const BaseAgent = require('./BaseAgent');

class ManutencaoCreditosAgent extends BaseAgent {
  constructor() {
    super('manutencao-creditos', 'Consolida e corrige fichas/créditos admin de jogadores');
  }

  run() {
    this.log('=== MANUTENÇÃO DE CRÉDITOS ===');

    const users = this.readJson('usuarios.json');
    const fichas = this.readJson('fichas.json') || {};
    const adminCreds = this.readJson('admin_creditos.json') || {};

    if (!users) {
      this.log('usuarios.json indisponível', 'error');
      return false;
    }

    let atualizados = 0;
    const normalizar = s => s.toLowerCase().trim()
      .replace(/í/g, 'i').replace(/ã/g, 'a').replace(/ç/g, 'c').replace(/é/g, 'e').replace(/õ/g, 'o');

    users.forEach(u => {
      const key = normalizar(u.nomeCompleto);
      let matchKey = Object.keys(adminCreds).find(k => normalizar(k) === key);
      if (!matchKey) matchKey = Object.keys(fichas).find(k => normalizar(k) === key);

      if (matchKey) {
        const creditos = adminCreds[matchKey] || 0;
        const saldoFichas = fichas[matchKey] || 0;
        // Garante consistência: fichas reflete o maior saldo
        const saldo = Math.max(creditos, saldoFichas);
        if (fichas[matchKey] !== saldo) {
          fichas[matchKey] = saldo;
          if (!adminCreds[matchKey]) adminCreds[matchKey] = saldo;
          atualizados++;
        }
      }
    });

    this.writeJson('fichas.json', fichas);
    this.writeJson('admin_creditos.json', adminCreds);
    this.log(`${atualizados} jogadores sincronizados`, 'ok');
    return true;
  }
}

module.exports = ManutencaoCreditosAgent;
