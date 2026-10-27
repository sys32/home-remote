import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';

test('HTTP service protects commands, rejects public hosts, and serves local assets',async()=>{
  const port=43822,base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,TV_REMOTE_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`Server exited ${code}`)));});
    const page=await fetch(base);assert.equal(page.status,200);const html=await page.text();const key=html.match(/name="session-key" content="([a-f0-9]+)"/)[1];assert.equal(key.length,48);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const auth={'Content-Type':'application/json','X-Doma-Key':key};
    assert.equal((await fetch(base+'/api/devices')).status,403);
    assert.equal((await fetch(base+'/api/devices',{headers:auth})).status,200);
    assert.equal((await fetch(base+'/api/scan',{method:'POST',headers:{...auth,Origin:'https://example.com'},body:'{}'})).status,403);
    const invalid=await fetch(base+'/api/connect',{method:'POST',headers:auth,body:JSON.stringify({ip:'8.8.8.8',brand:'LG'})});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/IPv4/);
    assert.equal((await fetch(base+'/api/command',{method:'POST',headers:auth,body:'{"command":"powerOff"}'})).status,400);
    const wrongHost=await new Promise((resolve,reject)=>{http.get(base,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);
    for(const asset of ['/app.js','/style.css'])assert.equal((await fetch(base+asset)).status,200);
  }finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
});
