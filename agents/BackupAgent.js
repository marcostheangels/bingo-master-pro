const path = require('path');
const fs = require('fs');
const BaseAgent = require('./BaseAgent');

class BackupAgent extends BaseAgent {
  constructor() {
    super('backup', 'Faz backup dos dados JSON em /backups com timestamp');
  }

  run() {
    const files = ['admin_creditos.json', 'usuarios.json', 'fichas.json', 'recargas.json',
      'saques.json', 'transacoes.json', 'historico.json', 'rooms_state.json'];
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const destDir = path.join(this.projectRoot, 'backups', ts);
    require('fs').mkdirSync(destDir, { recursive: true });

    let count = 0;
    files.forEach(f => {
      const src = path.join(this.projectRoot, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, f));
        count++;
      }
    });
    this.log(`${count} arquivos salvos em backups/${ts}`, 'ok');
    return true;
  }
}

module.exports = BackupAgent;
