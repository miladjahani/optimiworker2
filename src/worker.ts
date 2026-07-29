export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  SESSION_TTL_DAYS?: string
}

const CORS = { 'Access-Control-Allow-Origin':'same-origin', 'Access-Control-Allow-Credentials':'true', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS' }
const SOURCE_URL = 'https://raw.githubusercontent.com/miladjahani/wizard/main/wizard/worker-source.js'
const COMPAT = '2025-01-01'

const json = (data:any, status=200, headers:Record<string,string>={}) =>
  new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8', ...CORS, ...headers}})

function cookie(name:string,value:string,maxAge:number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
function clearCookie(name:string) { return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }
function id(){ return crypto.randomUUID() }
function now(){ return new Date().toISOString() }

async function hashPassword(password:string,salt?:Uint8Array) {
  const s=salt??crypto.getRandomValues(new Uint8Array(16))
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits'])
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:s,iterations:120000,hash:'SHA-256'},key,256)
  return {hash:b64(new Uint8Array(bits)),salt:b64(s)}
}
function b64(a:Uint8Array){let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s)}
function unb64(s:string){const b=atob(s);return Uint8Array.from(b,c=>c.charCodeAt(0))}
async function verifyPassword(password:string,hash:string,salt:string){
  const r=await hashPassword(password,unb64(salt)); return r.hash===hash
}
function parseCookie(req:Request,name:string){const raw=req.headers.get('Cookie')||''; const m=raw.match(new RegExp('(?:^|;\\s*)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}

async function sessionUser(req:Request,env:Env){
  const sid=parseCookie(req,'mc_session'); if(!sid)return null
  const row=await env.DB.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).bind(sid,now()).first<any>()
  return row??null
}
function requireUser(req:Request,env:Env){return sessionUser(req,env)}

const tables:Record<string,string[]> = {
  cf_tokens:['id','name','token','status','last_used_at','created_at'],
  deployments:['id','name','worker_code','config','status','logs','worker_url','route','error_message','uuid','custom_path','custom_domain','kv_namespace_id','panel_url','method','cf_account_id','created_at','updated_at'],
  bot_users:['id','telegram_id','username','first_name','last_name','is_active','is_admin','created_at','last_activity'],
  bot_config:['id','bot_token','bot_username','webhook_url','is_active','welcome_message','created_at','updated_at'],
  activity_logs:['id','action','entity_type','entity_name','details','created_at'],
}
const writeTables=new Set(Object.keys(tables))
function safeCols(table:string,cols:string){const allowed=tables[table];if(!allowed)throw new Error('table not allowed');if(cols==='*')return '*';const a=cols.split(',').map(x=>x.trim());if(a.some(x=>!allowed.includes(x)))throw new Error('column not allowed');return a.join(',')}

async function dbApi(req:Request,env:Env,user:any){
  const b=await req.json(); const table=String(b.table||''); if(!writeTables.has(table))return json({data:null,error:{message:'table not allowed'}},400)
  const op=b.op||'select'; const allowed=tables[table]
  const filters=b.filters||{}
  const conditions=['user_id = ?']; const args:any[]=[user.id]
  for(const [k,v] of Object.entries(filters)){if(!allowed.includes(k))return json({data:null,error:{message:'filter not allowed'}},400);conditions.push(`${k} = ?`);args.push(typeof v==='boolean'?(v?1:0):v)}
  const where=conditions.join(' AND ')
  if(op==='select'){
    const cols=safeCols(table,b.columns||'*')
    let sql=`SELECT ${cols} FROM ${table} WHERE ${where}`
    if(b.orderBy){const c=b.orderBy.column;if(!allowed.includes(c))return json({data:null,error:{message:'order column not allowed'}},400);sql+=` ORDER BY ${c} ${b.orderBy.ascending===false?'DESC':'ASC'}`}
    if(Number.isInteger(b.limit))sql+=` LIMIT ${Math.max(0,Math.min(500,b.limit))}`
    const rows=b.head?[]:(await env.DB.prepare(sql).bind(...args).all()).results
    let count=null
    if(b.countExact){const c=await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).bind(...args).first<any>();count=Number(c?.n||0)}
    let data:any=rows
    if(b.single)data=rows[0]??null
    return json({data,error:null,count})
  }
  if(op==='insert'){
    const payload=b.payload||{}; const cols=Object.keys(payload).filter(k=>allowed.includes(k)); if(!cols.length)return json({data:null,error:{message:'empty insert'}},400)
    const vals=cols.map(k=> typeof payload[k]==='boolean'?(payload[k]?1:0): (['config','details'].includes(k)&&payload[k]!==null?JSON.stringify(payload[k]):payload[k]))
    if(!payload.id){cols.unshift('id');vals.unshift(id())}
    if(!cols.includes('user_id')){cols.push('user_id');vals.push(user.id)}
    const placeholders=cols.map(()=>'?').join(',')
    await env.DB.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`).bind(...vals).run()
    const row=await env.DB.prepare(`SELECT ${safeCols(table,b.columns||'*')} FROM ${table} WHERE id=? AND user_id=?`).bind(vals[0],user.id).first()
    return json({data:parseJsonRow(row),error:null})
  }
  if(op==='update'){
    const payload=b.payload||{}; const cols=Object.keys(payload).filter(k=>allowed.includes(k)&&k!=='id'&&k!=='user_id'); if(!cols.length)return json({data:null,error:{message:'empty update'}},400)
    const vals=cols.map(k=> typeof payload[k]==='boolean'?(payload[k]?1:0):(['config','details'].includes(k)&&payload[k]!==null?JSON.stringify(payload[k]):payload[k]))
    await env.DB.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(',')} WHERE ${where}`).bind(...vals,...args).run()
    return json({data:null,error:null})
  }
  if(op==='delete'){await env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...args).run();return json({data:null,error:null})}
  return json({data:null,error:{message:'unsupported operation'}},400)
}

