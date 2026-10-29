import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCty,attachDxcc} from '../src/cty.mjs';
import {parseLog} from '../src/parsers.mjs';
import {emptyDb,migrate,enrich,createImporter,removeDupesFiltered} from '../src/db.mjs';
import * as A from '../src/awards.mjs';
import * as I from '../src/insights.mjs';
import {parseQrz,parseHamqth,qrzLoginUrl,qrzLookupUrl} from '../src/lookup.mjs';

const cty=attachDxcc(parseCty(readFileSync('src/data/cty.dat','utf8')),JSON.parse(readFileSync('src/data/dxcc.json','utf8')));
const rec=(c,d,tm,b,m,extra='')=>`<CALL:${c.length}>${c} <QSO_DATE:8>${d} <TIME_ON:4>${tm} <BAND:${b.length}>${b} <MODE:${m.length}>${m} <STATION_CALLSIGN:6>PT2VHF <MY_GRIDSQUARE:4>GH64 ${extra}<EOR>\n`;
const adif='<EOH>\n'+rec('K1ABC','20240310','1200','20m','SSB','<STATE:2>MA <GRIDSQUARE:4>FN42 <LOTW_QSL_RCVD:1>Y ')+rec('DL1XYZ','20240311','1300','20m','CW','<GRIDSQUARE:4>JO62 ')+rec('JA1AAA','20230310','1400','15m','FT8','<GRIDSQUARE:4>PM95 <QSL_RCVD:1>Y ')+rec('K1ABC','20240312','1200','40m','CW')+rec('K1ABC','20240312','1202','40m','CW')+rec('PY2VHF','20240313','1500','2m','FM','<GRIDSQUARE:4>GG66 ')+rec('PT2VHF','20240313','1501','2m','FM')+rec('PT2VHF','20240313','1530','2m','FM')+rec('PT2VHF','20240314','1530','2m','FM')+rec('PT2VHF','20240315','1530','2m','FM')+rec('PT2VHF','20240316','1530','2m','FM');
const qsos=parseLog(adif,'a.adi').qsos.map((q,i)=>({...enrich(q,cty),id:i+1}));

test('awards: DXCC, WAS, WAZ, unconfirmed and rare',()=>{
  const d=A.dxccAward(qsos,cty);
  assert.ok(d.total>330);
  assert.equal(d.categories[0].worked,4);assert.equal(d.categories[0].confirmed,2);
  assert.equal(d.categories.find(c=>c.key==='cw').worked,2);
  const was=A.wasAward(qsos);assert.equal(was.rows.find(r=>r.key==='MA').confirmed,true);
  assert.equal(A.wazAward(qsos).rows.filter(r=>r.worked).length,4);
  const un=A.unconfirmed(qsos);assert.deepEqual(un.map(u=>u.country).sort(),['Brazil','Fed. Rep. of Germany']);
  assert.equal(A.rareWorked(qsos,cty).length,A.RARE_DXCC.length);
  assert.equal(A.vuccAward(qsos)[0].band,'2m');
});

test('insights: summary, periods, friends, new calls, propagation, health',()=>{
  const f=I.summaryFacts(qsos,{home:{lat:-15.8,lon:-47.9},now:Date.UTC(2024,3,1)});
  assert.equal(f.total,qsos.length);assert.equal(f.farthest.call,'JA1AAA');assert.ok(f.dxcc>=4);
  const p=I.comparePeriods(qsos,[Date.UTC(2024,0,1),Date.UTC(2025,0,1)],[Date.UTC(2023,0,1),Date.UTC(2024,0,1)]);
  assert.equal(p.b.qsos,1);assert.equal(p.a.qsos,qsos.length-1);assert.ok(p.newDxcc.some(q=>q.call==='K1ABC'));
  const fr=I.friends(qsos,{minQsos:3,months:1,now:Date.UTC(2024,6,1)});assert.equal(fr.frequent[0].call,'PT2VHF');assert.ok(fr.missing.some(x=>x.call==='K1ABC'));
  const nc=I.newCallsPerPeriod(qsos,'year');assert.equal(nc[0].period,'2023');assert.equal(nc[nc.length-1].cumulative,5);
  const pr=I.propagation(qsos,{home:{lat:-15.8,lon:-47.9}});assert.ok(pr.months.includes('2024-03'));assert.ok(pr.byCont.length>=3);
  const h=I.logHealth(qsos);
  assert.equal(h.nearDupes.length,1);
  assert.ok(h.typos.some(x=>x.q.call==='PY2VHF'&&x.suggestion==='PT2VHF'));
});

