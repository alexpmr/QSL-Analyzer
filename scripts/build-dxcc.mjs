// Gera src/data/dxcc.json associando as entidades do CTY.DAT aos códigos ADIF DXCC.
// Uso: node scripts/build-dxcc.mjs <dxcc.json de github.com/k0swe/dxcc-json>
import {readFileSync,writeFileSync} from 'node:fs';
import {parseCty} from '../src/cty.mjs';
const source=JSON.parse(readFileSync(process.argv[2],'utf8')).dxcc;
const cty=parseCty(readFileSync('src/data/cty.dat','utf8'));
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'');
const current=source.filter(e=>!e.deleted);
// Correções para entidades que compartilham prefixo base no CTY.DAT.
const FIX={'3Y/p':199,'4U1U':289,'4U1V':206,'CE0X':217,'FT/j':124,'FT/w':41,'FT/z':10,'HK0/a':216,'JD/o':192};
const out=[],missing=[];
for(const entity of cty.entities){
  const p=entity.prefix;
  const bare=p.replace(/\/.*/,'');
  const byName=current.find(e=>norm(e.name)===norm(entity.name));
  const listed=current.filter(e=>e.prefix.split(',').map(v=>v.trim()).includes(bare));
  let pick=FIX[p]?current.find(e=>e.entityCode===FIX[p]):null;
  pick=pick||byName||(entity.waeOnly?null:listed[0]);
  if(!pick){
    let best=null,len=0;
    for(const e of current)for(const v of e.prefix.split(',').map(v=>v.trim()))if(v&&bare.startsWith(v)&&v.length>len){best=e;len=v.length;}
    pick=best;
  }
  if(!pick)pick=current.find(e=>{try{return new RegExp(e.prefixRegex).test(bare+'1A');}catch{return false;}});
  if(!pick){missing.push(entity.name+' '+p);continue;}
  out.push({ctyPrefix:p,dxcc:pick.entityCode,cc:pick.countryCode||null,name:pick.name});
}
writeFileSync('src/data/dxcc.json',JSON.stringify(out));
console.log(out.length,'mapeadas; sem código:',missing.join(' | '));
