import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import {localIP,magicPacket,frame,TVSocket} from '../protocol.mjs';

test('only private IPv4 TV destinations are accepted',()=>{
  for(const ip of ['192.168.1.5','10.0.0.3','172.16.0.1','172.31.255.254','169.254.1.3'])assert.equal(localIP(ip),true,ip);
  for(const ip of ['127.0.0.1','8.8.8.8','192.168.1.5.evil.com','::1','172.32.1.3','0.0.0.0','255.255.255.255','localhost'])assert.equal(localIP(ip),false,ip);
});
test('Wake-on-LAN uses six sync bytes and sixteen exact MAC repetitions',()=>{
  const packet=magicPacket('AB:CD:EF:12:34:56');assert.equal(packet.length,102);assert.deepEqual(packet.subarray(0,6),Buffer.alloc(6,255));
  for(let n=0;n<16;n++)assert.equal(packet.subarray(6+n*6,12+n*6).toString('hex'),'abcdef123456');
  assert.throws(()=>magicPacket('192.168.1.2'));assert.throws(()=>magicPacket('xx:xx:xx:xx:xx:xx'));
});
test('WebSocket client frames are masked with correct short and long payloads',()=>{
  for(const text of ['hello','Ж'.repeat(160)]){const f=frame(text);assert.equal(f[0],0x81);assert.ok(f[1]&128);const extended=(f[1]&127)===126;const n=extended?f.readUInt16BE(2):f[1]&127;const offset=extended?4:2;const decoded=Buffer.from(f.subarray(offset+4));for(let i=0;i<n;i++)decoded[i]^=f[offset+i%4];assert.equal(decoded.toString(),text);}
});
test('WebSocket accepts valid upgrade, reassembles fragments, and replies to ping',async()=>{
  let incoming=Buffer.alloc(0),pingReply;
  const server=net.createServer(socket=>{let upgraded=false;socket.on('data',chunk=>{
    if(upgraded){pingReply=chunk;return;}
    incoming=Buffer.concat([incoming,chunk]);if(!incoming.includes('\r\n\r\n'))return;
    const key=incoming.toString().match(/Sec-WebSocket-Key: (.+)\r\n/)[1];const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');upgraded=true;
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.from([0x01,2,0x68,0x65,0x80,3,0x6c,0x6c,0x6f,0x89,1,0x78]));
  });});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const ws=new TVSocket(`ws://127.0.0.1:${server.address().port}/remote`);
  const message=new Promise(r=>ws.once('message',r));try{await ws.connect();assert.equal(await message,'hello');await new Promise(r=>setTimeout(r,20));assert.equal(pingReply[0],0x8a);}finally{ws.close();await new Promise(r=>server.close(r));}
});
test('WebSocket rejects forged upgrade accept',async()=>{
  const server=net.createServer(socket=>socket.once('data',()=>socket.end('HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: wrong\r\n\r\n')));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const ws=new TVSocket(`ws://127.0.0.1:${server.address().port}/`);try{await assert.rejects(ws.connect(),/одби/);}finally{ws.close();await new Promise(r=>server.close(r));}
});
