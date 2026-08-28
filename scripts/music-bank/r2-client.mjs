// Minimal S3-compatible (Cloudflare R2) client — SigV4 auth-header signing for HEAD/PUT/GET/DELETE.
// Server-side only. Reads creds from an env file (default .env.r2.local). Never logs creds/URLs.
import fs from 'node:fs'; import crypto from 'node:crypto';
export function loadR2(envPath='.env.r2.local'){const e={};for(const l of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;e[t.slice(0,i).trim()]=t.slice(i+1).trim();}
  return {ak:e.R2_ACCESS_KEY_ID,sk:e.R2_SECRET_ACCESS_KEY,bucket:e.R2_BUCKET,endpoint:e.R2_S3_ENDPOINT.replace(/\/$/,'')};}
const enc=(s,slash)=>{let o='';for(const b of Buffer.from(s,'utf8')){const c=String.fromCharCode(b);if((b>=48&&b<=57)||(b>=65&&b<=90)||(b>=97&&b<=122)||'-_.~'.includes(c))o+=c;else if(c==='/'&&!slash)o+='/';else o+='%'+b.toString(16).toUpperCase().padStart(2,'0');}return o;};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'); const hmac=(k,x)=>crypto.createHmac('sha256',k).update(x).digest();
function signed(cfg,method,key,body){const host=new URL(cfg.endpoint).host;const now=new Date();const amz=now.toISOString().replace(/[:-]|\.\d{3}/g,'');const date=amz.slice(0,8);
  const uri='/'+cfg.bucket+'/'+enc(key,false);const payloadHash=body?sha(body):'UNSIGNED-PAYLOAD';
  const h={host,'x-amz-content-sha256':payloadHash,'x-amz-date':amz};const sk=Object.keys(h).sort();
  const ch=sk.map(k=>k+':'+h[k]+'\n').join('');const sh=sk.join(';');
  const canon=[method,uri,'',ch,sh,payloadHash].join('\n');
  const scope=`${date}/auto/s3/aws4_request`;const sts=['AWS4-HMAC-SHA256',amz,scope,sha(canon)].join('\n');
  let s=hmac('AWS4'+cfg.sk,date);s=hmac(s,'auto');s=hmac(s,'s3');s=hmac(s,'aws4_request');const sig=crypto.createHmac('sha256',s).update(sts).digest('hex');
  h['Authorization']=`AWS4-HMAC-SHA256 Credential=${cfg.ak}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;
  return {url:cfg.endpoint+uri,headers:h};}
export async function head(cfg,key){const {url,headers}=signed(cfg,'HEAD',key);const r=await fetch(url,{method:'HEAD',headers});return {status:r.status,size:r.headers.get('content-length')?+r.headers.get('content-length'):null,type:r.headers.get('content-type')};}
export async function put(cfg,key,body,contentType){const {url,headers}=signed(cfg,'PUT',key,body);headers['content-type']=contentType||'application/octet-stream';const r=await fetch(url,{method:'PUT',headers,body});return {status:r.status,ok:r.ok};}
export async function getBuf(cfg,key,range){const {url,headers}=signed(cfg,'GET',key);if(range)headers['range']=range;const r=await fetch(url,{headers});const b=Buffer.from(await r.arrayBuffer());return {status:r.status,buf:b};}
export async function del(cfg,key){const {url,headers}=signed(cfg,'DELETE',key);const r=await fetch(url,{method:'DELETE',headers});return {status:r.status,ok:r.ok};}
