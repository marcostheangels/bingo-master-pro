const path = require('path');
const fs = require('fs');
const BaseAgent = require('./BaseAgent');

class DiagnosticoAgent extends BaseAgent {
  constructor() {
    super('diagnostico', 'Verifica integridade dos arquivos JSON e do game-logic');
  }

  run() {
    this.log('=== DIAGNÓSTICO COMPLETO ===');

    const files = ['admin_creditos.json', 'usuarios.json', 'fichas.json', 'recargas.json', 'saques.json', 'transacoes.json'];
    let allOk = true;

    this.log('--- Integridade dos arquivos ---');
    for (const f of files) {
      const data = this.readJson(f);
      if (data !== null) {
        this.log(`${f}: OK (${Array.isArray(data) ? data.length + ' itens' : Object.keys(data).length + ' chaves'})`, 'ok');
      } else {
        this.log(`${f}: corrompido ou ausente`, 'error');
        allOk = false;
      }
    }

    this.log('--- Game logic ---');
    const glPath = path.join(this.projectRoot, 'game-logic.js');
    const slPath = path.join(this.projectRoot, 'server.js');
    if (fs.existsSync(glPath)) {
      const gl = fs.readFileSync(glPath, 'utf8');
      ['adminUpdateChips', 'sendToHost'].forEach(fn => {
        this.log(`game-logic.js tem ${fn}: ${gl.includes(fn)}`, gl.includes(fn) ? 'ok' : 'warn');
      });
    } else {
      this.log('game-logic.js ausente', 'error');
      allOk = false;
    }
    if (fs.existsSync(slPath)) {
      const sl = fs.readFileSync(slPath, 'utf8');
      ['setChips', 'creditarFichas'].forEach(fn => {
        this.log(`server.js tem ${fn}: ${sl.includes(fn)}`, sl.includes(fn) ? 'ok' : 'warn');
      });
    }

    this.log('--- Créditos admin x usuários ---');
    const adminCreds = this.readJson('admin_creditos.json');
    const users = this.readJson('usuarios.json');
    if (adminCreds && users) {
      const norm = {};
      Object.keys(adminCreds).forEach(k => { norm[k.toLowerCase().trim()] = k; });
      let matches = 0;
      users.forEach(u => {
        if (norm[u.nomeCompleto.toLowerCase().trim()]) matches++;
      });
      this.log(`Jogadores com créditos admin: ${matches}/${users.length}`);
    }

    this.log(allOk ? 'Tudo OK' : 'Problemas detectados', allOk ? 'ok' : 'warn');
    return allOk;
  }
}

module.exports = DiagnosticoAgent;
