const DeployAgent = require('./DeployAgent');
const DiagnosticoAgent = require('./DiagnosticoAgent');
const ManutencaoCreditosAgent = require('./ManutencaoCreditosAgent');
const BackupAgent = require('./BackupAgent');

const agents = {
  deploy: DeployAgent,
  diagnostico: DiagnosticoAgent,
  creditos: ManutencaoCreditosAgent,
  backup: BackupAgent,
};

function list() {
  console.log('Agentes de automação disponíveis:');
  Object.entries(agents).forEach(([key, Agent]) => {
    const a = new Agent();
    console.log(`  - ${key}: ${a.description}`);
  });
}

function run(name, ...args) {
  const Agent = agents[name];
  if (!Agent) {
    console.log(`Agente "${name}" não encontrado.`);
    list();
    process.exit(1);
  }
  const agent = new Agent();
  return agent.run(...args);
}

module.exports = { agents, run, list };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'list') {
    list();
  } else {
    run(cmd, ...rest);
  }
}
