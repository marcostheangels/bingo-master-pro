const fs=require('fs');
const c=fs.readFileSync('index.html','utf8');

// Check encoding
const words=['Conexão','Não','Manutenção','ação','Créditos','Bônus','Números','Próximas'];
console.log('=== ENCODING ===');
words.forEach(w => console.log(w+':', c.includes(w) ? 'OK' : 'MOJIBAKE'));

// Check null chars
console.log('Null chars:', c.indexOf('\x00') >= 0 ? 'FOUND!' : 'none');

// Check emojis
const emojis=['🎯','💰','🔑','⚙️','🔄','🎟️'];
console.log('\n=== EMOJIS ===');
emojis.forEach(e => console.log(e+':', c.includes(e) ? 'OK' : 'MISSING'));

// Check required IDs
const netJs=fs.readFileSync('network.js','utf8');
const glJs=fs.readFileSync('game-logic.js','utf8');
const netIds=new Set([...netJs.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]));
const glIds=new Set([...glJs.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]));
const allIds=new Set([...netIds,...glIds]);
const htmlIds=new Set([...c.matchAll(/id=["']([^"']+)["']/g)].map(m=>m[1]));
const dynamicIds=new Set(['editNome','editEmail','editSenha','editPix','editStatus','kenoRankingOverlay','soundHint']);
const missing=[];
allIds.forEach(id=>{if(!htmlIds.has(id)&&!dynamicIds.has(id))missing.push(id)});
console.log('\n=== REQUIRED IDs ===');
if(missing.length===0) console.log('ALL '+allIds.size+' IDs PRESENT');
else console.log('MISSING ('+missing.length+'):', missing.join(', '));
