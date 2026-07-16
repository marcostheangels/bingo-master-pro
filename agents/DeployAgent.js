const BaseAgent = require('./BaseAgent');

class DeployAgent extends BaseAgent {
  constructor() {
    super('deploy', 'Deploy completo: Firebase Hosting + Git commit + push');
  }

  run(msg) {
    const message = msg || `deploy ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    this.log('Iniciando deploy completo...');

    // 1. Validar sintaxe do server.js
    try {
      this.exec('node -c server.js');
      this.log('Sintaxe do server.js válida', 'ok');
    } catch (e) {
      this.log('server.js com erro de sintaxe. Abortando.', 'error');
      return false;
    }

    // 2. Firebase Hosting
    this.log('Firebase Hosting...');
    try {
      this.exec('firebase deploy --only hosting --project bingo-vip-club-e8164');
      this.log('Firebase OK', 'ok');
    } catch (e) {
      this.log('Falha no Firebase', 'error');
      return false;
    }

    // 3. Git commit
    try {
      this.exec('git add -A');
      this.exec(`git commit -m "${message}"`);
      this.log('Commit OK', 'ok');
    } catch (e) {
      this.log(`Commit: ${e.message}`, 'warn');
    }

    // 4. Git push (Render lê do GitHub)
    try {
      this.exec('git push origin main');
      this.log('Push OK', 'ok');
    } catch (e) {
      this.log('Falha no push', 'error');
      return false;
    }

    this.log('Deploy concluído! Frontend: https://bingovipclub.online | Backend: https://bingo-master-pro-fcty.onrender.com', 'ok');
    return true;
  }
}

module.exports = DeployAgent;
