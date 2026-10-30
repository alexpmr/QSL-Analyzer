import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCty,lookup,attachDxcc,prefixBase,wpxPrefix} from '../src/cty.mjs';
import {parseLog,detectFormat,parseAdifRecords} from '../src/parsers.mjs';
import {emptyDb,importQsos,createContainer,stations,deleteByStations,applyFilter,copyFilter,reprocess,enrich} from '../src/db.mjs';
import * as S from '../src/stats.mjs';
import {toAdif,toCsv,toKml,toCabrillo} from '../src/export.mjs';
import {parseResponse,buildRequest} from '../src/platforms.mjs';

const cty=attachDxcc(parseCty(readFileSync('src/data/cty.dat','utf8')),JSON.parse(readFileSync('src/data/dxcc.json','utf8')));
const adif=`Teste <ADIF_VER:5>3.1.4 <EOH>
<CALL:5>K1ABC <QSO_DATE:8>20240310 <TIME_ON:4>1200 <BAND:3>20m <MODE:3>SSB <STATION_CALLSIGN:6>PT2VHF <GRIDSQUARE:4>FN42 <QSL_RCVD:1>Y <EOR>
<call:6>DL1XYZ <qso_date:8>20240310 <time_on:6>120500 <freq:6>14.074 <mode:4>MFSK <submode:3>FT4 <station_callsign:6>PT2VHF <EOR>
<CALL:5>K1ABC <QSO_DATE:8>20240310 <TIME_ON:4>1210 <BAND:3>20m <MODE:3>USB <STATION_CALLSIGN:6>PT2VHF <EOR>
<CALL:6>JA1AAA <QSO_DATE:8>20240310 <TIME_ON:4>1300 <BAND:3>15m <MODE:2>CW <STATION_CALLSIGN:6>PT2VHF <NAME:5>Joãoz <EOR>
`;

test('cty lookup resolves entities and DXCC codes',()=>{
  assert.ok(cty.entities.length>300);
  assert.equal(lookup(cty,'PT2VHF').country,'Brazil');
  assert.equal(lookup(cty,'PT2VHF').dxcc,108);
  assert.equal(lookup(cty,'K1ABC').dxcc,291);
  assert.equal(lookup(cty,'CT3/PT2VHF').country,'Madeira Islands');
  assert.equal(lookup(cty,'DL1XYZ/P').cont,'EU');
  assert.equal(prefixBase('W1ABC/4'),'W4');
  assert.equal(wpxPrefix('PT2VHF'),'PT2');
});

test('ADIF parser handles header, lowercase tags and submodes',()=>{
  const r=parseLog(adif,'log.adi');
  assert.equal(r.format,'adif');assert.equal(r.qsos.length,4);
  assert.equal(r.qsos[1].mode,'FT4');assert.equal(r.qsos[1].band,'20m');
  assert.equal(r.qsos[2].mode,'SSB');assert.equal(r.qsos[3].name,'Joãoz');
});

test('ADIF byte-length fields with UTF-8',()=>{
  const r=parseAdifRecords('<CALL:4>PY1A <NAME:5>João <EOR>');
  assert.equal(r.records[0].NAME,'João');
});

test('Cabrillo, EDI and CSV parsing',()=>{
  const cab=`START-OF-LOG: 3.0\nCALLSIGN: PT2VHF\nCONTEST: CQ-WW-SSB\nOPERATORS: PT2VHF\nQSO: 14200 PH 2024-10-26 0001 PT2VHF        59  11     K1ABC         59  05\nQSO:  7050 CW 2024-10-26 0002 PT2VHF        599 11     DL1XYZ        599 14     1\nEND-OF-LOG:\n`;
  const c=parseLog(cab,'x.log');
  assert.equal(c.format,'cabrillo');assert.equal(c.qsos.length,2);assert.equal(c.qsos[0].call,'K1ABC');assert.equal(c.qsos[0].mode,'SSB');assert.equal(c.qsos[1].band,'40m');assert.equal(c.qsos[1].srx,'599 14');
  const edi=`[REG1TEST;1]\nTName=Teste VHF\nPCall=PT2VHF\nPWWLo=GH64\nPBand=144 MHz\n[QSORecords;1]\n240501;1200;PY2ABC;1;59;001;59;005;;GG66;300;;N;N;\n`;
  const e=parseLog(edi,'x.edi');assert.equal(e.qsos[0].band,'2m');assert.equal(e.qsos[0].grid,'GG66');assert.equal(e.qsos[0].points,300);
  const csv='Call;Date;Time;Band;Mode\nPY2ABC;2024-05-01;12:00;40m;LSB\n';
  const v=parseLog(csv,'x.csv');assert.equal(v.format,'csv');assert.equal(v.qsos[0].mode,'SSB');assert.equal(v.qsos[0].ts,Date.UTC(2024,4,1,12,0));
  assert.equal(detectFormat('<ADX><RECORDS></RECORDS></ADX>','a.adx'),'adx');
  const adx=parseLog('<?xml version="1.0"?><ADX><HEADER></HEADER><RECORDS><RECORD><CALL>K1ABC</CALL><QSO_DATE>20240101</QSO_DATE><TIME_ON>0101</TIME_ON><BAND>20M</BAND><MODE>CW</MODE><APP PROGRAMID="N1MM" FIELDNAME="RADIO_NR" TYPE="S">2</APP></RECORD></RECORDS></ADX>','a.adx');
  assert.equal(adx.qsos[0].radio,'2');assert.equal(adx.qsos[0].band,'20m');
});

