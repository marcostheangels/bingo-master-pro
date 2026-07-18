const fs = require('fs');

const test = fs.readFileSync('teste1.html', 'utf8');
const app = fs.readFileSync('orig-app.html', 'utf8');

// Extract test's inline CSS (visual 3D effects)
const testCss = /<style>([\s\S]*?)<\/style>/.exec(test)[1];

// Overlay CSS (not in style.css)
const overlayCss = `
.spinner-overlay { position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:99999; }
.spinner-overlay.visible { display:flex; }
.spinner { width:50px;height:50px;border:4px solid rgba(255,255,255,.1);border-top-color:#8b5cff;border-radius:50%;animation:spin .8s linear infinite; }
@keyframes spin { to{transform:rotate(360deg)} }
.spinner-text { color:#cbd5e1;font-size:14px;margin-top:16px;font-weight:600; }
.offline-banner { position:fixed;top:0;left:0;width:100%;padding:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;text-align:center;font-weight:700;font-size:13px;z-index:99998;display:none; }
.manutencao-banner { position:fixed;top:0;left:0;width:100%;padding:10px 16px;background:linear-gradient(135deg,#f59e0b,#d97706);z-index:99997;display:flex;align-items:center;gap:10px;display:none; }
.toast-container { position:fixed;top:70px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px; }
.toast-item { padding:12px 20px;border-radius:10px;color:#fff;font-weight:700;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:ti .3s ease;max-width:340px; }
@keyframes ti { from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
.countdown-overlay { position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.75);z-index:9990;display:none;justify-content:center;align-items:center; }
.countdown-overlay.visible { display:flex; }
.countdown-content { text-align:center; }
.countdown-label { font-size:14px;color:#fbbf24;font-weight:700;margin-bottom:12px;letter-spacing:1px; }
.countdown-timer { font-size:72px;font-weight:800;color:#fff;text-shadow:0 0 30px rgba(139,92,255,.5); }
.auto-start-timer { font-size:20px;color:#9d96d4;margin-top:6px; }
.countdown-hint { font-size:13px;color:#9d96d4;margin-top:14px; }
`;

// Start with app as base (has all functional HTML, overlays, modals, scripts)
let result = app;

// Remove old style.css link
result = result.replace('<link rel="stylesheet" href="style.css?v=32">', '');

// Add combined CSS: test's 3D visual CSS + overlay CSS + link to style.css for login/admin
result = result.replace('</head>',
  '    <link rel="stylesheet" href="style.css">\n' +
  '    <style>\n' + testCss + overlayCss + '    </style>\n' +
  '</head>'
);

// Fix: add ID to liveClock in app
// App header already has id="liveClock" so we just need the CSS to handle it correctly

// Write
fs.writeFileSync('index.html', result, 'utf8');

// Verify
const verify = fs.readFileSync('index.html', 'utf8');
const checks = ['screenHome', 'screenGame', 'screenAdmin', 'spinner-overlay', 
  'countdownOverlay', 'currentRoundNumber', 'liveClock', 'playerListUI',
  'myCardsGrid', 'buyQtyInput', 'pixValor', 'adminPlayerSelect'];
checks.forEach(c => console.log(c + ':', verify.includes(c) ? 'OK' : 'MISSING'));
console.log('Size:', fs.statSync('index.html').size, 'bytes');
