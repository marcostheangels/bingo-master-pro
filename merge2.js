const fs = require('fs');

// Read source files directly (they have correct UTF-8)
const t1 = fs.readFileSync('teste1.html', 'utf8');
const idx = fs.readFileSync('index.html', 'utf8');

// Extract the CSS from teste1.html
const cssMatch = t1.match(/<style>([\s\S]*?)<\/style>/);
const t1Css = cssMatch ? cssMatch[1].trim() : '';

// Build the merged HTML cleanly - read sections from the real index.html
// by extracting the body sections

// Extract all overlay/modals/login/admin from index.html
function extractBetween(start, end) {
  const si = idx.indexOf(start);
  if (si === -1) return '';
  const ei = end ? idx.indexOf(end, si + start.length) : idx.length;
  return idx.substring(si, ei !== -1 ? ei : idx.length);
}

// Sections to extract from the real index.html (clean source)
const sections = [];

// Overlays
sections.push(extractBetween(
  '    <!-- Overlays -->',
  '    <!-- ===== REGISTER / LOGIN SCREEN ===== -->'
).trim());

// Login screen
sections.push(extractBetween(
  '    <!-- ===== REGISTER / LOGIN SCREEN ===== -->',
  '    <!-- ===== GAME SCREEN ===== -->'
).trim());

// Everything after game screen comment to end
const allAfterGame = idx.substring(idx.indexOf('<!-- ===== GAME SCREEN ===== -->'));

// Admin screen
const adminMatch = allAfterGame.match(/<!-- ===== ADMIN SCREEN ===== -->[\s\S]*?<!-- ===== COUNTDOWN OVERLAY ===== -->/);
if (adminMatch) sections.push(adminMatch[0].trim());

// Countdown overlay
const countdownMatch = allAfterGame.match(/<!-- ===== COUNTDOWN OVERLAY ===== -->[\s\S]*?<!-- ===== MODAL PIX ===== -->/);
if (countdownMatch) sections.push(countdownMatch[0].trim());

// Modals
const modalsMatch = allAfterGame.match(/<!-- ===== MODAL PIX ===== -->[\s\S]*?<!-- ===== WHATSAPP ===== -->/);
if (modalsMatch) sections.push(modalsMatch[0].trim());

// WhatsApp
const waMatch = allAfterGame.match(/<!-- ===== WHATSAPP ===== -->[\s\S]*?<script/);
if (waMatch) sections.push(waMatch[0].trim());

// Scripts
const scriptsMatch = allAfterGame.match(/<script[\s\S]*?<\/script>\s*<\/body>/);
if (scriptsMatch) sections.push(scriptsMatch[0].trim());

// Build the game screen from teste1.html's body (with required IDs)
// Take teste1.html body content between body tags
const t1BodyMatch = t1.match(/<body>([\s\S]*)<\/body>/);
const t1Body = t1BodyMatch ? t1BodyMatch[1].trim() : '';

// Now build the merged HTML
const merged = '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n' +
  '    <meta charset="UTF-8">\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
  '    <meta name="theme-color" content="#06030f">\n' +
  '    <meta name="mobile-web-app-capable" content="yes">\n' +
  '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n' +
  '    <title>BINGO VIP CLUB</title>\n' +
  '    <link rel="manifest" href="manifest.json">\n' +
  '    <link rel="apple-touch-icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Ctext y=\'.9em\' font-size=\'90\'%3E\uD83C\uDFB1%3C/text%3E%3C/svg%3E">\n' +
  '    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">\n' +
  '    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">\n' +
  '    <link rel="stylesheet" href="style.css">\n' +
  '    <style>\n' +
  t1Css + '\n' +
  '.screen.active { display: flex !important; }\n' +
  '#screenHome { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000; justify-content: center; align-items: center; background: linear-gradient(180deg,#05052e 0%,#04042a 100%); }\n' +
  '#screenGame { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }\n' +
  '#screenAdmin { display: none; }\n' +
  '#screenAdmin.active { display: flex; flex-direction: column; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9998; overflow-y: auto; background: rgba(6,3,15,.98); }\n' +
  '</style>\n</head>\n<body>\n\n' +
  sections.join('\n\n') + '\n\n' +
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js"></script>\n' +
  '<script src="game-logic.js"></script>\n<script src="network.js"></script>\n' +
  '</body>\n</html>';

// Now replace the game screen body with teste1.html's game body
// Find the game screen section and replace it
const gameScreenStart = merged.indexOf('<!-- ===== GAME SCREEN ===== -->');
const gameScreenEnd = merged.indexOf('<!-- ===== ADMIN SCREEN ===== -->');

if (gameScreenStart !== -1 && gameScreenEnd !== -1) {
  // Keep the game screen DIV wrapper, replace inner content
  const gameScreenOpen = merged.substring(gameScreenStart, merged.indexOf('>', merged.indexOf('<div class="screen" id="screenGame"')) + 1);
  const adminPart = merged.substring(gameScreenEnd);
  
  const newGameScreen = gameScreenOpen + '\n' +
    '        <div class="game-wrapper game-wrapper-mobile">\n' +
    '            <button class="btn-admin-open" id="btnAdminOpen" style="display:none;position:fixed;top:8px;left:8px;z-index:100;background:linear-gradient(135deg,#8b5cff,#6d3fd1);color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer" onclick="abrirAdminScreen()">\u2699\ufe0f Admin</button>\n' +
    '            <div id="hostOnlyMsg" style="display:none;text-align:center;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;margin:4px 12px;font-size:13px;color:#cbd5e1">\ud83c\udfaf Voce eh o anfitriao - controle o jogo pelos botoes abaixo</div>\n' +
    t1Body + '\n' +
    '        </div>\n' +
    '    </div>\n' +
    adminPart;
  
  const withGame = merged.replace(merged.substring(gameScreenStart), newGameScreen);
  
  // Check all required IDs
  const netJs = fs.readFileSync('network.js', 'utf8');
  const glJs = fs.readFileSync('game-logic.js', 'utf8');
  const netIds = new Set([...netJs.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
  const glIds = new Set([...glJs.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
  const allIds = new Set([...netIds, ...glIds]);
  const htmlIds = new Set([...withGame.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]));
  const dynamicIds = new Set(['editNome', 'editEmail', 'editSenha', 'editPix', 'editStatus', 'kenoRankingOverlay', 'soundHint']);
  
  const missing = [];
  allIds.forEach(id => { if (!htmlIds.has(id) && !dynamicIds.has(id)) missing.push(id); });
  
  if (missing.length > 0) {
    console.log('MISSING IDs:', missing.join(', '));
    process.exit(1);
  }
  
  // Also verify no mojibake by checking if accented chars exist
  const accentChecks = ['Conex\u00e3o', 'N\u00e3o', 'Manuten\u00e7\u00e3o'];
  const accentOk = accentChecks.every(w => withGame.includes(w));
  if (!accentOk) {
    console.log('MOJIBAKE DETECTED after merge!');
    process.exit(1);
  }
  
  fs.writeFileSync('index.html', withGame, 'utf8');
  console.log('ALL ' + allIds.size + ' IDs PRESENT. No mojibake. File written (' + withGame.length + ' bytes)');
} else {
  console.log('Could not find game screen boundaries');
  console.log('gameScreenStart:', gameScreenStart);
  console.log('gameScreenEnd:', gameScreenEnd);
  process.exit(1);
}
