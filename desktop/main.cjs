const {app,BrowserWindow,ipcMain,dialog,shell,safeStorage,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {realpathSync}=require('node:fs');
const {pathToFileURL,fileURLToPath}=require('node:url');

const SITE='https://www.pt2vhf.com',PAGE=SITE+'/qsl';
const updatePlatform=()=>(process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux')+'-'+(process.arch==='arm64'?'arm64':'x64');
const PLATFORM_HOSTS=new Set(['logbook.qrz.com','lotw.arrl.org','www.eqsl.cc','eqsl.cc','clublog.org','www.clublog.org']);
const portable=Boolean(process.env.PORTABLE_EXECUTABLE_DIR),smoke=process.argv.includes('--smoke-test');
let win,dataDir,dbFile,ctyFile,writeQueue=Promise.resolve(),pendingAsset=null,pendingUpdate=null,downloadedFile=null;
const updater=require('./updater.cjs');
const compareVersions=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if((x[i]||0)!==(y[i]||0))return (x[i]||0)-(y[i]||0);return 0;};
const mainURL=pathToFileURL(path.join(__dirname,'../ui/index.html')).href;
const canonicalUI=realpathSync(fileURLToPath(mainURL));
function isMainURL(value){try{const url=new URL(value);if(url.protocol!=='file:')return false;const actual=realpathSync(fileURLToPath(url));return process.platform==='win32'?actual.toLowerCase()===canonicalUI.toLowerCase():actual===canonicalUI;}catch{return false;}}

if(smoke){app.disableHardwareAcceleration();app.commandLine.appendSwitch('disable-gpu');}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(start).catch(error=>{console.error(error);if(smoke)return app.exit(1);dialog.showErrorBox('PT2VHF QSL Analyzer','Não foi possível iniciar a aplicação.\n'+error.message);app.quit();});
}
app.on('window-all-closed',()=>app.quit());

// Escrita atômica com cópia de segurança da versão anterior do banco.
function writeAtomic(file,content){
  const job=writeQueue.catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file+'.tmp',content,'utf8');
    try{await fs.copyFile(file,file+'.bak');}catch{}
    await fs.rename(file+'.tmp',file);
  });
  writeQueue=job;return job;
}

async function readText(file){try{return await fs.readFile(file,'utf8');}catch{return null;}}

const KINDS={adi:['ADIF','adi'],csv:['CSV','csv'],txt:['Texto','txt'],png:['PNG','png'],pdf:['PDF','pdf'],html:['HTML','html'],json:['JSON','json'],kml:['KML','kml'],cabrillo:['Cabrillo','log'],adif:['ADIF','adi']};

