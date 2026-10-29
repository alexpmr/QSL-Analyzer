// Atualização OTA: baixa o pacote publicado em www.pt2vhf.com, confere tamanho e SHA-256 e entrega a
// instalação a um script PowerShell que espera o app fechar, aplica a versão nova e a reabre.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const NAME=/^PT2VHF-QSL-Analyzer-\d+\.\d+\.\d+-win-x64-(?:setup|portable)\.exe$/;
const trustedURL=(url,name)=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.pt2vhf.com'&&!u.search&&!u.hash&&u.pathname==='/downloads/qsl-analyzer/'+name;}catch{return false;}};

function validAsset(asset){
  return Boolean(asset)&&NAME.test(asset.name||'')&&/^[a-f0-9]{64}$/.test(asset.sha256||'')&&Number.isInteger(asset.size)&&asset.size>1e6&&asset.size<700e6&&trustedURL(asset.url,asset.name);
}

async function downloadAsset(asset,folder,onProgress,{fetchImpl=fetch,userAgent='PT2VHF-QSL-Analyzer'}={}){
  if(!validAsset(asset))throw new Error('Pacote de atualização inválido');
  await fs.mkdir(folder,{recursive:true});
  const candidate=path.join(folder,asset.name),partial=candidate+'.partial';
  let file;
  try{
    const response=await fetchImpl(asset.url,{redirect:'manual',signal:AbortSignal.timeout(600000),headers:{'User-Agent':userAgent}});
    if(response.status!==200||!response.body)throw new Error('Download da atualização falhou ('+response.status+')');
    const hash=crypto.createHash('sha256'),reader=response.body.getReader();
    file=await fs.open(partial,'w',0o600);
    let received=0,header=Buffer.alloc(0);
    try{
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        received+=value.length;
        if(received>asset.size)throw new Error('Tamanho da atualização excedido');
        if(header.length<2)header=Buffer.concat([header,Buffer.from(value)]).subarray(0,2);
        hash.update(value);await file.write(value);
        onProgress?.({percent:received/asset.size*100,transferred:received,total:asset.size});
      }
    }finally{await reader.cancel().catch(()=>{});}
    await file.close();file=null;
    if(received!==asset.size||header[0]!==0x4d||header[1]!==0x5a||hash.digest('hex')!==asset.sha256)throw new Error('Falha na conferência da atualização (tamanho ou SHA-256)');
    await fs.rename(partial,candidate);
    return candidate;
  }catch(e){await file?.close().catch(()=>{});await fs.rm(partial,{force:true}).catch(()=>{});throw e;}
}

async function sha256File(file){
  const hash=crypto.createHash('sha256');
  for await(const chunk of require('node:fs').createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

async function launchHandoff(options,folder){
  if(process.platform!=='win32')throw new Error('Atualização automática disponível apenas no Windows');
  await fs.mkdir(folder,{recursive:true});
  const script=path.join(folder,'apply-update.ps1'),manifest=path.join(folder,'apply-update.json');
  await fs.copyFile(path.join(__dirname,'apply-update.ps1'),script);
  await fs.writeFile(manifest,JSON.stringify({...options,AppPid:process.pid,ReadyFile:path.join(folder,'update-ready.json')}),'utf8');
  await fs.rm(path.join(folder,'update-ready.json'),{force:true});
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  await new Promise((resolve,reject)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Manifest',manifest],{detached:true,stdio:'ignore',windowsHide:true});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
}

module.exports={validAsset,trustedURL,downloadAsset,sha256File,launchHandoff};
