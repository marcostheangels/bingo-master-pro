const fs = require('fs');

const test = fs.readFileSync('teste1.html', 'utf8');
const app = fs.readFileSync('orig-app.html', 'utf8');

// Extract sections from app
const bodyStart = app.indexOf('<body>') + '<body>'.length;
const homeStart = app.indexOf('<div class="screen active" id="screenHome">');
const gameStart = app.indexOf('<!-- ===== GAME SCREEN ===== -->');
const adminStart = app.indexOf('<!-- ===== ADMIN SCREEN ===== -->');
const countdownStart = app.indexOf('<!-- ===== COUNTDOWN OVERLAY ===== -->');
const modalPixStart = app.indexOf('<!-- ===== MODAL PIX ===== -->');
const whatsappStart = app.indexOf('<a href="https://wa.me/');
const scriptsStart = app.indexOf('<script src="https://cdnjs.cloudflare.com');

const overlaysHtml = app.substring(bodyStart, homeStart);
const screenHomeHtml = app.substring(homeStart, gameStart);
const screenAdminHtml = app.substring(adminStart, countdownStart);
const countdownHtml = app.substring(countdownStart, modalPixStart);
const modalsHtml = app.substring(modalPixStart, whatsappStart);
const whatsappHtml = app.substring(whatsappStart, scriptsStart);
const scriptsHtml = app.substring(scriptsStart, app.indexOf('</body>'));

// Extract test's head parts
const testHeadStyle = /<style>([\s\S]*?)<\/style>/.exec(test)[0]; // includes <style> tags
const testFontLinks = test.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/g).join('\n    ');