test('contests',()=>{
  const c=parseLog('<EOH>\n'+rec('K1ABC','20241026','0001','20m','SSB','<CONTEST_ID:9>CQ-WW-SSB ')+rec('DL1XYZ','20241026','0101','20m','SSB','<CONTEST_ID:9>CQ-WW-SSB ')+rec('JA1AAA','20231028','0101','15m','SSB','<CONTEST_ID:9>CQ-WW-SSB '),'c.adi').qsos.map((q,i)=>({...enrich(q,cty),id:i+1}));
  const list=I.contests(c);assert.equal(list.length,2);
  const r=I.contestAnalysis(c,list[0].key);assert.equal(r.current.qsos,2);assert.equal(r.previous.qsos,1);assert.equal(r.current.mults.dxcc,2);
});

test('database: containers unified without duplicates, importer stats, dupes in filter',()=>{
  const raw=emptyDb();raw.containers.push({id:'x',name:'X'});
  raw.qsos=[{id:1,c:'main',station:'PT2VHF',call:'K1ABC',band:'20m',mode:'SSB',ts:1000*60*10},{id:2,c:'x',station:'PT2VHF',call:'K1ABC',band:'20m',mode:'SSB',ts:1000*60*10,lotwRcvd:'Y'},{id:3,c:'x',station:'PT2VHF',call:'DL1XYZ',band:'20m',mode:'CW',ts:1000*60*20}];
  const db=migrate(raw);
  assert.equal(db.containers.length,1);assert.equal(db.qsos.length,2);assert.ok(db.qsos.every(q=>q.c==='main'));assert.equal(db.qsos.find(q=>q.call==='K1ABC').lotwRcvd,'Y');
  const imp=createImporter(db,'main');imp.add(qsos.slice(0,3));const st=imp.add(qsos.slice(0,3));
  assert.equal(st.added,3);assert.equal(st.skipped,3);
  imp.finish('t');
  const n=removeDupesFiltered(db,{});assert.ok(n>=0);
});

test('lookup: QRZ and HamQTH XML',()=>{
  assert.match(qrzLoginUrl('u','p&x'),/username=u;password=p%26x/);assert.match(qrzLookupUrl('K','PT2VHF'),/s=K;callsign=PT2VHF/);
  const login=parseQrz('<QRZDatabase><Session><Key>abc</Key><SubExp>non-subscriber</SubExp></Session></QRZDatabase>');assert.equal(login.key,'abc');assert.equal(login.limited,true);
  const r=parseQrz('<QRZDatabase><Callsign><call>PT2VHF</call><fname>Alex</fname><name>Rodrigues</name><addr2>Brasilia</addr2><country>Brazil</country><grid>GH64</grid><lat>-15.8</lat><lon>-47.9</lon><image>https://cdn-xml.qrz.com/x.jpg</image><lotw>1</lotw></Callsign><Session><Key>abc</Key></Session></QRZDatabase>');
  assert.equal(r.data.name,'Alex Rodrigues');assert.equal(r.data.grid,'GH64');assert.equal(r.data.lotw,true);assert.equal(r.data.lat,-15.8);
  assert.equal(parseQrz('<QRZDatabase><Session><Error>Not found: XX1XX</Error></Session></QRZDatabase>').notFound,true);
  assert.equal(parseHamqth('<HamQTH><session><session_id>s1</session_id></session></HamQTH>').key,'s1');
  const h=parseHamqth('<HamQTH><search><callsign>pt2vhf</callsign><nick>Alex</nick><qth>Brasilia</qth><country>Brazil</country><grid>GH64</grid><picture>https://www.hamqth.com/p.jpg</picture></search></HamQTH>');
  assert.equal(h.data.call,'PT2VHF');assert.equal(h.data.image,'https://www.hamqth.com/p.jpg');
});
