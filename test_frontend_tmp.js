const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const gameLogic = fs.readFileSync('game-logic.js', 'utf8');
const network = fs.readFileSync('network.js', 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://bingovipclub.online/' });
const { window } = dom;
const { document } = window;

// Polyfills
window.alert = (m) => console.log('[ALERT]', m);
window.fetch = (url, opts) => {
  console.log('[FETCH]', opts && opts.method, url, opts && opts.body);
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
};
window.AbortController = window.AbortController || class { constructor(){ this.signal={}; } abort(){} };
window.requestAnimationFrame = (cb) => cb();

const errors = [];
window.onerror = (msg, src, line, col, err) => { errors.push(msg + ' @' + line); };

// Injeta os scripts no escopo GLOBAL da window (igual ao <script> no navegador)
function runInWindow(code, name) {
  try {
    window.eval(code);
    console.log('[OK] ' + name + ' executado');
  } catch (e) {
    console.log('[ERRO] ' + name + ': ' + e.message);
    errors.push(name + ': ' + e.message);
  }
}

runInWindow(gameLogic, 'game-logic.js');
runInWindow(network, 'network.js');

// Simula o fluxo: popular o select e clicar em excluir
try {
  const select = document.getElementById('deletePlayerSelect');
  if (!select) { console.log('[ERRO] deletePlayerSelect nao existe'); }
  else {
    const opt = document.createElement('option');
    opt.value = '17960512094';
    opt.dataset.nome = 'xunda';
    opt.textContent = 'xunda';
    select.appendChild(opt);
    select.value = '17960512094';
    console.log('[TESTE] select.value =', select.value);
  }

  console.log('[TESTE] chamando confirmarExclusaoJogador()...');
  if (typeof window.confirmarExclusaoJogador === 'function') {
    window.confirmarExclusaoJogador();
    console.log('[TESTE] confirmarExclusaoJogador rodou');
  } else {
    console.log('[ERRO] confirmarExclusaoJogador nao e funcao global');
  }

  setTimeout(() => {
    const overlay = document.getElementById('excluirModalOverlay');
    console.log('[TESTE] overlay display =', overlay && overlay.style.display);
    console.log('[ERROS]', errors.length ? errors : 'nenhum');
    process.exit(0);
  }, 500);
} catch (e) {
  console.log('[ERRO GERAL]', e.message);
  console.log('[ERROS]', errors);
  process.exit(0);
}