// Functional CSS
const funcCss = `

/* === FUNCTIONAL CSS (login, admin, modais, overlays) === */
#screenHome{display:none;flex-direction:column;background:#05052e;min-height:100vh}
#screenHome.active{display:flex;align-items:center;justify-content:center}
#screenGame{display:none!important}
#screenGame.active{display:flex!important;flex-direction:column!important;height:100vh!important;overflow:hidden!important;padding:0!important}
#screenAdmin{display:none;flex-direction:column;background:#05052e}
#screenAdmin.active{display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:20px}
.admin-screen-wrapper{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:20px}
.admin-panel-content{width:100%;max-width:900px;background:rgba(4,4,30,0.85);border:1px solid rgba(255,255,255,0.14);border-radius:18px;padding:22px}
.box.login-card{width:100%;max-width:420px;background:rgba(4,4,30,0.85);border:1px solid rgba(255,255,255,0.14);border-radius:18px;padding:28px 24px;text-align:center}
.brand{display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:18px}
.brand-logo{height:72px;width:auto;border-radius:14px}
.brand-title{font-weight:800;font-size:30px;letter-spacing:2px;background:linear-gradient(180deg,#E8C87A,#B8860B,#8a6304);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{color:#9d96d4;font-size:13px;letter-spacing:1px}
.vip-pill{margin-top:6px;background:linear-gradient(145deg,#FFD700,#b8860b);color:#1a1030;font-weight:800;font-size:11px;padding:4px 12px;border-radius:999px}
.auth-tabs{display:flex;gap:8px;margin-bottom:16px}
.auth-tab{flex:1;padding:10px;border:none;border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:1px solid rgba(255,255,255,0.1)}
.auth-tab.active{background:linear-gradient(145deg,#8b5cff,#22d3ee)}
.auth-field{text-align:left;margin-bottom:4px}
.auth-field label{display:block;font-size:12px;color:#9d96d4;margin-bottom:4px;font-weight:600}
.auth-error{color:#ff6b81;font-size:12px;min-height:16px;margin:4px 0}
.btn-login{width:100%;padding:14px;border:none;border-radius:14px;cursor:pointer;font-weight:800;font-size:15px;background:linear-gradient(145deg,#8b5cff,#22d3ee);color:#fff;margin-top:6px}
.switch-link{margin-top:12px;font-size:12px;color:#9d96d4}
.switch-link a{color:#FFD700;font-weight:700;text-decoration:none}
.spectator-entry{margin-top:14px}
.btn-spectador{width:100%;padding:12px;border:1px solid rgba(255,255,255,0.18);border-radius:12px;background:rgba(255,255,255,0.05);color:#fff;font-weight:700;cursor:pointer}
.trust-row{display:flex;justify-content:center;gap:14px;margin-top:16px;font-size:11px;color:#9d96d4;flex-wrap:wrap}
.connection-status{margin-top:10px;font-size:12px;color:#9d96d4}
.admin-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.admin-header h3{color:#FFD700;font-size:20px}
.admin-close{background:transparent;border:none;color:#ff6b81;font-size:22px;cursor:pointer}
.admin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.admin-card-section{background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,0));border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:16px}
.admin-card-title{font-weight:700;color:#fff}
.admin-label{font-size:12px;color:#9d96d4;font-weight:600}
.admin-input-row{display:flex;gap:6px;align-items:center}
.admin-btn-row{display:flex;gap:8px}
.admin-saldo-display{background:rgba(0,0,0,.3);border-radius:12px;padding:12px;color:#fff;font-weight:700}
.admin-warning-text{color:#ff6b81;font-size:13px;font-weight:700}
.admin-tabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.admin-tab{padding:10px 16px;border:1px solid rgba(255,255,255,0.12);border-radius:12px;background:rgba(255,255,255,0.06);color:#fff;font-weight:700;cursor:pointer}
.admin-tab.active{background:linear-gradient(145deg,#8b5cff,#22d3ee)}
.admin-tab-content{margin-top:12px}
.admin-tab-header{color:#FFD700;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.admin-tab-actions{display:flex;gap:8px;flex-wrap:wrap}
.admin-empty{color:#9d96d4;font-size:13px}
.admin-filtros{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.admin-info-text{font-size:12px;color:#9d96d4}
.modal-overlay{position:fixed;inset:0;background:rgba(2,2,20,0.78);display:flex;align-items:center;justify-content:center;z-index:300;padding:16px}
.modal-content{width:100%;max-width:460px;background:rgba(4,4,30,0.85);border:1px solid rgba(255,255,255,0.16);border-radius:18px;padding:22px;position:relative}
.modal-content h2{color:#FFD700;margin-bottom:10px;font-size:20px}
.modal-close{position:absolute;top:14px;right:18px;background:transparent;border:none;color:#ff6b81;font-size:22px;cursor:pointer}
.whatsapp-float{position:fixed;bottom:18px;right:18px;z-index:400;display:flex;align-items:center;gap:8px;background:linear-gradient(145deg,#25D366,#128C7E);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 14px;border-radius:999px}
.btn-admin-open{position:fixed;top:12px;right:12px;z-index:200;background:linear-gradient(145deg,#8b5cff,#22d3ee);color:#fff;border:none;padding:8px 14px;border-radius:12px;font-weight:800;cursor:pointer;display:none}
.btn{padding:10px 16px;border:none;border-radius:12px;cursor:pointer;font-weight:700;font-size:13px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.14)}
.btn-sm{padding:6px 12px;font-size:12px}
.btn-refresh{background:rgba(34,211,238,.18);color:#22d3ee}
.btn-add{background:linear-gradient(145deg,#34e89e,#0e7a52);color:#06203f}
.btn-remove{background:linear-gradient(145deg,#ff5d73,#b3122e);color:#fff}
.input-field{width:100%;padding:14px 20px;border-radius:14px;border:1.5px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.3);color:#fff;font-size:1em;outline:none;margin-bottom:15px}
.regra-deposito{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px;font-size:12px;color:#cbd5e1;margin-bottom:12px}
.pix-form{display:flex;flex-direction:column;gap:8px}
.pix-qr-container{display:flex;justify-content:center;margin:12px 0}
.pix-copy-area{display:flex;gap:8px}
.saque-form{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.saque-msg{font-size:13px;color:#22d3ee;min-height:16px}
.meus-saques-box{margin-top:10px}
.meus-saques-title{color:#FFD700;font-weight:700;margin-bottom:6px}
.meus-saques-list{font-size:13px;color:#9d96d4;max-height:200px;overflow-y:auto}
.conn-dot{width:10px;height:10px;border-radius:50%;background:#34e89e;display:inline-block}
#confettiCanvas{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9990}
.fullscreen-btn{position:fixed;bottom:18px;left:18px;z-index:500;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font-size:20px;padding:10px;cursor:pointer}
.pix-loader{width:30px;height:30px;border:3px solid rgba(255,255,255,.1);border-top-color:#8b5cff;border-radius:50%;animation:spin .8s linear infinite;margin:10px auto}
.pix-status{font-size:13px;color:#22d3ee;text-align:center}
.btn-sound{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#fff;cursor:pointer;font-size:16px;padding:4px 8px}
.connection-info{display:flex;align-items:center;gap:6px;font-size:11px;color:#9d96d4}
.players-left{display:none}
.game-log{background:rgba(4,4,30,0.7);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:8px;max-height:90px;overflow-y:auto;font-size:11px;color:#9d96d4;margin-top:8px}
.game-controls{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px}
.speed-control{display:flex;align-items:center;gap:8px;margin-top:6px;justify-content:center;font-size:12px;color:#9d96d4}
#drawnList{display:none}

/* === OVERLAYS === */
.spinner-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:99999}
.spinner-overlay.visible{display:flex}
.spinner{width:50px;height:50px;border:4px solid rgba(255,255,255,.1);border-top-color:#8b5cff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner-text{color:#cbd5e1;font-size:14px;margin-top:16px;font-weight:600}
.offline-banner{position:fixed;top:0;left:0;width:100%;padding:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;text-align:center;font-weight:700;font-size:13px;z-index:99998;display:none}
.manutencao-banner{position:fixed;top:0;left:0;width:100%;padding:10px 16px;background:linear-gradient(135deg,#f59e0b,#d97706);z-index:99997;display:flex;align-items:center;gap:10px;display:none}
.toast-container{position:fixed;top:70px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px}
.toast-item{padding:12px 20px;border-radius:10px;color:#fff;font-weight:700;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:ti .3s ease;max-width:340px}
@keyframes ti{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}
.countdown-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.75);z-index:9990;display:none;justify-content:center;align-items:center}
.countdown-overlay.visible{display:flex}
.countdown-content{text-align:center}
.countdown-label{font-size:14px;color:#fbbf24;font-weight:700;margin-bottom:12px;letter-spacing:1px}
.countdown-timer{font-size:72px;font-weight:800;color:#fff;text-shadow:0 0 30px rgba(139,92,255,.5)}
.auto-start-timer{font-size:20px;color:#9d96d4;margin-top:6px}
.countdown-hint{font-size:13px;color:#9d96d4;margin-top:14px}
`;

