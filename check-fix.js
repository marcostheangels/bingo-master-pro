const {execSync}=require('child_process');
const c=execSync('git show 95f6581:index.html',{encoding:'utf8'});
const idx=c.lastIndexOf('async function');
if(idx>=0) console.log(c.substring(idx, idx+500));
console.log('---');
// Check if fix is there
if(c.includes("hideSpinner()")) console.log('FIX PRESENT: hideSpinner() called after no session');
else console.log('FIX MISSING: hideSpinner not called after no session');
