import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const updater=require('../desktop/updater.cjs');

const body=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(2_000_000,7)]);
const asset={name:'PT2VHF-QSL-Analyzer-9.9.9-win-x64-setup.exe',url:'https://www.pt2vhf.com/downloads/qsl-analyzer/PT2VHF-QSL-Analyzer-9.9.9-win-x64-setup.exe',size:body.length,sha256:createHash('sha256').update(body).digest('hex')};
const fakeFetch=data=>async(url,opts)=>{assert.equal(opts.redirect,'manual');assert.match(opts.headers['User-Agent'],/^PT2VHF-QSL-Manager/);return new Response(data,{status:200});};

test('OTA only accepts packages from www.pt2vhf.com with a valid name',()=>{
  assert.equal(updater.validAsset(asset),true);
  assert.equal(updater.validAsset({...asset,url:'https://github.com/x/'+asset.name}),false);
  assert.equal(updater.validAsset({...asset,name:'evil.exe',url:'https://www.pt2vhf.com/downloads/qsl-analyzer/evil.exe'}),false);
  assert.equal(updater.validAsset({...asset,sha256:'x'}),false);
});

test('OTA download verifies size and SHA-256',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qsl-ota-'));
  try{
    const progress=[];
    const file=await updater.downloadAsset(asset,dir,p=>progress.push(p.percent),{fetchImpl:fakeFetch(body),userAgent:'PT2VHF-QSL-Manager/0.4.0'});
    assert.ok(existsSync(file));assert.equal(readFileSync(file).length,body.length);assert.equal(progress.at(-1),100);
    assert.equal(await updater.sha256File(file),asset.sha256);
    const tampered=Buffer.from(body);tampered[100]=1;
    await assert.rejects(updater.downloadAsset({...asset,name:asset.name.replace('setup','portable'),url:asset.url.replace('setup','portable')},dir,null,{fetchImpl:fakeFetch(tampered)}),/SHA-256/);
    assert.equal(existsSync(join(dir,asset.name.replace('setup','portable')+'.partial')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('OTA accepts the new QSL Manager package names',()=>{
  const name='PT2VHF-QSL-Manager-1.0.0-win-x64-portable.exe';
  assert.equal(updater.validAsset({...asset,name,url:'https://www.pt2vhf.com/downloads/qsl-analyzer/'+name}),true);
});
