import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
type Credentials={google?:{clientId:string;clientSecret:string;refreshToken:string};synology?:{url:string;username:string;password:string}};
const file=()=>path.join(app.getPath("userData"),"krysta-cloud-accounts.bin");
async function read():Promise<Credentials>{try{return JSON.parse(safeStorage.decryptString(await fs.readFile(file())));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {};throw Error("Cannot decrypt cloud credentials");}}
async function write(c:Credentials){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==="basic_text")throw Error("Secure storage unavailable");await fs.writeFile(file()+".tmp",safeStorage.encryptString(JSON.stringify(c)),{mode:0o600});await fs.rename(file()+".tmp",file());}
let busy=false;
async function exclusive<T>(fn:()=>Promise<T>){if(busy)throw Error("Account operation already running");busy=true;try{return await fn();}finally{busy=false;}}
async function tokenRequest(params:Record<string,string>){const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams(params),signal:AbortSignal.timeout(30000),redirect:"error"});if(!r.ok)throw Error("Google authorization failed ("+r.status+")");return await r.json() as {access_token?:string;refresh_token?:string};}
ipcMain.handle("krysta:cloud-account-status",async()=>{const c=await read();return {google:!!c.google,synology:!!c.synology};});
ipcMain.handle("krysta:cloud-google-connect",()=>exclusive(async()=>{
 if(!safeStorage.isEncryptionAvailable())throw Error("Secure storage unavailable");
 const selection=await dialog.showOpenDialog({title:"Select Google Desktop OAuth client JSON",properties:["openFile"],filters:[{name:"Google OAuth JSON",extensions:["json"]}]});
 if(selection.canceled||!selection.filePaths[0])return false;
 const f=selection.filePaths[0];if((await fs.stat(f)).size>65536)throw Error("Invalid client config");
 const installed=JSON.parse(await fs.readFile(f,"utf8")).installed;
 if(typeof installed?.client_id!=="string"||!installed.client_id.endsWith(".apps.googleusercontent.com")||typeof installed.client_secret!=="string")throw Error("Desktop OAuth client required");
 const verifier=randomBytes(48).toString("base64url"),state=randomBytes(32).toString("base64url");
 let callback:(code:string)=>void=()=>{},rejectCallback:(e:Error)=>void=()=>{};
 const codePromise=new Promise<string>((resolve,reject)=>{callback=resolve;rejectCallback=reject;});void codePromise.catch(()=>{});
 const server=createServer((req,res)=>{const u=new URL(req.url??"/","http://127.0.0.1");if(u.pathname!=="/callback"||u.searchParams.get("state")!==state){res.writeHead(400);res.end("Invalid request");return;}const code=u.searchParams.get("code");res.setHeader("Content-Type","text/plain; charset=utf-8");if(!code){res.end("Authorization cancelled.");rejectCallback(Error("Google authorization cancelled"));return;}res.end("Authorization received. Return to Krysta Launcher.");callback(code);});
 const timer=setTimeout(()=>rejectCallback(Error("Google login timed out")),180000);
 try{
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const addr=server.address();if(!addr||typeof addr==="string")throw Error("Callback unavailable");
 const redirect="http://127.0.0.1:"+addr.port+"/callback";
 const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");u.search=new URLSearchParams({client_id:installed.client_id,redirect_uri:redirect,response_type:"code",scope:"https://www.googleapis.com/auth/drive.file",code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state,access_type:"offline",prompt:"consent"}).toString();
 await shell.openExternal(u.toString());const code=await codePromise;
 const t=await tokenRequest({client_id:installed.client_id,client_secret:installed.client_secret,code,code_verifier:verifier,grant_type:"authorization_code",redirect_uri:redirect});
 if(!t.refresh_token||!t.access_token)throw Error("Google did not provide offline authorization");
 const probe=await fetch("https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)",{headers:{Authorization:"Bearer "+t.access_token},signal:AbortSignal.timeout(15000),redirect:"error"});if(!probe.ok)throw Error("Google Drive access unavailable");
 await write({...await read(),google:{clientId:installed.client_id,clientSecret:installed.client_secret,refreshToken:t.refresh_token}});return true;
 }finally{clearTimeout(timer);server.closeAllConnections();server.close();}
}));
ipcMain.handle("krysta:cloud-synology-connect",(_e,url:unknown,username:unknown,password:unknown)=>exclusive(async()=>{
 if(typeof url!=="string"||typeof username!=="string"||typeof password!=="string"||!username||!password||url.length>2048)throw Error("Invalid NAS credentials");
 const u=new URL(url);if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash)throw Error("Use HTTPS WebDAV folder URL");
 const authorization="Basic "+Buffer.from(username+":"+password).toString("base64");
 const r=await fetch(u,{method:"PROPFIND",headers:{Authorization:authorization,Depth:"0"},redirect:"error",signal:AbortSignal.timeout(15000)});await r.body?.cancel();if(r.status!==207)throw Error("WebDAV connection failed ("+r.status+")");
 await write({...await read(),synology:{url:u.toString(),username,password}});return true;
}));
ipcMain.handle("krysta:cloud-account-disconnect",(_e,provider:unknown)=>exclusive(async()=>{const c=await read();if(provider==="google")delete c.google;else if(provider==="synology")delete c.synology;else throw Error("Invalid provider");await write(c);return true;}));

