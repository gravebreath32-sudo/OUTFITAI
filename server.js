const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const STORE = process.env.OUTFITAI_STORE || path.join(ROOT, 'data', 'store.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '::';
const sessions = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp' };
function readStore(){ try { return JSON.parse(fs.readFileSync(STORE,'utf8')); } catch { return { users:[], items:[], outfits:[], plans:[] }; } }
function writeStore(db){ fs.mkdirSync(path.dirname(STORE),{recursive:true}); fs.writeFileSync(STORE,JSON.stringify(db,null,2)); }
function send(res,status,data,headers={}){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers}); res.end(JSON.stringify(data)); }
function body(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>8_000_000) reject(new Error('Request is too large'));});req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);}); }
function cookie(req,key){ const m=(req.headers.cookie||'').match(new RegExp('(?:^|; )'+key+'=([^;]+)'));return m?decodeURIComponent(m[1]):''; }
function userFor(req){const id=sessions.get(cookie(req,'outfitai_session'));return readStore().users.find(u=>u.id===id);}
function publicUser(u){return {id:u.id,name:u.name,email:u.email,preferences:u.preferences||{}};}
function hash(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
async function route(req,res){
 const url=new URL(req.url,'http://localhost'); const p=url.pathname;
 if(req.method==='GET'&&p==='/healthz')return send(res,200,{ok:true});
 if(req.method==='GET'&&p==='/api/session'){const u=userFor(req);return send(res,200,{user:u?publicUser(u):null});}
 if(req.method==='POST'&&p==='/api/signup'){
  const b=await body(req); if(!b.name?.trim()||!/^\S+@\S+\.\S+$/.test(b.email||'')||(b.password||'').length<8)return send(res,400,{error:'Add your name, a valid email and a password with at least 8 characters.'});
  const db=readStore();if(db.users.some(u=>u.email===b.email.toLowerCase()))return send(res,409,{error:'An account with this email already exists.'});
  const salt=crypto.randomBytes(16).toString('hex');const u={id:crypto.randomUUID(),name:b.name.trim(),email:b.email.toLowerCase(),salt,passwordHash:hash(b.password,salt),preferences:{styles:['Minimalist'],colors:['Black','Cream'],occasions:['Everyday']},createdAt:new Date().toISOString()};db.users.push(u);writeStore(db);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,u.id);return send(res,201,{user:publicUser(u)},{'Set-Cookie':`outfitai_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`});
 }
 if(req.method==='POST'&&p==='/api/login'){
  const b=await body(req);const u=readStore().users.find(x=>x.email===String(b.email||'').toLowerCase());if(!u||hash(b.password||'',u.salt)!==u.passwordHash)return send(res,401,{error:'Email or password is incorrect.'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,u.id);return send(res,200,{user:publicUser(u)},{'Set-Cookie':`outfitai_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`});
 }
 if(req.method==='POST'&&p==='/api/logout'){sessions.delete(cookie(req,'outfitai_session'));return send(res,200,{ok:true},{'Set-Cookie':'outfitai_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 const user=userFor(req);if(p.startsWith('/api/')&&!user)return send(res,401,{error:'Sign in to continue.'});
 if(req.method==='GET'&&p==='/api/items')return send(res,200,{items:readStore().items.filter(i=>i.userId===user.id)});
 if(req.method==='POST'&&p==='/api/items'){
  const b=await body(req);if(!b.name?.trim()||!b.category)return send(res,400,{error:'Item name and category are required.'});if(b.image?.length>5_000_000)return send(res,413,{error:'Image must be smaller than 5 MB.'});const db=readStore();const it={id:crypto.randomUUID(),userId:user.id,name:b.name.trim(),category:b.category,color:b.color||'Unspecified',style:b.style||'Everyday',season:b.season||'All season',occasion:b.occasion||'Everyday',brand:b.brand||'',image:b.image||'',favorite:false,wears:0,createdAt:new Date().toISOString()};db.items.push(it);writeStore(db);return send(res,201,{item:it});
 }
 const im=p.match(/^\/api\/items\/([^/]+)$/);if(im){const db=readStore();const i=db.items.findIndex(x=>x.id===im[1]&&x.userId===user.id);if(i<0)return send(res,404,{error:'Item not found.'});if(req.method==='DELETE'){db.items.splice(i,1);db.outfits=db.outfits.map(o=>({...o,itemIds:o.itemIds.filter(id=>id!==im[1])}));writeStore(db);return send(res,200,{ok:true});}if(req.method==='PATCH'){const b=await body(req);db.items[i]={...db.items[i],...Object.fromEntries(['name','category','color','style','season','occasion','brand','favorite'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]))};writeStore(db);return send(res,200,{item:db.items[i]});}}
 if(req.method==='PATCH'&&p==='/api/profile'){const b=await body(req);const db=readStore();const i=db.users.findIndex(u=>u.id===user.id);db.users[i].preferences={...db.users[i].preferences,...b};if(b.name)db.users[i].name=b.name;writeStore(db);return send(res,200,{user:publicUser(db.users[i])});}
 if(req.method==='POST'&&p==='/api/recommend'){
  const b=await body(req);const items=readStore().items.filter(i=>i.userId===user.id);if(!items.length)return send(res,400,{error:'Add a few pieces to your wardrobe first.'});const groups={Tops:[],Bottoms:[],Dresses:[],Outerwear:[],Shoes:[],Accessories:[],Bags:[]};items.forEach(i=>(groups[i.category]||groups.Accessories).push(i));const pool=Object.values(groups).flat();const picks=[];const seed=(b.occasion||'everyday').length+(b.style||'minimalist').length;
  for(let n=0;n<3;n++){const chosen=[];const put=(cat)=>{if(groups[cat]?.length)chosen.push(groups[cat][(seed+n+chosen.length)%groups[cat].length]);};if(groups.Dresses?.length&&n===2){put('Dresses');}else{put('Tops');put('Bottoms');}put('Outerwear');put('Shoes');put('Accessories');if(chosen.length<2)pool.slice(n,n+2).forEach(x=>{if(!chosen.includes(x))chosen.push(x);});const names=chosen.map(x=>x.name.toLowerCase()).join(' ');const score=Math.min(97,76+chosen.length*3+(b.occasion?3:0));picks.push({id:crypto.randomUUID(),name:['The easy classic','A little more polished','Off-duty, elevated'][n],itemIds:chosen.map(x=>x.id),score,why:`A ${b.style||'versatile'} combination for ${b.occasion||'everyday'}—built from ${chosen.length} pieces in your closet.`,colorNote:`${chosen.map(x=>x.color).filter(Boolean).join(' + ')||'Your chosen palette'} creates a considered palette.`,tip:b.weather==='Rainy'?'Add a water-resistant layer if you own one.':'Finish with an accessory you already love.',occasion:b.occasion||'Everyday',weather:b.weather||'Not specified',createdAt:new Date().toISOString()});}
  return send(res,200,{outfits:picks,mode:'wardrobe-rules'});
 }
 if(req.method==='GET'&&p==='/api/outfits')return send(res,200,{outfits:readStore().outfits.filter(o=>o.userId===user.id)});
 if(req.method==='POST'&&p==='/api/outfits'){const b=await body(req);const db=readStore();const o={...b,id:crypto.randomUUID(),userId:user.id,savedAt:new Date().toISOString()};db.outfits.push(o);writeStore(db);return send(res,201,{outfit:o});}
 if(req.method==='GET'&&p==='/api/plans')return send(res,200,{plans:readStore().plans.filter(x=>x.userId===user.id)});
 if(req.method==='POST'&&p==='/api/plans'){const b=await body(req);const db=readStore();const plan={...b,id:crypto.randomUUID(),userId:user.id};db.plans.push(plan);writeStore(db);return send(res,201,{plan});}
 if(req.method==='DELETE'&&p==='/api/account'){const db=readStore();db.users=db.users.filter(u=>u.id!==user.id);db.items=db.items.filter(i=>i.userId!==user.id);db.outfits=db.outfits.filter(o=>o.userId!==user.id);db.plans=db.plans.filter(x=>x.userId!==user.id);writeStore(db);sessions.delete(cookie(req,'outfitai_session'));return send(res,200,{ok:true},{'Set-Cookie':'outfitai_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 if(p.startsWith('/api/'))return send(res,404,{error:'Not found.'});
 const file=p==='/'?'index.html':decodeURIComponent(p.slice(1));const target=path.resolve(ROOT,'public',file);if(!target.startsWith(path.resolve(ROOT,'public')+path.sep))return send(res,403,{error:'Forbidden'});fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(data);});
}
http.createServer((req,res)=>route(req,res).catch(e=>send(res,500,{error:'Something went wrong. Please try again.'}))).listen(PORT,HOST,()=>console.log(`OutfitAI listening on ${HOST}:${PORT}`));