test('incremental import skips existing QSOs and merges QSL status',()=>{
  const db=emptyDb();
  const first=parseLog(adif,'a.adi').qsos.map(q=>enrich(q,cty));
  assert.deepEqual(importQsos(db,first,'main'),{added:4,skipped:0,merged:0});
  const again=parseLog(adif.replace('<TIME_ON:4>1300 <BAND:3>15m <MODE:2>CW','<TIME_ON:6>130030 <BAND:3>15m <MODE:2>CW <LOTW_QSL_RCVD:1>Y'),'b.adi').qsos;
  const r=importQsos(db,again,'main');
  assert.equal(r.added,0);assert.equal(r.skipped,4);assert.equal(r.merged,1);
  assert.equal(db.qsos.find(q=>q.call==='JA1AAA').lotwRcvd,'Y');
  const other=parseLog(adif.replace(/PT2VHF/g,'PY2ZZZ'),'c.adi').qsos;
  assert.equal(importQsos(db,other,'main').added,4);
  assert.deepEqual(stations(db).map(s=>s.station).sort(),['PT2VHF','PY2ZZZ']);
  assert.equal(deleteByStations(db,['PY2ZZZ']),4);
  assert.deepEqual(stations(db).map(s=>s.station),['PT2VHF']);
});

test('filters, copy/filter and reprocess',()=>{
  const db=emptyDb();importQsos(db,parseLog(adif,'a.adi').qsos,'main');
  assert.equal(applyFilter(db.qsos,{call:'K1*'}).length,2);
  assert.equal(applyFilter(db.qsos,{call:'?A1AAA'}).length,1);
  const {count,container}=copyFilter(db,['main'],'Somente 20m',{bands:['20m']},{removeDupes:true});
  assert.equal(count,2);assert.equal(container.id,'somente-20m');
  const res=reprocess(db,{containers:['main']},{countryFile:'all',modeMap:[{from:'FT4',to:'FT8'}]},cty);
  assert.equal(res.matched,4);assert.ok(db.qsos.find(q=>q.call==='DL1XYZ'&&q.c==='main').mode==='FT8');
  assert.equal(db.qsos.find(q=>q.call==='JA1AAA').country,'Japan');
});

test('statistics',()=>{
  const qsos=S.byTime(parseLog(adif,'a.adi').qsos.map((q,i)=>({...enrich(q,cty),id:i+1})));
  const b=S.basic(qsos,{pauseMin:15});
  assert.equal(b.qsos,4);assert.equal(b.dupes,1);assert.equal(b.uniqueCalls,3);assert.equal(b.dxcc,3);
  assert.equal(b.operatingMs,(10+1+1)*60000);
  assert.equal(S.maxRate(qsos,10).count,2);
  assert.equal(S.pauses(qsos,15).length,1);
  assert.equal(S.stationsWorked(qsos)[0].call,'K1ABC');
  assert.equal(S.bandChanges(qsos).changes,1);
  assert.equal(S.firstWorked(qsos).length,3);
  const ts=S.timeSeries(qsos,'hour');assert.deepEqual(ts.qsos,[3,1]);assert.deepEqual(ts.cum.newDxcc,[2,3]);
  const az=S.azimuthDistance(qsos,{lat:-15.8,lon:-47.9});assert.equal(az.measured,4);
  const q=S.qslStatus(qsos);assert.equal(q.any,1);assert.equal(q.dxccConfirmed,1);
  const am=S.activityMatrix(qsos,'band','hour');assert.equal(am.rows[0].key,'20m');
  assert.equal(S.bandsModes(qsos).rows.length,2);
  assert.ok(S.rateSeries(qsos,10).length>10);
  const pts=S.pointsFn('dx',cty,'PT2VHF');assert.equal(pts(qsos[0]),3);
});

test('exports round-trip',()=>{
  const qsos=parseLog(adif,'a.adi').qsos.map(q=>enrich(q,cty));
  const out=toAdif(qsos,'0.1.0');const back=parseLog(out,'x.adi');
  assert.equal(back.qsos.length,4);assert.equal(back.qsos[1].mode,'FT4');assert.equal(back.qsos[3].name,'Joãoz');assert.equal(back.qsos[0].qslRcvd,'Y');
  assert.match(toCsv(qsos),/K1ABC/);assert.match(toKml(qsos,{home:{lat:0,lon:0},timeline:true}),/<kml/);
  assert.equal(parseLog(toCabrillo(qsos,{call:'PT2VHF'}),'x.log').qsos.length,4);
});

