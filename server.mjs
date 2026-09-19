import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {seed,applyCommand,nowLocal,uid} from './public/domain.js';
const root=dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||3000),origin=process.env.APP_ORIGIN||`http://localhost:${port}`,secure=origin.startsWith('https://');
if(process.env.NODE_ENV==='production'&&!secure)throw Error('Production requires APP_ORIGIN=https://your-domain and an HTTPS reverse proxy.');
const dbPath=resolve(process.env.MOTEL_DB||join(root,'data','motel.sqlite'));mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
const sql=new DatabaseSync(dbPath);sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);');
const hash=(pass,salt)=>scryptSync(pass,salt,64,{N:16384,r:8,p:1}).toString('hex');
const passCheck=p=>typeof p==='string'&&p.length>=15&&p.length<=200;
const getState=()=>JSON.parse(sql.prepare('SELECT body FROM state WHERE id=1').get().body);
const saveState=db=>sql.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(db));
if(!sql.prepare('SELECT id FROM state WHERE id=1').get()){
 const user=process.env.MOTEL_INITIAL_USER||'user1',pass=process.env.MOTEL_INITIAL_PASSWORD;
 if(!/^[a-z0-9._-]{3,40}$/.test(user)||!passCheck(pass))throw Error('For first launch, set MOTEL_INITIAL_USER and MOTEL_INITIAL_PASSWORD (15+ characters) through your host secret manager.');
 const db=seed();db.guests=[];db.bookings=[];db.transactions=[];db.activity=[];db.rooms.forEach(r=>r.status='ready');db.staff=[{id:uid(),username:user,name:process.env.MOTEL_INITIAL_NAME||'User 1',active:true}];const salt=randomBytes(32).toString('hex');
 sql.exec('BEGIN IMMEDIATE');try{sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run(db.staff[0].id,user,salt,hash(pass,salt));sql.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify(db));sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}
}
const digest=t=>createHash('sha256').update(t).digest('hex');
const attempts=new Map();
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
function currentUser(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('staydesk='))?.slice(9);if(!token)return null;const s=sql.prepare('SELECT user,expires FROM sessions WHERE token=?').get(digest(token));if(!s||s.expires<Date.now())return null;return getState().staff.find(u=>u.id===s.user&&u.active)?.id||null;}
async function body(req){let b='';for await(const c of req){b+=c;if(b.length>1000000)throw Object.assign(Error('Request too large.'),{status:413});}try{return JSON.parse(b||'{}');}catch{throw Error('Invalid JSON.');}}
const cookie=(token,age=28800)=>`staydesk=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
const publicFiles=new Set(['index.html','app.js','domain.js','styles.css','favicon.svg']);
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
 try{const path=new URL(req.url,origin).pathname;
 if(path==='/api/health'&&req.method==='GET')return json(res,200,{service:'staydesk'});
 if(path.startsWith('/api/')){
  if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['x-staydesk-request']!=='1'))return json(res,403,{error:'Request origin not allowed.'});
  if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{error:'Method not allowed.'});
  const p=req.method==='POST'?await body(req):{},user=currentUser(req);
  if(path==='/api/login'&&req.method==='POST'){
   const username=String(p.username||'').toLowerCase().slice(0,40),ip=req.socket.remoteAddress;const key=ip+':'+username,ipKey='ip:'+ip;
   for(const k of [key,ipKey]){const a=attempts.get(k);if(a&&a.until>Date.now()&&a.n>=(k===ipKey?50:8))return json(res,429,{error:'Too many attempts. Try again in 15 minutes.'});}
   const u=sql.prepare('SELECT * FROM users WHERE username=?').get(username),salt=u?.salt||'invalid-user-salt',candidate=hash(String(p.password||'').slice(0,200),salt),expected=u?.hash||'0'.repeat(128);
   if(!u||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(expected,'hex'))||!getState().staff.some(s=>s.id===u.id&&s.active)){
    for(const k of [key,ipKey]){const a=attempts.get(k);attempts.set(k,{n:a&&a.until>Date.now()?a.n+1:1,until:Date.now()+900000});}return json(res,401,{error:'Incorrect username or password.'});
   }
   attempts.delete(key);sql.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());const token=randomBytes(32).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,Date.now()+28800000);return json(res,200,{ok:true},{'Set-Cookie':cookie(token)});
  }
  if(!user)return json(res,401,{error:'Please sign in.'});
  if(path==='/api/logout'&&req.method==='POST'){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('staydesk='))?.slice(9);if(token)sql.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});}
  if(path==='/api/state'&&req.method==='GET')return json(res,200,{db:getState(),user});
  if(path==='/api/password'&&req.method==='POST'){
   if(!passCheck(p.password))throw Error('Use a password with 15–200 characters.');if(!sql.prepare('SELECT id FROM users WHERE id=?').get(p.staffId))throw Error('Account not found.');
   const salt=randomBytes(32).toString('hex'),hashed=hash(p.password,salt);sql.exec('BEGIN IMMEDIATE');try{sql.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hashed,p.staffId);sql.prepare('DELETE FROM sessions WHERE user=?').run(p.staffId);const db=getState();db.revision++;db.activity.push({id:uid(),user,action:'password-reset',booking:'',at:nowLocal(),detail:`Password reset for ${db.staff.find(s=>s.id===p.staffId).name}`});saveState(db);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}return json(res,200,{ok:true});
  }
  if((path==='/api/command'||path==='/api/staff')&&req.method==='POST'){
   let credentials=null;if(path==='/api/staff'){if(!passCheck(p.password))throw Error('Use a password with 15–200 characters.');const salt=randomBytes(32).toString('hex');credentials={id:uid(),salt,hash:hash(p.password,salt)};}else if(['add-staff'].includes(p.command))throw Error('Use the staff-account form to create a secure account.');
   sql.exec('BEGIN IMMEDIATE');let r;try{const db=getState();if(p.revision!==db.revision)throw Object.assign(Error('Another staff member updated the register. Review the latest data and retry.'),{status:409});
    r=credentials?applyCommand(db,user,'add-staff',{name:p.name,username:p.username,staffId:credentials.id}):applyCommand(db,user,p.command,p.payload);
    if(credentials)sql.prepare('INSERT INTO users VALUES(?,?,?,?)').run(credentials.id,String(p.username).toLowerCase(),credentials.salt,credentials.hash);
    if(p.command==='staff-status'&&!r.db.staff.find(s=>s.id===p.payload.staffId)?.active)sql.prepare('DELETE FROM sessions WHERE user=?').run(p.payload.staffId);
    saveState(r.db);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}return json(res,200,{...r,user});
  }
  return json(res,404,{error:'Not found.'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed.'});
 const file=path==='/'?'index.html':path.slice(1);if(!publicFiles.has(file))return json(res,404,{error:'Not found.'});const data=readFileSync(join(root,'public',file));res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[extname(file)],'Cache-Control':file==='index.html'?'no-cache':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){json(res,e.status||400,{error:e.message||'Unable to process request.'});}
});
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Staydesk server listening on port ${port}.`));
function stop(){server.close(()=>{sql.close();process.exit(0);});}process.on('SIGTERM',stop);process.on('SIGINT',stop);
setInterval(()=>{for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},60000).unref();
