import {localIP} from './protocol.mjs';

export function normalizeDevice(input, previous={}) {
  if(!localIP(input.ip))throw Error('Внеси локална IPv4-адреса, пример 192.168.1.50.');
  if(!['LG','Samsung','Philips','Other'].includes(input.brand))throw Error('Избери марка.');
  const name=String(input.name||`${input.brand} TV`).trim();
  if(!name||name.length>80)throw Error('Името треба да има од 1 до 80 знаци.');
  const raw=String(input.mac??previous.mac??'').trim();
  if(raw&&!/^([a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/i.test(raw))throw Error('Внеси валидна MAC-адреса, пример AA:BB:CC:DD:EE:FF.');
  return {ip:input.ip,name,brand:input.brand,model:String(input.model??previous.model??'').slice(0,120),mac:raw.replace(/-/g,':').toUpperCase(),saved:true};
}
export function publicDevice(ip, data) {
  return {ip,name:data.name||`${data.brand} TV`,brand:data.brand,model:data.model||'',mac:data.mac||'',saved:true};
}
