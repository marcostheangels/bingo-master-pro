const fs = require('fs');

let c = fs.readFileSync('index.html', 'utf8');

const fixes = [
  // Lowercase accented (UTF-8 bytes as Latin-1 -> correct char)
  ['\u00C3\u00A0', '\u00E0'], // Ã  -> à
  ['\u00C3\u00A1', '\u00E1'], // Ã¡ -> á
  ['\u00C3\u00A2', '\u00E2'], // Ã¢ -> â
  ['\u00C3\u00A3', '\u00E3'], // Ã£ -> ã
  ['\u00C3\u00A4', '\u00E4'], // Ã¤ -> ä
  ['\u00C3\u00A5', '\u00E5'], // Ã¥ -> å
  ['\u00C3\u00A7', '\u00E7'], // Ã§ -> ç
  ['\u00C3\u00A8', '\u00E8'], // Ã¨ -> è
  ['\u00C3\u00A9', '\u00E9'], // Ã© -> é
  ['\u00C3\u00AA', '\u00EA'], // Ãª -> ê
  ['\u00C3\u00AB', '\u00EB'], // Ã« -> ë
  ['\u00C3\u00AC', '\u00EC'], // Ã¬ -> ì
  ['\u00C3\u00AD', '\u00ED'], // Ã­ -> í
  ['\u00C3\u00AE', '\u00EE'], // Ã® -> î
  ['\u00C3\u00AF', '\u00EF'], // Ã¯ -> ï
  ['\u00C3\u00B1', '\u00F1'], // Ã± -> ñ
  ['\u00C3\u00B2', '\u00F2'], // Ã² -> ò
  ['\u00C3\u00B3', '\u00F3'], // Ã³ -> ó
  ['\u00C3\u00B4', '\u00F4'], // Ã´ -> ô
  ['\u00C3\u00B5', '\u00F5'], // Ãµ -> õ
  ['\u00C3\u00B6', '\u00F6'], // Ã¶ -> ö
  ['\u00C3\u00B9', '\u00F9'], // Ã¹ -> ù
  ['\u00C3\u00BA', '\u00FA'], // Ãº -> ú
  ['\u00C3\u00BB', '\u00FB'], // Ã» -> û
  ['\u00C3\u00BC', '\u00FC'], // Ã¼ -> ü
  // Uppercase accented
  ['\u00C3\u0080', '\u00C0'], // À
  ['\u00C3\u0081', '\u00C1'], // Á
  ['\u00C3\u0082', '\u00C2'], // Â
  ['\u00C3\u0083', '\u00C3'], // Ã (this IS the correct Ã)
  ['\u00C3\u0087', '\u00C7'], // Ç
  ['\u00C3\u0089', '\u00C9'], // É
  ['\u00C3\u008A', '\u00CA'], // Ê
  ['\u00C3\u008D', '\u00CD'], // Í
  ['\u00C3\u0093', '\u00D3'], // Ó
  ['\u00C3\u0094', '\u00D4'], // Ô
  ['\u00C3\u0096', '\u00D6'], // Ö
  ['\u00C3\u009A', '\u00DA'], // Ú
  ['\u00C3\u009C', '\u00DC'], // Ü
];

let total = 0;
for (const [from, to] of fixes) {
  const before = c.split(from).length - 1;
  if (before > 0) {
    c = c.split(from).join(to);
    total += before;
  }
}

fs.writeFileSync('index.html', c, 'utf8');
console.log(`Fixed ${total} mojibake occurrences.`);

// Verify
const v = fs.readFileSync('index.html', 'utf8');
const words=['Conexão','Não','Manutenção','ação','irreversível','grátis','Mínimo',
  'aleatória','Já','Faça','Você','notificações','Doação','Números','Créditos','Bônus','sacável'];
let allOk = true;
words.forEach(w => {
  if (!v.includes(w)) { console.log('  BROKEN:', w); allOk = false; }
});
if (allOk) console.log('ALL WORDS FIXED!');
