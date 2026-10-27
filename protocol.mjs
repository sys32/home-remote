import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';

export function localIP(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
}
export function magicPacket(mac) {
  if (!/^([a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/i.test(mac)) throw Error('Внеси валидна MAC-адреса, пример AA:BB:CC:DD:EE:FF.');
  return Buffer.concat([Buffer.alloc(6,255), ...Array(16).fill(Buffer.from(mac.replace(/[:-]/g,''),'hex'))]);
}
export function frame(text, opcode=1) {
  const data=Buffer.from(text), mask=crypto.randomBytes(4);
  const head=Buffer.alloc(data.length<126?2:4);
  head[0]=0x80|opcode; head[1]=0x80|(data.length<126?data.length:126);
  if(data.length>=126) head.writeUInt16BE(data.length,2);
  const body=Buffer.from(data); for(let i=0;i<body.length;i++)body[i]^=mask[i%4];
  return Buffer.concat([head,mask,body]);
}
// Certificate exception is confined to this explicitly selected private TV address.
export class TVSocket extends EventEmitter {
  constructor(url) { super(); this.url=new URL(url); this.buffer=Buffer.alloc(0); this.fragments=[]; this.ready=false; }
  connect() {
    return new Promise((resolve,reject)=>{
      const secure=this.url.protocol==='wss:';
      const opts={host:this.url.hostname,port:Number(this.url.port),...(secure?{rejectUnauthorized:false}:{})};
      const socket=secure?tls.connect(opts):net.connect(opts); this.socket=socket;
      const key=crypto.randomBytes(16).toString('base64');
      const expected=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      const timeout=setTimeout(()=>{reject(Error('Телевизорот не одговори.'));socket.destroy();},7000);
      socket.once(secure?'secureConnect':'connect',()=>socket.write(`GET ${this.url.pathname}${this.url.search} HTTP/1.1\r\nHost: ${this.url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      socket.on('error',e=>{clearTimeout(timeout);reject(e);this.emit('fault',e);});
      socket.on('close',()=>{clearTimeout(timeout);reject(Error('Врската е затворена.'));this.ready=false;this.emit('closed');});
      socket.on('data',chunk=>{
        this.buffer=Buffer.concat([this.buffer,chunk]);
        if(this.buffer.length>2*1024*1024){socket.destroy();return;}
        if(!this.ready){
          const end=this.buffer.indexOf('\r\n\r\n'); if(end<0)return;
          const header=this.buffer.subarray(0,end).toString();
          if(!/^HTTP\/1\.[01] 101 /.test(header)||!header.toLowerCase().includes('sec-websocket-accept: '+expected.toLowerCase())){clearTimeout(timeout);reject(Error('Телевизорот го одби протоколот.'));socket.destroy();return;}
          this.buffer=this.buffer.subarray(end+4);this.ready=true;clearTimeout(timeout);resolve();
        }
        this.consume();
      });
    });
  }
  consume(){
    while(this.buffer.length>=2){
      const b=this.buffer,op=b[0]&15,fin=!!(b[0]&128),masked=!!(b[1]&128);let size=b[1]&127,offset=2;
      if(size===126){if(b.length<4)return;size=b.readUInt16BE(2);offset=4;}
      if(size===127){if(b.length<10)return;const n=b.readBigUInt64BE(2);if(n>1048576n){this.close();return;}size=Number(n);offset=10;}
      if(masked)offset+=4;if(b.length<offset+size)return;
      const data=Buffer.from(b.subarray(offset,offset+size));if(masked)for(let i=0;i<size;i++)data[i]^=b[offset-4+i%4];
      this.buffer=b.subarray(offset+size);
      if(op===8){this.close();return;}if(op===9){this.socket.write(frame(data,10));continue;}if(op===10)continue;
      if(op===1||op===0){this.fragments.push(data);if(this.fragments.reduce((n,x)=>n+x.length,0)>1048576){this.close();return;}if(fin){const text=Buffer.concat(this.fragments).toString();this.fragments=[];this.emit('message',text);}}
    }
  }
  send(value){if(!this.ready)throw Error('Нема активна врска.');this.socket.write(frame(typeof value==='string'?value:JSON.stringify(value)));}
  close(){this.ready=false;this.socket?.destroy();}
}
