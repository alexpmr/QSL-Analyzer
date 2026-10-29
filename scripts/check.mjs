// Validação: sintaxe, chaves de tradução, dados embutidos e configuração dos pacotes Windows.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {MESSAGES,LANGUAGES} from '../src/i18n.mjs';
import {APP_VERSION} from '../src/version.mjs';
import {STAT_PAGES,QSL_PAGES} from '../ui/pages.mjs';
import {PLATFORMS} from '../src/platforms.mjs';
import {parseCty} from '../src/cty.mjs';
for(const dir of ['desktop','src','ui','scripts','tests'])for(const file of readdirSync(dir))if(/\.(mjs|cjs)$/.test(file))execFileSync(process.execPath,['--check',join(dir,file)],{stdio:'inherit'});
const source=['ui/app.mjs','ui/pages.mjs','ui/entity.mjs','ui/backup.mjs'].map(f=>readFileSync(f,'utf8')).join('\n');
const keys=new Set([...source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map(m=>m[1]).filter(k=>!k.endsWith('_')&&!['helpT','helpB'].includes(k)));
for(const m of source.matchAll(/head\('[a-z]+', '([A-Za-z_]+)'(?:, '([A-Za-z_]+)')?\)/g)){keys.add(m[1]);if(m[2])keys.add(m[2]);}
for(const m of source.matchAll(/label: '([A-Za-z]+)'/g))keys.add(m[1]);
const pages=['dashboard','contacts','import','platforms','modify','health','search',...STAT_PAGES.map(p=>p.id),...QSL_PAGES.map(p=>p.id),'report','compare','exportlogs','backup','preferences','database','scratchpad','activitylog','bug','help','about'];
for(const p of pages)keys.add('page_'+p);
for(const p of [...STAT_PAGES,...QSL_PAGES].map(p=>p.id))keys.add('help_'+p);
for(const g of ['dashboard','logs','stats','qsl','reports','settings','help','about'])keys.add('nav_'+g);
for(const p of [...STAT_PAGES,...QSL_PAGES])for(const def of p.params)if(def.type==='select'&&def.options)for(const o of def.options)if(!/^\d+$/.test(o))keys.add('opt_'+o);
for(const d of ['band','mode','operator','station','cont','radio'])keys.add('dim_'+d);
for(const u of ['hour','day','month','year'])keys.add('unit_'+u);
for(const k of ['autoBackup_off','autoBackup_daily','autoBackup_open','cred_tqslLocation','newVersionOta','updateNow','updateBytes','updateInstalling','updateFailed','whatsNew','siteNoticeTitle','siteNoticeMessage','siteNoticeOpen','continue','newVersionTitle','newVersionMessage','later','openDownloadPage','updateCheckFailed','undoFilter','activeFilters','biHint','drilled','hourUtc','weekday','rule_adif','rule_one','rule_dx','palette_default','palette_pt2vhf','palette_mono','tables_all','tables_first','tables_none','layer_dxcc','layer_grids','layer_lines','cf_none','cf_missing','cf_all','opt_portrait','opt_landscape','opt_matrix','opt_unconfirmed'])keys.add(k);
for(const p of Object.values(PLATFORMS)){keys.add(p.help);for(const f of p.fields)keys.add('cred_'+f);}
for(const k of ['Start','Logs','Platforms','Stats','Qsl','Reports','Database','Formats']){keys.add('helpT'+k);keys.add('helpB'+k);}
for(const k of ['bandMismatch','missingBand','nearDupes','typos','invalidMode','future','missingStation','missingGrid']){keys.add('health_'+k);keys.add('healthHelp_'+k);}
for(const k of ['fixBand','deleteNearDupes','fixTypos'])keys.add('fix_'+k);
for(const k of ['call','country','grid','pfx','cqz','ituz','cont','station'])keys.add('entity_'+k);
for(const k of ['mixed','phone','cw','digi'])keys.add('dxcc_'+k);
for(const k of ['call','date','time','band','freq','mode','submode','rstS','rstR','station','operator','myGrid','grid','name','qth','comment','contest','stx','srx','qslSent','qslRcvd','lotwSent','lotwRcvd','eqslSent','eqslRcvd'])keys.add('qf_'+k);
for(const a of ['qso-new','qso-edit','backup','platform-download','platform-upload','platform-error','merge-containers','health-fix','upload','import','export','container-create','container-rename','container-delete','delete-station','delete-all','copy-filter','remove-dupes','reprocess','delete-qso','restore'])keys.add('act_'+a);
for(const e of ['noCall','badDate','format','parse','NAME_REQUIRED','NAME_EXISTS','NOT_FOUND'])keys.add('err_'+e);
const missing=[];for(const l of LANGUAGES)for(const k of keys)if(MESSAGES[l.code][k]===undefined)missing.push(l.code+':'+k);
if(missing.length)throw new Error('Traduções ausentes: '+missing.join(', '));
const cty=parseCty(readFileSync('src/data/cty.dat','utf8'));if(cty.entities.length<340)throw new Error('CTY.DAT inválido');
const dxcc=JSON.parse(readFileSync('src/data/dxcc.json','utf8'));if(dxcc.length!==cty.entities.length)throw new Error('Tabela DXCC desatualizada');
const land=JSON.parse(readFileSync('ui/land.geojson','utf8'));if(land.features.length<100)throw new Error('Mapa inválido');
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!pkg.build.win.target.includes('nsis')||!pkg.build.win.target.includes('portable')||!pkg.build.linux.target.includes('deb')||!pkg.build.mac.target.includes('dmg'))throw new Error('Targets de empacotamento ausentes');
if(APP_VERSION!==pkg.version)throw new Error('Versão divergente entre package.json e src/version.mjs');
console.log(`Sintaxe, ${keys.size} chaves × ${LANGUAGES.length} idiomas, CTY.DAT ${cty.version}, mapa e pacotes Windows/Linux/macOS: OK`);
