const fs = require('fs');
const style = fs.readFileSync('style.css', 'utf8');
const test = fs.readFileSync('teste1.html', 'utf8');
const testCss = /<style>([\s\S]*?)<\/style>/.exec(test)[1];

var screenGameRules = '\n' +
'#screenGame { display:none !important; }\n' +
'#screenGame.active { display:flex !important; flex-direction:column !important; align-items:stretch !important; justify-content:flex-start !important; padding:0 !important; overflow:hidden !important; height:100vh !important; }\n' +
'#screenGame .game-wrapper, #screenGame .game-wrapper.game-wrapper-mobile { display:flex !important; flex-direction:column !important; width:100% !important; max-width:none !important; margin:0 !important; padding:8px !important; gap:0 !important; height:100vh !important; overflow:hidden !important; flex:1 1 auto; min-height:0; }\n' +
'#screenGame .game-body { all:unset; display:contents; }\n';

const themeStart = style.indexOf('/* =========================================================');
const funcStart = style.indexOf('TEMA 3D — TELAS DE LOGIN');
const newStyle = style.substring(0, themeStart) + '\n' + testCss + '\n' + screenGameRules + style.substring(funcStart);
fs.writeFileSync('style.css', newStyle, 'utf8');
console.log('Done, size:', fs.statSync('style.css').size, 'bytes');
