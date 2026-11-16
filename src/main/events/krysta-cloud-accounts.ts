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
