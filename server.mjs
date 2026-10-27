import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {TVSocket,localIP,magicPacket} from './protocol.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)), port=Number(process.env.TV_REMOTE_PORT||43821);
const secret=crypto.randomBytes(24).toString('hex');
const storeDir=path.join(os.homedir(),'Library','Application Support','DomaTV');
let saved={};try{saved=JSON.parse(await fs.readFile(path.join(storeDir,'devices.json'),'utf8'));}catch{}
async function persist(){await fs.mkdir(storeDir,{recursive:true,mode:0o700});await fs.writeFile(path.join(storeDir,'devices.json'),JSON.stringify(saved),{mode:0o600});}
let devices=new Map(Object.entries(saved).filter(([ip,d])=>localIP(ip)&&d.brand).map(([ip,d])=>[ip,{ip,name:d.name||`${d.brand} TV`,brand:d.brand,model:d.model||'',mac:d.mac||''}])), controller=null, scanPromise=null;
let state={status:'idle',message:'Избери телевизор за поврзување.',device:null};
const subscribers=new Set();
function update(values){Object.assign(state,values);for(const res of subscribers)res.write(`data: ${JSON.stringify(state)}\n\n`);}
function request(url,{method='GET',body,timeout=3000}={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);if(!localIP(u.hostname))return reject(Error('Дозволени се само локални IP-адреси.'));
    const req=(u.protocol==='https:'?https:http).request(u,{method,timeout,headers:body?{'Content-Type':'application/json'}:{}},res=>{
      if(res.statusCode<200||res.statusCode>=300){res.resume();reject(Error(`Телевизорот врати HTTP ${res.statusCode}.`));return;}
      let bytes=0,chunks=[];res.on('data',x=>{bytes+=x.length;if(bytes>1048576){req.destroy(Error('Преголем одговор.'));return;}chunks.push(x);});res.on('end',()=>resolve(Buffer.concat(chunks).toString()));res.on('error',reject);
    });req.on('timeout',()=>req.destroy(Error('Телевизорот не одговори.')));req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
  });
}
function xmlValue(xml,name){return (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`,'i'))?.[1]||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
async function describe(location){
  try{
    const u=new URL(location);if(!localIP(u.hostname)||u.protocol!=='http:')return;
    const xml=await request(u);const manufacturer=xmlValue(xml,'manufacturer'),model=xmlValue(xml,'modelName'),name=xmlValue(xml,'friendlyName');
    const text=`${manufacturer} ${model} ${name} ${xmlValue(xml,'deviceType')}`;
    let brand=/samsung/i.test(text)?'Samsung':/LG Electronics|webos|lge/i.test(text)?'LG':/philips|tp vision/i.test(text)?'Philips':'Other';
    if(brand==='Other'&&!/television|mediarenderer|\btv\b/i.test(text))return;
    const d={ip:u.hostname,name:name||model||brand,brand,model,mac:saved[u.hostname]?.mac||''};
    if(brand==='Samsung')try{const info=JSON.parse(await request(`http://${d.ip}:8001/api/v2/`));d.model=info.device?.modelName||d.model;const mac=info.device?.wifiMac;if(mac&&/^([a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(mac))d.mac=mac;}catch{}
    devices.set(d.ip,d);
  }catch{}
}
async function discover(){
  devices=new Map();
  const sockets=[],tasks=[],locations=new Set();
  const addresses=[...new Set(Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal&&localIP(x.address)).map(x=>x.address))];
  if(!addresses.length)throw Error('Нема активна домашна мрежа. Поврзи го Mac на Wi-Fi или Ethernet.');
  await Promise.all(addresses.map(address=>new Promise(resolve=>{
    const socket=dgram.createSocket('udp4');sockets.push(socket);
    socket.on('error',()=>{try{socket.close();}catch{}resolve();});
    socket.on('message',buffer=>{const message=buffer.toString();const location=message.match(/^location:\s*(.+)$/im)?.[1]?.trim();if(location&&!locations.has(location)){locations.add(location);tasks.push(describe(location));}});
    socket.bind(0,address,()=>{try{socket.setMulticastInterface(address);const payload=Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');socket.send(payload,1900,'239.255.255.250');setTimeout(()=>{try{socket.send(payload,1900,'239.255.255.250',()=>{});}catch{}},600);}catch{}resolve();});
  })));
  await new Promise(r=>setTimeout(r,4000));for(const socket of sockets)try{socket.close();}catch{}
  await Promise.allSettled(tasks);return [...devices.values()];
}
const keys={up:['KEY_UP','UP','CursorUp'],down:['KEY_DOWN','DOWN','CursorDown'],left:['KEY_LEFT','LEFT','CursorLeft'],right:['KEY_RIGHT','RIGHT','CursorRight'],ok:['KEY_ENTER','ENTER','Confirm'],back:['KEY_RETURN','BACK','Back'],home:['KEY_HOME','HOME','Home'],source:['KEY_SOURCE',null,'Source'],volumeUp:['KEY_VOLUP','audio/volumeUp','VolumeUp'],volumeDown:['KEY_VOLDOWN','audio/volumeDown','VolumeDown'],mute:['KEY_MUTE','audio/setMute','Mute'],channelUp:['KEY_CHUP','tv/channelUp','ChannelStepUp'],channelDown:['KEY_CHDOWN','tv/channelDown','ChannelStepDown'],powerOff:['KEY_POWEROFF','system/turnOff','Standby'],play:['KEY_PLAY','media.controls/play','PlayPause'],pause:['KEY_PAUSE','media.controls/pause','Pause']};
class Controller{
  constructor(device){this.device=device;this.pending=new Map();this.seq=0;this.closed=false;this.ready=false;this.muted=false;}
  status(status,message){if(!this.closed)update({status,message,device:this.device});}
  async connect(){
    const d=this.device;
    if(d.brand==='Other')throw Error('Марката е откриена, но сè уште нема соодветен протокол за контрола.');
    if(d.brand==='Philips'){
      for(const version of [1,5])try{await request(`http://${d.ip}:1925/${version}/system`);this.version=version;this.ready=true;this.status('connected','Поврзан преку JointSpace.');return;}catch{}
      throw Error('Овој Philips не нуди JointSpace 1/5. Поновите модели со спарување или Android TV бараат дополнителна поддршка.');
    }
    const brand=d.brand, token=saved[d.ip]?.token;
    const query=new URLSearchParams({name:Buffer.from('Doma TV').toString('base64'),...(token?{token}:{})});
    const urls=brand==='Samsung'?[`wss://${d.ip}:8002/api/v2/channels/samsung.remote.control?${query}`,`ws://${d.ip}:8001/api/v2/channels/samsung.remote.control?${query}`]:[`wss://${d.ip}:3001/`,`ws://${d.ip}:3000/`];
    let last;
    for(const url of urls){
      if(this.closed)return;const ws=new TVSocket(url);this.ws=ws;
      ws.on('message',text=>this.onMessage(text));
      try{await ws.connect();last=null;break;}catch(e){last=e;ws.close();}
    }
    if(last)throw Error('Не може да се поврзе. Вклучи го телевизорот и дозволи управување преку мрежа.');
    if(this.closed){this.ws.close();return;}
    this.ws.on('closed',()=>{if(!this.closed){this.ready=false;this.status('disconnected','Врската е прекината. Поврзи се повторно.');}});
    this.status('pairing','Одобри „Doma TV“ на екранот на телевизорот.');
    this.timer=setTimeout(()=>{if(!this.ready){this.status('error','Спарувањето истече. Провери го екранот и поврзи се повторно.');this.close();}},60000);
    if(brand==='LG')this.ws.send({id:'register',type:'register',payload:{'forcePairing':false,'pairingType':'PROMPT',...(saved[d.ip]?.clientKey?{'client-key':saved[d.ip].clientKey}:{}),manifest:{manifestVersion:1,appVersion:'1.0',permissions:['LAUNCH','CONTROL_AUDIO','CONTROL_POWER','CONTROL_INPUT_TV','CONTROL_INPUT_MEDIA_PLAYBACK','CONTROL_MOUSE_AND_KEYBOARD','READ_INPUT_DEVICE_LIST']}}});
  }
  async onMessage(text){
    try{
      const msg=JSON.parse(text),d=this.device;
      if(msg.type==='registered'||msg.event==='ms.channel.connect'){
        clearTimeout(this.timer);this.ready=true;
        saved[d.ip]={...saved[d.ip],...d,...(msg.payload?.['client-key']?{clientKey:msg.payload['client-key']}:{}),...(msg.data?.token?{token:msg.data.token}:{})};
        await persist();this.status('connected','Поврзан. Далечинското е подготвено.');return;
      }
      if(msg.event==='ms.channel.unauthorized'||msg.event==='ms.channel.timeOut'){
        this.status('error','Телевизорот не го одобри пристапот. Поврзи се и прифати на екранот.');this.close();return;
      }
      if(this.pending.has(msg.id)){const p=this.pending.get(msg.id);clearTimeout(p.timer);this.pending.delete(msg.id);if(msg.type==='error')p.reject(Error(msg.error||'Командата е одбиена.'));else p.resolve(msg.payload);}
      else if(msg.type==='error'){this.status('error',msg.error||'Телевизорот ја одби командата.');}
    }catch(e){this.status('error',e.message);}
  }
  lg(uri,payload={}){return new Promise((resolve,reject)=>{const id=`request-${++this.seq}`;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Нема потврда од телевизорот.'));},5000);this.pending.set(id,{resolve,reject,timer});try{this.ws.send({id,type:'request',uri:`ssap://${uri}`,payload});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  async command(command){
    if(!this.ready)throw Error('Прво поврзи го телевизорот.');
    const d=this.device, mapping=keys[command];if(!mapping)throw Error('Непозната команда.');
    if(d.brand==='Samsung'){this.ws.send({method:'ms.remote.control',params:{Cmd:'Click',DataOfCmd:mapping[0],Option:'false',TypeOfRemote:'SendRemoteKey'}});return 'Командата е испратена.';}
    if(d.brand==='Philips'){await request(`http://${d.ip}:1925/${this.version}/input/key`,{method:'POST',body:{key:mapping[2]}});return 'Телевизорот ја прифати командата.';}
    if(command==='source')throw Error('За LG користи ги копчињата HDMI.');
    if(['up','down','left','right','ok','back','home'].includes(command)){
      if(!this.pointer?.ready){const payload=await this.lg('com.webos.service.networkinput/getPointerInputSocket');const u=new URL(payload.socketPath);if(u.hostname!==d.ip||!['ws:','wss:'].includes(u.protocol))throw Error('Невалидна адреса од телевизорот.');this.pointer=new TVSocket(u);await this.pointer.connect();}
      this.pointer.send(`type:button\nname:${mapping[1]}\n\n`);return 'Командата е испратена.';
    }
    if(command==='mute'){const status=await this.lg('audio/getVolume');await this.lg(mapping[1],{mute:!(status.muted??status.volumeStatus?.muteStatus??false)});}
    else await this.lg(mapping[1]);return 'Телевизорот ја прифати командата.';
  }
  close(){this.closed=true;this.ready=false;clearTimeout(this.timer);this.ws?.close();this.pointer?.close();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Врската е затворена.'));}this.pending.clear();}
}
async function wake(mac){const packet=magicPacket(mac);const destinations=new Set(['255.255.255.255']);for(const n of Object.values(os.networkInterfaces()).flat()){if(n.family==='IPv4'&&!n.internal&&localIP(n.address)){const a=n.address.split('.').map(Number),m=n.netmask.split('.').map(Number);destinations.add(a.map((v,i)=>(v|(~m[i]&255))).join('.'));}}await new Promise((resolve,reject)=>{const socket=dgram.createSocket('udp4');socket.on('error',e=>{socket.close();reject(e);});socket.bind(0,()=>{socket.setBroadcast(true);const sends=[...destinations].map(address=>new Promise((r,j)=>socket.send(packet,9,address,e=>e?j(e):r())));Promise.all(sends).then(()=>{socket.close();resolve();},e=>{socket.close();reject(e);});});});}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw Error('Преголемо барање.');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const host=`127.0.0.1:${port}`;
  if(req.headers.host!==host){res.writeHead(403).end();return;}
  const origin=req.headers.origin;
  if(origin&&origin!==`http://${host}`){res.writeHead(403).end();return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
    if(url.pathname==='/api/events'&&req.method==='GET'){
      if(url.searchParams.get('key')!==secret){json(403,{error:'Недозволен пристап.'});return;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(`data: ${JSON.stringify(state)}\n\n`);subscribers.add(res);req.on('close',()=>subscribers.delete(res));return;
    }
    if(url.pathname.startsWith('/api/')){
      if(req.headers['x-doma-key']!==secret){json(403,{error:'Недозволен пристап.'});return;}
      if(req.method==='GET'&&url.pathname==='/api/devices'){json(200,{devices:[...devices.values()]});return;}
      if(req.method!=='POST'){json(405,{error:'Недозволен метод.'});return;}
      const data=await body(req);
      if(url.pathname==='/api/scan'){if(!scanPromise)scanPromise=discover().finally(()=>{scanPromise=null;});json(200,{devices:await scanPromise});return;}
      if(url.pathname==='/api/connect'){
        if(!localIP(data.ip))throw Error('Внеси локална IPv4-адреса, пример 192.168.1.50.');
        const device=devices.get(data.ip)||{ip:data.ip,brand:data.brand,name:`${data.brand} TV`,model:''};
        if(!['LG','Samsung','Philips','Other'].includes(device.brand))throw Error('Избери марка.');
        if(controller&&!controller.closed&&['connecting','pairing'].includes(state.status))throw Error('Поврзувањето е во тек. Почекај или прекини го.');
        controller?.close();controller=new Controller(device);devices.set(device.ip,device);update({status:'connecting',message:'Се поврзува…',device});
        const active=controller;active.connect().catch(e=>{if(controller===active&&!active.closed){active.status('error',e.message);active.close();}});json(200,{ok:true});return;
      }
      if(url.pathname==='/api/disconnect'){controller?.close();controller=null;update({status:'idle',message:'Врската е затворена.',device:null});json(200,{ok:true});return;}
      if(url.pathname==='/api/command'){if(!controller)throw Error('Прво избери телевизор.');json(200,{message:await controller.command(data.command)});return;}
      if(url.pathname==='/api/hdmi'){if(!controller?.ready||controller.device.brand!=='LG')throw Error('Овие HDMI копчиња се за LG.');if(![1,2,3,4].includes(data.input))throw Error('Невалиден HDMI.');await controller.lg('system.launcher/launch',{id:`com.webos.app.hdmi${data.input}`});json(200,{message:'HDMI командата е прифатена.'});return;}
      if(url.pathname==='/api/wake'){if(!localIP(data.ip))throw Error('Избери телевизор или внеси IP-адреса.');await wake(data.mac);saved[data.ip]={...saved[data.ip],mac:data.mac};await persist();json(200,{message:'Испратен е сигнал за будење. Почекај, па поврзи се. Палењето зависи од поставките на телевизорот.'});return;}
      json(404,{error:'Непознато барање.'});return;
    }
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
    if(!files[url.pathname]){res.writeHead(404).end();return;}
    let content=await fs.readFile(path.join(root,'public',files[url.pathname]),'utf8');if(url.pathname==='/')content=content.replace('__SESSION_KEY__',secret);
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(content);
  }catch(e){json(400,{error:e.message});}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Апликацијата веќе работи: http://127.0.0.1:${port}`:e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Doma TV: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{controller?.close();for(const res of subscribers)res.end();server.close(()=>process.exit());});