test('platform responses',()=>{
  assert.match(buildRequest('qrz',{apiKey:'X'}).body,/ACTION=FETCH/);
  const r=parseResponse('qrz','RESULT=OK&COUNT=1&ADIF=&lt;call:5&gt;K1ABC &lt;app_qrzlog_logid:3&gt;123 &lt;eor&gt;');
  assert.equal(r.done,true);assert.match(r.adif,/<call:5>K1ABC/);assert.equal(r.state.afterLogId,124);
  assert.ok(parseResponse('qrz','RESULT=FAIL&REASON=invalid api key').error);
  const e=parseResponse('eqsl','<A HREF="../downloadedfiles/abc.adi">.ADI file</A>');assert.equal(e.state.next,'https://www.eqsl.cc/downloadedfiles/abc.adi');
  assert.equal(parseResponse('lotw','<html>Username/password incorrect</html>').error,'AUTH');
});

test('LoTW: full history by default and lotwreport.adi recognized as LoTW confirmations',()=>{
  assert.match(buildRequest('lotw',{username:'u',password:'p'}).url,/qso_qsorxsince=1980-01-01/);
  assert.match(buildRequest('lotw',{username:'u',password:'p',since:'2024-01-01'}).url,/qso_qsorxsince=2024-01-01/);
  const report='ARRL Logbook of the World Status Report\nGenerated at 2026-10-29 for pt2vhf\n<PROGRAMID:4>LoTW\n<APP_LoTW_NUMREC:1>1\n<eoh>\n<CALL:5>K1ABC <BAND:3>20M <MODE:3>FT8 <QSO_DATE:8>20240310 <TIME_ON:6>120000 <QSL_RCVD:1>Y <STATION_CALLSIGN:6>PT2VHF <eor>\n';
  const r=parseLog(report,'lotwreport.adi');
  assert.equal(r.origin,'lotw');assert.equal(r.qsos[0].lotwRcvd,'Y');assert.equal(r.qsos[0].qslRcvd,'');
  assert.equal(parseLog(adif,'a.adi').qsos[0].qslRcvd,'Y');
});

test('platform uploads: QRZ insert, eQSL batch, Club Log file and sent markers',async()=>{
  const P=await import('../src/platforms.mjs');
  assert.match(P.buildRequest('eqsl',{username:'u',password:'p'}).url,/RcvdSince=198001010000/);
  const qrz=P.buildQrzInsert({apiKey:'K'},'<CALL:5>K1ABC <EOR>');assert.match(qrz.body,/ACTION=INSERT/);assert.match(qrz.body,/ADIF=%3CCALL%3A5%3EK1ABC/);
  assert.deepEqual(P.parseQrzInsert('RESULT=OK&LOGID=1'),{ok:true});
  assert.equal(P.parseQrzInsert('RESULT=FAIL&REASON=Unable+to+add+QSO+to+database%3A+duplicate').duplicate,true);
  assert.equal(P.parseQrzInsert('RESULT=AUTH&REASON=invalid+api+key').fatal,true);
  const e=P.buildEqslUpload({username:'U',password:'P'},['<CALL:5>K1ABC <EOR>']);assert.match(decodeURIComponent(e.body),/<EQSL_USER:1>U/);
  assert.deepEqual(P.parseEqslUpload('<html>Result: 3 out of 5 records added</html>',5),{ok:true,added:3,total:5,duplicates:2});
  assert.equal(P.parseEqslUpload('Error: No match on eQSL_User/eQSL_Pswd',1).fatal,true);
  const c=P.buildClublogUpload({email:'a',password:'b',callsign:'C',apiKey:'k'},'adif');assert.equal(c.form.file.content,'adif');
  assert.equal(P.parseClublogUpload(200,'OK').ok,true);assert.equal(P.parseClublogUpload(403,'Login rejected').fatal,true);
  const q={call:'K1ABC',extra:{}};for(const k of ['qrz','lotw','eqsl','clublog']){assert.equal(P.SENT[k](q),false);P.markSent(k,q);assert.equal(P.SENT[k](q),true);}
  assert.equal(P.parseResponse('lotw','<html><h1>Page Request Limit!</h1></html>').error,'RATE_LIMIT');
  assert.match(P.parseResponse('lotw','<html><body>Server error 500</body></html>').detail,/Server error 500/);
});

test('download de plataforma marca contatos existentes como já enviados', async () => {
  const DB = await import('../src/db.mjs');
  const db = DB.emptyDb ? DB.emptyDb() : DB.createDb();
  const base = { station: 'PT2VHF', call: 'PY4BH', band: '40m', mode: 'SSB', ts: Date.UTC(2024, 8, 1, 0, 57) };
  DB.importQsos(db, [{ ...base }]);
  const res = DB.importQsos(db, [{ ...base, lotwSent: 'Y', extra: { QRZCOM_QSO_UPLOAD_STATUS: 'Y' } }]);
  assert.equal(res.skipped, 1);
  assert.equal(db.qsos[0].lotwSent, 'Y');
  assert.equal(db.qsos[0].extra.QRZCOM_QSO_UPLOAD_STATUS, 'Y');
});