async function start(){
  dataDir=portable?path.join(process.env.PORTABLE_EXECUTABLE_DIR,'data'):smoke?path.join(app.getPath('temp'),'qsl-analyzer-smoke-'+process.pid):app.getPath('userData');
  dbFile=path.join(dataDir,'qsl-analyzer.db.json');ctyFile=path.join(dataDir,'cty.dat');
  await fs.mkdir(dataDir,{recursive:true});
  // Confirma ao script de atualização que a versão nova abriu corretamente.
  if(process.env.QSL_UPDATE_CONFIRM_FILE&&path.resolve(process.env.QSL_UPDATE_CONFIRM_FILE)===path.join(dataDir,'updates','update-ready.json'))await fs.writeFile(process.env.QSL_UPDATE_CONFIRM_FILE,JSON.stringify({version:app.getVersion()}),'utf8').catch(()=>{});
  // Limpa pacotes baixados de atualizações anteriores.
  for(const f of await fs.readdir(path.join(dataDir,'updates')).catch(()=>[]))if(/\.exe(\.partial)?$/.test(f)&&!f.includes(app.getVersion()))await fs.rm(path.join(dataDir,'updates',f),{force:true}).catch(()=>{});
  win=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:700,show:!smoke,backgroundColor:'#09111d',title:'PT2VHF QSL Analyzer v'+app.getVersion(),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(!isMainURL(url))e.preventDefault();});
  session.defaultSession.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
  const handle=(name,fn)=>ipcMain.handle(name,(event,...args)=>{if(event.sender!==win.webContents||!isMainURL(event.senderFrame.url))throw new Error('Invalid origin');return fn(...args);});
  handle('info',()=>({version:app.getVersion(),dataDir,portable,desktop:true,smoke}));
  handle('load-db',()=>readText(dbFile));
  handle('save-db',async json=>{if(typeof json!=='string')throw new Error('Invalid payload');await writeAtomic(dbFile,json);return true;});
  handle('open-files',async()=>{
    const r=await dialog.showOpenDialog(win,{title:'PT2VHF QSL Analyzer',properties:['openFile','multiSelections'],filters:[{name:'Logs',extensions:['adi','adif','adx','log','cbr','edi','csv','tsv','txt','dat','json']},{name:'*',extensions:['*']}]});
    if(r.canceled)return [];
    return Promise.all(r.filePaths.map(async p=>{const buf=await fs.readFile(p);let text=buf.toString('utf8');if(text.includes('�'))text=buf.toString('latin1');return {name:path.basename(p),size:buf.length,text};}));
  });
  handle('save-file',async({name,content,kind,base64})=>{
    const [label,ext]=KINDS[kind]||['Arquivo',path.extname(name).slice(1)||'txt'];
    const r=await dialog.showSaveDialog(win,{title:'PT2VHF QSL Analyzer',defaultPath:path.join(app.getPath('documents'),path.basename(name)),filters:[{name:label,extensions:[ext]}]});
    if(r.canceled||!r.filePath)return null;
    await fs.writeFile(r.filePath,base64?Buffer.from(content,'base64'):content,base64?undefined:'utf8');
    return r.filePath;
  });
  handle('print-pdf',async({landscape=false,pageSize='A4',name='relatorio.pdf'}={})=>{
    // O fundo da janela aparece nas margens do PDF; usa branco durante a geração.
    win.setBackgroundColor('#ffffff');
    const pdf=await win.webContents.printToPDF({landscape,pageSize,printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#777">PT2VHF QSL Analyzer · <span class="pageNumber"></span>/<span class="totalPages"></span></div>'});
    win.setBackgroundColor('#09111d');
    const r=await dialog.showSaveDialog(win,{title:'PDF',defaultPath:path.join(app.getPath('documents'),path.basename(name)),filters:[{name:'PDF',extensions:['pdf']}]});
    if(r.canceled||!r.filePath)return null;
    await fs.writeFile(r.filePath,pdf);
    return r.filePath;
  });
  handle('fetch-platform',async({url,method='GET',headers={},body})=>{
    const u=new URL(url);
    if(u.protocol!=='https:'||!PLATFORM_HOSTS.has(u.hostname))throw new Error('Host não permitido: '+u.hostname);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    try{
      const res=await fetch(u,{method,headers:{'User-Agent':'PT2VHF-QSL-Analyzer/'+app.getVersion(),...headers},body,signal:controller.signal});
      return {status:res.status,text:await res.text()};
    }catch(e){return {error:e.name==='AbortError'?'Tempo esgotado':e.message};}
    finally{clearTimeout(timer);}
  });
  // Ficha da estação: dados e foto do QRZ.com / HamQTH (somente esses domínios, HTTPS).
  handle('lookup',async({url,binary=false})=>{
    const u=new URL(url);
    if(u.protocol!=='https:'||!/(^|\.)(qrz\.com|hamqth\.com)$/i.test(u.hostname))throw new Error('Host não permitido: '+u.hostname);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const res=await fetch(u,{headers:{'User-Agent':'PT2VHF-QSL-Analyzer/'+app.getVersion()},signal:controller.signal});
      if(!binary)return {status:res.status,text:await res.text()};
      const buf=Buffer.from(await res.arrayBuffer());
      if(buf.length>2*1024*1024)throw new Error('Imagem grande demais');
      return {status:res.status,base64:buf.toString('base64'),type:res.headers.get('content-type')||'image/jpeg'};
    }finally{clearTimeout(timer);}
  });
  handle('encrypt',text=>safeStorage.isEncryptionAvailable()?'enc:'+safeStorage.encryptString(String(text)).toString('base64'):'b64:'+Buffer.from(String(text)).toString('base64'));
  handle('decrypt',text=>{const s=String(text||'');if(s.startsWith('enc:'))return safeStorage.decryptString(Buffer.from(s.slice(4),'base64'));if(s.startsWith('b64:'))return Buffer.from(s.slice(4),'base64').toString('utf8');return '{}';});
  handle('load-cty',()=>readText(ctyFile));
  handle('save-cty',async text=>{if(!text){await fs.rm(ctyFile,{force:true});return true;}await writeAtomic(ctyFile,String(text));return true;});
  handle('open-external',url=>{const u=new URL(url);if(u.protocol!=='https:')throw new Error('URL inválida');return shell.openExternal(u.href);});
  handle('factory-reset',async()=>{await writeQueue.catch(()=>{});for(const f of [dbFile,dbFile+'.bak',ctyFile])await fs.rm(f,{force:true});app.relaunch();app.exit(0);});
  // Atualizações oficiais somente por www.pt2vhf.com (update.php lê o updates.json do site).
  // Atualizações oficiais somente por www.pt2vhf.com (update.php lê o updates.json do site).
  // No Windows a atualização é automática (OTA): baixa, confere SHA-256, instala e reabre.
  handle('check-update',async()=>{
    const kind=portable?'portable':'installer';
    const res=await fetch(`${SITE}/update.php?product=qsl&platform=${updatePlatform()}${process.platform==='win32'?'&kind='+kind:''}`,{headers:{'User-Agent':'PT2VHF-QSL-Analyzer/'+app.getVersion(),'Accept':'application/json'}});
    if(!res.ok)return {available:false};
    const data=await res.json(),latest=String(data.version||'');
    const available=data.status==='available'&&Boolean(latest)&&compareVersions(latest,app.getVersion())>0;
    pendingAsset=available?(data.files||[]).find(f=>updater.validAsset(f))||null:null;
    pendingUpdate=available?{version:latest,notes:String(data.notes||'').slice(0,15000)}:null;
    return {available,latest,url:PAGE,notes:String(data.notes||''),canInstall:Boolean(pendingAsset)&&process.platform==='win32'&&!smoke};
  });
  handle('download-update',async()=>{
    if(!pendingAsset)throw new Error('Nenhuma atualização disponível');
    let lastAt=Date.now(),lastBytes=0;
    downloadedFile=await updater.downloadAsset(pendingAsset,path.join(dataDir,'updates'),progress=>{
      const now=Date.now(),elapsed=now-lastAt;
      if(elapsed<200&&progress.transferred<progress.total)return;
      const speed=(progress.transferred-lastBytes)*1000/Math.max(1,elapsed);lastAt=now;lastBytes=progress.transferred;
      if(!win.isDestroyed())win.webContents.send('update-progress',{...progress,bytesPerSecond:speed});
    },{userAgent:'PT2VHF-QSL-Analyzer/'+app.getVersion()});
    return true;
  });
  handle('install-update',async()=>{
    if(!downloadedFile||!pendingAsset)throw new Error('Atualização ainda não baixada');
    const sha256=await updater.sha256File(downloadedFile);
    if(sha256!==pendingAsset.sha256)throw new Error('SHA-256 divergente');
    await fs.writeFile(path.join(dataDir,'pending-news.json'),JSON.stringify(pendingUpdate),'utf8');
    const options={Mode:portable?'portable':'installed',Candidate:downloadedFile,Sha256:sha256,ExpectedVersion:pendingUpdate.version,StateFile:dbFile};
    if(portable){
      if(!process.env.PORTABLE_EXECUTABLE_FILE||!process.env.PORTABLE_EXECUTABLE_DIR)throw new Error('Dados do executável portátil ausentes');
      options.Original=process.env.PORTABLE_EXECUTABLE_FILE;options.Target=path.join(process.env.PORTABLE_EXECUTABLE_DIR,pendingAsset.name);
      options.LauncherPid=Number(process.env.PORTABLE_LAUNCHER_PID)||0;
    }else options.InstallDir=path.dirname(app.getPath('exe'));
    await writeQueue.catch(()=>{});
    await updater.launchHandoff(options,path.join(dataDir,'updates'));
    setTimeout(()=>app.quit(),300);
    return true;
  });
  // Novidades mostradas uma única vez na primeira abertura depois de atualizar.
  handle('take-news',async()=>{
    const f=path.join(dataDir,'pending-news.json'),text=await readText(f);
    if(!text)return null;
    await fs.rm(f,{force:true});
    try{const news=JSON.parse(text);return news.version===app.getVersion()?news:null;}catch{return null;}
  });

  if(smoke){
    win.webContents.on('console-message',(_e,level,message)=>{if(level>=3){console.error(message);app.exit(1);}});
    win.webContents.once('did-finish-load',()=>setTimeout(async()=>{
      const ok=await win.webContents.executeJavaScript("document.querySelector('#mainNav button')!==null&&!document.body.classList.contains('loading')");
      await fs.rm(dataDir,{recursive:true,force:true}).catch(()=>{});
      app.exit(ok?0:1);
    },4000));
  }
  await win.loadURL(mainURL);
}
