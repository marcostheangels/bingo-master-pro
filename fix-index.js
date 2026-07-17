const fs=require('fs');
let c=fs.readFileSync('index.html','utf8');
// 1. Reduce players container height to 270px
c=c.replace(/\.players-container\{height:380px;/, '.players-container{height:270px;');
// 2. Remove history-balls div from game-display
c=c.replace(/<div class="history-balls" id="historyBalls">[\s\S]*?<\/div>\s*/, '');
// 3. Ensure no history-box in info-column (not present)
fs.writeFileSync('index.html',c,'utf8');
console.log('modifications applied');