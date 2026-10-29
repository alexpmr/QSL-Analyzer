import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCty,attachDxcc} from '../src/cty.mjs';
import {parseLog} from '../src/parsers.mjs';
import {enrich} from '../src/db.mjs';
import * as S from '../src/stats.mjs';
import {translate} from '../src/i18n.mjs';
import {ALL_SECTIONS,defaultParams} from '../ui/pages.mjs';

const cty=attachDxcc(parseCty(readFileSync('src/data/cty.dat','utf8')),JSON.parse(readFileSync('src/data/dxcc.json','utf8')));
let adif='<EOH>\n';
const calls=['K1ABC','DL1XYZ','JA1AAA','PY2ZZ','VK2AB','LU1ZZ','G3ABC','K1ABC'];
calls.forEach((c,i)=>{adif+=`<CALL:${c.length}>${c} <QSO_DATE:8>2024030${1+(i%3)} <TIME_ON:4>1${i}05 <BAND:3>${i%2?'20m':'40m'} <MODE:${i%2?3:2}>${i%2?'SSB':'CW'} <STATION_CALLSIGN:6>PT2VHF <MY_GRIDSQUARE:4>GH64 <GRIDSQUARE:4>FN42 ${i%3?'<LOTW_QSL_RCVD:1>Y ':''}<EOR>\n`;});
const qsos=S.byTime(parseLog(adif,'x.adi').qsos.map((q,i)=>({...enrich(q,cty),id:i+1})));

for(const lang of ['pt-BR','en']){
  test(`every statistics page renders (${lang})`,()=>{
    const ctx={t:(k,v)=>translate(lang,k,v),qsos,prefs:{pointsRule:'adif'},cty,points:S.pointsFn('adif'),home:{lat:-15.8,lon:-47.9},report:false};
    for(const page of ALL_SECTIONS){
      const r=page.render(ctx,defaultParams(page));
      assert.ok(r.html.length>50,page.id);
      assert.ok(!/undefined|NaN|\[object Object\]/.test(r.html.replace(/data-[a-z]+="[^"]*"/g,'')),page.id+' renders invalid text');
      for(const tb of r.tables)assert.ok(Array.isArray(tb.head)&&Array.isArray(tb.rows),page.id);
    }
  });
}

test('pages tolerate an empty selection',()=>{
  const ctx={t:k=>k,qsos:[],prefs:{pointsRule:'one'},cty,points:()=>1,home:null,report:true};
  for(const page of ALL_SECTIONS)assert.doesNotThrow(()=>page.render(ctx,defaultParams(page)),page.id);
});
