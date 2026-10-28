import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('saved TVs survive restart; edits preserve pairing; API never exposes tokens',async()=>{
  const store=await fs.mkdtemp(path.join(os.tmpdir(),'doma-tv-test-'));
  const ip='192.168.254.50',port=43823,base=`http://127.0.0.1:${port}`;let child;
  async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,TV_REMOTE_PORT:String(port),TV_REMOTE_STORE_DIR:store},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Server exit '+code)));});const html=await (await fetch(base)).text();return {'Content-Type':'application/json','X-Doma-Key':html.match(/name="session-key" content="([a-f0-9]+)"/)[1]};}
  async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}
  try{
    await fs.writeFile(path.join(store,'devices.json'),JSON.stringify({[ip]:{brand:'LG',name:'Old',clientKey:'do-not-expose',mac:''}}));
    let headers=await start();
    const save=async data=>fetch(base+'/api/save',{method:'POST',headers,body:JSON.stringify(data)});
    const saved=await save({ip,name:'Дневна',room:'Прв кат',favorite:true,brand:'LG',mac:'ab-cd-ef-12-34-56',token:'injected'});assert.equal(saved.status,200);const result=await saved.json();assert.equal(result.device.mac,'AB:CD:EF:12:34:56');assert.equal(result.devices.length,1);assert.equal(JSON.stringify(result).includes('do-not-expose'),false);
    const invalid=await save({ip,name:'Дневна',brand:'LG',mac:'invalid'});assert.equal(invalid.status,400);
    await stop();headers=await start();
    const devices=(await (await fetch(base+'/api/devices',{headers})).json()).devices;assert.equal(devices.length,1);assert.equal(devices[0].name,'Дневна');assert.equal(devices[0].saved,true);assert.equal(devices[0].room,'Прв кат');assert.equal(devices[0].favorite,true);assert.equal(devices[0].mac,'AB:CD:EF:12:34:56');assert.equal(devices[0].clientKey,undefined);
    const disk=JSON.parse(await fs.readFile(path.join(store,'devices.json'),'utf8'));assert.equal(disk[ip].clientKey,'do-not-expose');assert.equal(disk[ip].token,undefined);
  }finally{await stop();await fs.rm(store,{recursive:true,force:true});}
});
