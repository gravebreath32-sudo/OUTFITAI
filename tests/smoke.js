const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { once } = require('node:events');

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outfitai-'));const port=24000+Math.floor(Math.random()*15000);
 const child=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{env:{...process.env,PORT:String(port),OUTFITAI_STORE:path.join(dir,'store.json')},stdio:'inherit'});
 try{
  await new Promise((resolve,reject)=>{let attempts=0;const poll=()=>{const req=http.get(`http://127.0.0.1:${port}/api/session`,r=>{r.resume();resolve();});req.on('error',e=>{if(++attempts>60)reject(new Error(`Server did not start: ${e.message}`));else setTimeout(poll,100);});};poll();});
  const fetcher=global.fetch;let cookie='';const call=async(path,method='GET',data)=>{const r=await fetcher(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,data:await r.json()};};
  let r=await call('/signup','POST',{name:'Test User',email:'test@example.com',password:'test-password'});assert.equal(r.status,201);assert.ok(cookie);
  r=await call('/items');assert.equal(r.status,200);assert.equal(r.data.items.length,0);
  const first=await call('/items','POST',{name:'White shirt',category:'Tops',color:'White'});assert.equal(first.status,201);
  const second=await call('/items','POST',{name:'Black trousers',category:'Bottoms',color:'Black'});assert.equal(second.status,201);
  r=await call('/recommend','POST',{occasion:'Office',style:'Minimalist'});assert.equal(r.status,200);assert.equal(r.data.outfits.length,3);const owned=new Set([first.data.item.id,second.data.item.id]);for(const o of r.data.outfits)for(const id of o.itemIds)assert.ok(owned.has(id),'outfit references an owned item');
  r=await call('/outfits','POST',{...r.data.outfits[0],saved:true});assert.equal(r.status,201);
  r=await call('/outfits');assert.equal(r.data.outfits.length,1);
  await call('/logout','POST');r=await call('/items');assert.equal(r.status,401);
  console.log('OutfitAI smoke test passed.');
 }finally{child.kill();try{await once(child,'exit');}catch{}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