async function log(env:Env,userId:string,action:string,type:string,name:string|null,details?:any){
  await env.DB.prepare(`INSERT INTO activity_logs (id,user_id,action,entity_type,entity_name,details,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id(),userId,action,type,name,details?JSON.stringify(details):null,now()).run()
}
function parseJsonRow(row:any){if(!row)return row;for(const k of ['config','details'])if(typeof row[k]==='string'){try{row[k]=JSON.parse(row[k])}catch{}}for(const k of ['is_active','is_admin'])if(k in row)row[k]=Boolean(row[k]);return row}

async function deploy(env:Env,userId:string,body:any){
  const depId=body.deployment_id
  const token=await env.DB.prepare(`SELECT * FROM cf_tokens WHERE id=? AND user_id=? AND status='active'`).bind(body.token_id,userId).first<any>()
  if(!token){await fail(env,depId,'توکن فعال پیدا نشد');return}
  const addLog=async(s:string)=>{const d=await env.DB.prepare(`SELECT logs FROM deployments WHERE id=? AND user_id=?`).bind(depId,userId).first<any>();await env.DB.prepare(`UPDATE deployments SET logs=?,updated_at=? WHERE id=? AND user_id=?`).bind((d?.logs||'')+s+'\\n',now(),depId,userId).run()}
  const update=async(status:string,fields:any={})=>{const cols=Object.keys(fields);const vals=cols.map(k=>fields[k]);await env.DB.prepare(`UPDATE deployments SET status=${JSON.stringify(status)},${cols.map(c=>`${c}=?`).join(',')},updated_at=? WHERE id=? AND user_id=?`).bind(...vals,now(),depId,userId).run()}
  try{
    await addLog('verifying token...')
    const h={Authorization:`Bearer ${token.token}`}
    const vr=await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify',{headers:h});const vd=await vr.json()
    if(!vd.success)throw new Error('invalid cloudflare token')
    await addLog('✓ token verified')
    const ar=await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=50',{headers:h});const ad=await ar.json()
    if(!ad.success||!ad.result?.length)throw new Error('no cloudflare accounts found')
    const account=ad.result[0];await addLog(`✓ account: ${account.name} (${account.id.slice(0,8)}...)`)
    const sr=await fetch(SOURCE_URL);if(!sr.ok)throw new Error('failed to fetch worker source');const source=await sr.text();await addLog(`✓ worker source fetched (${source.length} bytes)`)
    const kvTitle=`${body.worker_name}-kv`;const kl=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/storage/kv/namespaces?per_page=100`,{headers:h});const kd=await kl.json()
    if(!kd.success)throw new Error(kd.errors?.[0]?.message||'failed to list KV namespaces')
    let kv=kd.result?.find((x:any)=>x.title===kvTitle)?.id
    if(!kv){const kr=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/storage/kv/namespaces`,{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({title:kvTitle})});const k=await kr.json();if(!k.success)throw new Error(k.errors?.[0]?.message||'failed to create KV namespace');kv=k.result.id}
    await addLog(`✓ KV ready: ${kv.slice(0,8)}...`)
    const meta={main_module:'worker.js',compatibility_date:COMPAT,bindings:[{type:'kv_namespace',name:'C',namespace_id:kv},{type:'plain_text',name:'u',text:body.uuid},{type:'plain_text',name:'d',text:body.custom_path||''},{type:'plain_text',name:'p',text:''}]}
    const fd=new FormData();fd.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));fd.append('worker.js',new Blob([source],{type:'application/javascript+module'}),'worker.js')
    const up=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/scripts/${body.worker_name}`,{method:'PUT',headers:h,body:fd});const ud=await up.json();if(!ud.success)throw new Error(ud.errors?.[0]?.message||'failed to upload worker')
    await addLog('✓ worker uploaded')
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/subdomain`,{method:'PUT',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({enabled:true})}).catch(()=>{})
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/scripts/${body.worker_name}/subdomain`,{method:'PUT',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({enabled:true})}).catch(()=>{})
    const sub=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/subdomain`,{headers:h});const sd=await sub.json();const base=sd.result?.subdomain?`https://${body.worker_name}.${sd.result.subdomain}.workers.dev`:`https://${body.worker_name}.workers.dev`
    const panel=`${base}/${body.custom_path||body.uuid}`
    await update('deployed',{worker_url:base,panel_url:panel,kv_namespace_id:kv,cf_account_id:account.id,route:body.custom_domain||null})
    await env.DB.prepare(`UPDATE cf_tokens SET last_used_at=? WHERE id=? AND user_id=?`).bind(now(),token.id,userId).run()
    await addLog(`✓ worker URL: ${base}`);await addLog(`✓ panel URL: ${panel}`);await addLog('✓ deployment complete!')
    await log(env,userId,'deployment_deployed','deployment',body.worker_name)
  }catch(e){await fail(env,depId,e instanceof Error?e.message:'unknown error')}
}
async function fail(env:Env,depId:string,msg:string){await env.DB.prepare(`UPDATE deployments SET status='failed',error_message=?,updated_at=? WHERE id=?`).bind(msg,now(),depId,).run().catch(()=>{})}

