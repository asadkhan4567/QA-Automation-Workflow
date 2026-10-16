const fs=require('fs');eval(fs.readFileSync(process.argv[2],'utf8'));
const z=fs.readFileSync(process.argv[3]);const f=unzip(z);
for(const [k,v] of Object.entries(f)){const s=new TextDecoder().decode(v);const o=fs.readFileSync(process.argv[4],'utf8');console.log(k,v.length,s===o?'MATCH':'DIFF');}
