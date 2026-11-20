// Run after build. Values are never printed, including on failure.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const patterns=[/sk-[A-Za-z0-9_-]{20,}/,/sb_secret_[A-Za-z0-9_-]+/,/VITE_OPENAI_API_KEY/,/OPENAI_API_KEY/];
let checked=0;
function walk(dir){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    if(item.isDirectory())walk(file);
    else if(/\.(js|css|html|map|json)$/.test(item.name)){
      checked++;
      if(patterns.some(p=>p.test(fs.readFileSync(file,'utf8'))))throw new Error('Private credential marker in frontend bundle');
    }
  }
}
walk(root);
console.log(JSON.stringify({check:'frontend_private_credential_scan',files:checked,status:'PASS'}));