type DirectProvider="google"|"synology";
export async function directCloudIdentity(provider:DirectProvider){
 const c=await read();
 const account=c[provider];
 if(!account)throw Error("Connect the selected cloud account first");
 return createHash("sha256").update(JSON.stringify(account)).digest("hex");
}
export async function uploadCloudSnapshot(provider:DirectProvider,identity:string,gameKey:string,snapshotId:string,dir:string,names:string[]){
 const c=await read(),account=c[provider];
 if(!account||createHash("sha256").update(JSON.stringify(account)).digest("hex")!==identity)throw Error("Cloud account changed");
 if(!/^[a-f0-9]{64}$/.test(gameKey)||!/^[a-f0-9-]{36}$/.test(snapshotId)||names.some(n=>!/^\d+$/.test(n)))throw Error("Invalid snapshot identity");
 const files=[...names,"manifest.json"];
 // Bound memory per upload; the manifest is committed last, never overwriting an older snapshot.
 async function payload(name:string){
  const p=path.join(dir,name),st=await fs.lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size>64*1024**2)throw Error("Individual cloud save file exceeds 64 MB or is unsafe");
  return fs.readFile(p);
 }
 if(provider==="google"&&c.google){
  const g=c.google,t=await tokenRequest({client_id:g.clientId,client_secret:g.clientSecret,refresh_token:g.refreshToken,grant_type:"refresh_token"});
  if(!t.access_token)throw Error("Google access token unavailable");
  const auth={Authorization:"Bearer "+t.access_token};
  async function createFolder(name:string,parent?:string){
   const response=await fetch("https://www.googleapis.com/drive/v3/files?fields=id",{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",...(parent?{parents:[parent]}:{})}),redirect:"error",signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error("Google Drive folder creation failed ("+response.status+")");
   const data=await response.json() as {id?:string};if(!data.id)throw Error("Missing Google folder ID");return data.id;
  }
  const q="trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = 'Krysta Cloud'";
  const list=await fetch("https://www.googleapis.com/drive/v3/files?"+new URLSearchParams({q,fields:"files(id),nextPageToken",pageSize:"100"}),{headers:auth,redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!list.ok)throw Error("Google Drive folder lookup failed ("+list.status+")");
  const data=await list.json() as {files?:{id:string}[];nextPageToken?:string};
  if(data.nextPageToken||(data.files?.length??0)>1)throw Error("Multiple Krysta Cloud folders; resolve ambiguity in Drive");
  const root=data.files?.[0]?.id??await createFolder("Krysta Cloud");
  const folder=await createFolder(gameKey+"-"+snapshotId,root);
  for(const name of files){
   const bytes=await payload(name),boundary="krysta_"+randomBytes(18).toString("hex");
   const body=Buffer.concat([Buffer.from("--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify({name,parents:[folder]})+"\r\n--"+boundary+"\r\nContent-Type: application/octet-stream\r\n\r\n"),bytes,Buffer.from("\r\n--"+boundary+"--\r\n")]);
   const response=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{method:"POST",headers:{...auth,"Content-Type":"multipart/related; boundary="+boundary},body:new Uint8Array(body),redirect:"error",signal:AbortSignal.timeout(120000)});
   await response.body?.cancel();if(!response.ok)throw Error("Google Drive upload failed ("+response.status+")");
  }
 }else if(provider==="synology"&&c.synology){
  const nas=c.synology,root=new URL(nas.url);if(root.protocol!=="https:"||root.username||root.password||root.search||root.hash)throw Error("Unsafe NAS URL");
  if(!root.pathname.endsWith("/"))root.pathname+="/";
  const auth={Authorization:"Basic "+Buffer.from(nas.username+":"+nas.password).toString("base64")};
  const cloud=new URL("Krysta%20Cloud/",root),snapshot=new URL(gameKey+"-"+snapshotId+"/",cloud);
  for(const u of [cloud,snapshot]){
   const response=await fetch(u,{method:"MKCOL",headers:auth,redirect:"error",signal:AbortSignal.timeout(30000)});
   await response.body?.cancel();if(response.status!==201&&response.status!==405)throw Error("WebDAV folder creation failed ("+response.status+")");
  }
  for(const name of files){
   const response=await fetch(new URL(name,snapshot),{method:"PUT",headers:{...auth,"Content-Type":"application/octet-stream","If-None-Match":"*"},body:new Uint8Array(await payload(name)),redirect:"error",signal:AbortSignal.timeout(120000)});
   await response.body?.cancel();if(!response.ok)throw Error("WebDAV upload failed ("+response.status+")");
  }
 }else throw Error("Cloud account unavailable");
}
