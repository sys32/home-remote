import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDevice,publicDevice} from '../devices.mjs';

test('saved TV fields are validated and normalized without exposing credentials',()=>{
  const d=normalizeDevice({ip:'192.168.1.50',name:'  Дневна  ',brand:'LG',mac:'ab-cd-ef-12-34-56'}, {clientKey:'secret',model:'webOS'});
  assert.equal(d.name,'Дневна');assert.equal(d.mac,'AB:CD:EF:12:34:56');assert.equal(d.model,'webOS');assert.equal(d.saved,true);assert.equal(d.clientKey,undefined);
  assert.equal(normalizeDevice({...d,mac:''}).mac,'');
  assert.throws(()=>normalizeDevice({...d,mac:'not-a-mac'}));
  assert.throws(()=>normalizeDevice({...d,ip:'8.8.8.8'}));
  assert.throws(()=>normalizeDevice({...d,brand:'invalid'}));
  const safe=publicDevice(d.ip,{...d,token:'secret',clientKey:'secret'});assert.equal(safe.token,undefined);assert.equal(safe.clientKey,undefined);
});
