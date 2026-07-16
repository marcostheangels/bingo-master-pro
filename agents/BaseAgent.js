const path = require('path');
const fs = require('fs');

class BaseAgent {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.projectRoot = path.resolve(__dirname, '..');
  }

  log(msg, level = 'info') {
    const tag = { info: 'ℹ', ok: '✓', warn: '⚠', error: '✗' }[level] || 'ℹ';
    console.log(`${tag} [${this.name}] ${msg}`);
  }

  run() {
    throw new Error(`Agente ${this.name} não implementou run()`);
  }

  readJson(relativePath) {
    const full = path.join(this.projectRoot, relativePath);
    if (!fs.existsSync(full)) return null;
    try {
      return JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      this.log(`Erro ao ler ${relativePath}: ${e.message}`, 'error');
      return null;
    }
  }

  writeJson(relativePath, data) {
    const full = path.join(this.projectRoot, relativePath);
    fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8');
    this.log(`Salvo ${relativePath}`, 'ok');
  }

  exec(command) {
    const { execSync } = require('child_process');
    return execSync(command, { cwd: this.projectRoot, encoding: 'utf8' });
  }
}

module.exports = BaseAgent;