// Build the final HTML by sections
const finalHtml = 
  '<!DOCTYPE html>\n' +
  '<html lang="pt-BR">\n' +
  '<head>\n' +
  '    <meta charset="UTF-8">\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
  '    <meta name="theme-color" content="#06030f">\n' +
  '    <meta name="mobile-web-app-capable" content="yes">\n' +
  '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n' +
  '    <title>BINGO VIP CLUB</title>\n' +
  '    <link rel="manifest" href="manifest.json">\n' +
  '    ' + testFontLinks + '\n' +
  '    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">\n' +
  '    <script>\n' +
  '        if (\'serviceWorker\' in navigator) {\n' +
  '            navigator.serviceWorker.getRegistrations().then(regs => {\n' +
  '                regs.forEach(r => r.unregister());\n' +
  '            }).then(() => {\n' +
  '                window.addEventListener(\'load\', () => {\n' +
  '                    navigator.serviceWorker.register(\'sw.js?v=30\').catch(() => {});\n' +
  '                });\n' +
  '            });\n' +
  '        }\n' +
  '    </script>\n' +
  '    <style>\n' +
  // test's inline CSS (visual 3D effects)
  /<style>([\s\S]*?)<\/style>/.exec(test)[1] + '\n' +
  // functional CSS
  funcCss +
  '    </style>\n' +
  '</head>\n' +
  '<body>\n' +
  // Overlays
  '    ' + overlaysHtml.trim() + '\n' +
  // Login screen
  '    ' + screenHomeHtml.trim() + '\n' +
  // Game screen wrapper
  '    <!-- ===== GAME SCREEN ===== -->\n' +
  '    <div class="screen" id="screenGame">\n' +
  '        <div class="game-wrapper game-wrapper-mobile">\n' +
  // Admin button + host only msg
  '            <button class="btn-admin-open" id="btnAdminOpen" style="display:none" onclick="abrirAdminScreen()">Admin</button>\n' +
  '            <div id="hostOnlyMsg" style="display:none;text-align:center;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;margin:4px 12px;font-size:13px;color:#cbd5e1">Voce e o anfitriao</div>\n' +
  // test's body content (game screen) - remove demo script
  test.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script>[\s\S]*$/, '').trim() + '\n' +
  // Close game screen
  '        </div>\n' +
  '    </div>\n' +
  // Admin screen
  '    ' + screenAdminHtml.trim() + '\n' +
  // Countdown overlay
  '    ' + countdownHtml.trim() + '\n' +
  // Modals
  '    ' + modalsHtml.trim() + '\n' +
  // WhatsApp
  '    ' + whatsappHtml.trim() + '\n' +
  // Scripts
  '    ' + scriptsHtml.trim() + '\n' +
  '</body>\n' +
  '</html>';

// Write
fs.writeFileSync('index.html', finalHtml, 'utf8');

// Verify
const verify = fs.readFileSync('index.html', 'utf8');
console.log('=== ENCODING ===');
['Conexão','Não','Manutenção','ação','Créditos','Bônus','Números','Próximas'].forEach(w => console.log(w + ':', verify.includes(w) ? 'OK' : 'MOJIBAKE'));
console.log('Nulls:', verify.indexOf('\x00') >= 0 ? 'FOUND' : 'none');
console.log('\n=== EMOJIS ===');
['🎯','💰','🔑','⚙️','🔄','🎟️'].forEach(e => console.log(e + ':', verify.includes(e) ? 'OK' : 'MISSING'));
console.log('\n=== SIZE ===');
console.log('Size:', finalHtml.length, 'bytes');