async function telegram(env:Env,req:Request,ctx:ExecutionContext){
  const cfg=await env.DB.prepare(`SELECT * FROM bot_config WHERE is_active=1 ORDER BY created_at DESC LIMIT 1`).first<any>()
  if(!cfg)return json({ok:true})
  const update=await req.json();const m=update.message
  if(!m?.text)return json({ok:true})
  const chatId=m.chat.id,telegramId=String(m.from.id),text=m.text.trim()
  let u=await env.DB.prepare(`SELECT * FROM bot_users WHERE user_id=? AND telegram_id=?`).bind(cfg.user_id,telegramId).first<any>()
  if(u) await env.DB.prepare(`UPDATE bot_users SET last_activity=?,username=?,first_name=?,last_name=? WHERE id=?`).bind(now(),m.from.username||null,m.from.first_name||null,m.from.last_name||null,u.id).run()
  else {const prior=await env.DB.prepare(`SELECT COUNT(*) n FROM bot_users WHERE user_id=?`).bind(cfg.user_id).first<any>();const first=Number(prior?.n||0)===0;const uid=id();await env.DB.prepare(`INSERT INTO bot_users (id,user_id,telegram_id,username,first_name,last_name,is_active,is_admin,created_at,last_activity) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uid,cfg.user_id,telegramId,m.from.username||null,m.from.first_name||null,m.from.last_name||null,1,first?1:0,now(),now()).run();u={id:uid,is_admin:first?1:0};await log(env,cfg.user_id,'bot_user_joined','bot',m.from.username?`@${m.from.username}`:m.from.first_name)}
  const send=async(t:string,k?:any)=>{const body:any={chat_id:chatId,text:t,parse_mode:'HTML'};if(k)body.reply_markup=JSON.stringify(k);await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
  if(text==='/start')return send(cfg.welcome_message,{inline_keyboard:[[{text:'🚀 استقرار ورکر',callback_data:'deploy'},{text:'📊 وضعیت',callback_data:'status'}]]}).then(()=>json({ok:true}))
  if(text==='/help')return send('📖 <b>دستورات ربات:</b>\\n\\n/start - شروع کار\\n/deploy &lt;name&gt; - استقرار ورکر جدید\\n/workers - لیست ورکرها\\n/status - وضعیت سرویس‌ها\\n/tokens - لیست توکن‌ها\\n/help - راهنما').then(()=>json({ok:true}))
  if(text==='/status'){const a=await env.DB.prepare(`SELECT COUNT(*) n FROM cf_tokens WHERE user_id=?`).bind(cfg.user_id).first<any>();const d=await env.DB.prepare(`SELECT COUNT(*) n FROM deployments WHERE user_id=? AND status='deployed'`).bind(cfg.user_id).first<any>();const b=await env.DB.prepare(`SELECT COUNT(*) n FROM bot_users WHERE user_id=?`).bind(cfg.user_id).first<any>();return send(`📊 <b>وضعیت:</b>\\n\\n🔑 توکن‌ها: ${a?.n||0}\\n🚀 ورکرهای مستقر: ${d?.n||0}\\n👥 کاربران: ${b?.n||0}\\n🤖 ربات: ${cfg.is_active?'فعال ✅':'غیرفعال ❌'}`).then(()=>json({ok:true}))}
  if(text==='/workers'){const rows=await env.DB.prepare(`SELECT name,status,worker_url FROM deployments WHERE user_id=? ORDER BY created_at DESC LIMIT 10`).bind(cfg.user_id).all<any>();let s='🚀 <b>ورکرهای اخیر:</b>\\n\\n';for(const w of rows.results||[])s+=`${w.status==='deployed'?'✅':w.status==='failed'?'❌':'⏳'} <code>${w.name}</code>\\n${w.worker_url?`🔗 ${w.worker_url}\\n`:''}`;return send(rows.results?.length?s:'هنوز ورکری مستقر نشده.').then(()=>json({ok:true}))}
  if(text==='/tokens'){const rows=await env.DB.prepare(`SELECT name,status FROM cf_tokens WHERE user_id=? ORDER BY created_at DESC`).bind(cfg.user_id).all<any>();return send(rows.results?.length?'🔑 <b>توکن‌ها:</b>\\n\\n'+rows.results.map((x:any)=>`${x.status==='active'?'✅':'❌'} ${x.name}`).join('\\n'):'🔑 هنوز توکنی اضافه نشده.').then(()=>json({ok:true}))}
  if(text.startsWith('/deploy')){const name=(text.split(/\s+/)[1]||'').toLowerCase().replace(/[^a-z0-9-]/g,'');if(!name)return send('فرمت: <code>/deploy my-worker</code>').then(()=>json({ok:true}));if(!u.is_admin)return send('⛔ فقط ادمین‌ها می‌توانند استقرار دهند.').then(()=>json({ok:true}));const token=await env.DB.prepare(`SELECT * FROM cf_tokens WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`).bind(cfg.user_id).first<any>();if(!token)return send('🔑 توکن فعالی پیدا نشد.').then(()=>json({ok:true}));const depId=id(),duuid=crypto.randomUUID();await env.DB.prepare(`INSERT INTO deployments (id,user_id,name,worker_code,config,status,uuid,method,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(depId,cfg.user_id,name,'[telegram]','{"source":"telegram"}','deploying',duuid,'workers',now(),now()).run();await log(env,cfg.user_id,'deployment_created','deployment',name,{source:'telegram'});await send(`🚀 در حال استقرار <code>${name}</code>...`);ctx.waitUntil(deploy(env,cfg.user_id,{deployment_id:depId,token_id:token.id,worker_name:name,uuid:duuid,method:'workers'}));return json({ok:true})}
  return send('متوجه نشدم. /help را بفرست.').then(()=>json({ok:true}))
}
function ctxWait(env:Env,depId:string,userId:string,b:any){deploy(env,userId,b).catch(()=>{})}

async function route(req:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(req.url)
  if(req.method==='OPTIONS')return new Response(null,{headers:CORS})
  if(url.pathname==='/telegram'&&req.method==='POST')return telegram(env,req,ctx)
  if(url.pathname==='/health')return json({ok:true,service:'miliconfig-pro',storage:'cloudflare-d1'})
  if(url.pathname==='/api/auth/signup'&&req.method==='POST'){
    const b=await req.json();const email=String(b.email||'').trim().toLowerCase();const pass=String(b.password||'')
    if(!email||pass.length<6)return json({error:'ایمیل یا رمز عبور نامعتبر است'},400)
    const exists=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();if(exists)return json({error:'این ایمیل قبلاً ثبت شده است'},409)
    const {hash,salt}=await hashPassword(pass);const uid=id();await env.DB.prepare('INSERT INTO users (id,email,password_hash,password_salt) VALUES (?,?,?,?)').bind(uid,email,hash,salt).run()
    const count=await env.DB.prepare('SELECT COUNT(*) n FROM users').first<any>();const sid=await createSession(env,uid);return json({user:{id:uid,email},is_admin:Number(count?.n||1)===1},{'Set-Cookie':cookie('mc_session',sid,60*60*24*30)})
  }
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
    const b=await req.json();const email=String(b.email||'').trim().toLowerCase();const u=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first<any>()
    if(!u||!(await verifyPassword(String(b.password||''),u.password_hash,u.password_salt)))return json({error:'ایمیل یا رمز عبور اشتباه است'},401)
    const sid=await createSession(env,u.id);return json({user:{id:u.id,email:u.email}},{'Set-Cookie':cookie('mc_session',sid,60*60*24*30)})
  }
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){const sid=parseCookie(req,'mc_session');if(sid)await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run();return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json',...CORS,'Set-Cookie':clearCookie('mc_session')}})}
  if(url.pathname==='/api/auth/me'){const u=await requireUser(req,env);return json({user:u})}
  const user=await requireUser(req,env);if(!user)return json({error:'ورود لازم است'},401)
  if(url.pathname==='/api/db'&&req.method==='POST')return dbApi(req,env,user)
  if(url.pathname==='/api/deploy'&&req.method==='POST'){const b=await req.json();if(!b.deployment_id||!b.token_id||!b.worker_name)return json({error:'پارامترهای استقرار ناقص است'},400);ctx.waitUntil(deploy(env,user.id,b));return json({success:true,deployment_id:b.deployment_id})}
  return json({error:'not found'},404)
}
async function createSession(env:Env,userId:string){const sid=id();const expires=new Date(Date.now()+1000*60*60*24*30).toISOString();await env.DB.prepare('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)').bind(sid,userId,expires).run();return sid}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(req.url)
    const r=await route(req,env,ctx)
    if(r.status!==404||url.pathname.startsWith('/api/')||url.pathname==='/telegram'||url.pathname==='/health')return r
    return env.ASSETS.fetch(req)
  }
}
