const key=document.querySelector('meta[name="session-key"]').content;
const $=id=>document.getElementById(id);
let selected=null,current={status:'idle'},devices=[];
const labels={idle:'Неповрзан',connecting:'Поврзување…',pairing:'Одобри на TV',connected:'Поврзан',disconnected:'Прекината врска',error:'Потребна е проверка'};
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function api(route,data){const response=await fetch(`/api/${route}`,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Doma-Key':key},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error||'Неуспешно барање.');return result;}
function controls(){const ready=current.status==='connected';document.querySelectorAll('[data-command],[data-hdmi]').forEach(b=>b.disabled=!ready||(b.dataset.command==='source'&&current.device?.brand==='LG'));$('hdmi-card').hidden=current.device?.brand!=='LG';}
function render(){
  $('count').textContent=devices.length;$('devices').replaceChildren();
  if(!devices.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Нема пронајден телевизор. Провери ја мрежата или внеси IP-адреса.';$('devices').append(empty);}
  for(const d of devices){const button=document.createElement('button');button.className='device'+(selected?.ip===d.ip?' selected':'');const title=document.createElement('strong');title.textContent=d.name;const detail=document.createElement('span');detail.textContent=`${d.brand} · ${d.model||d.ip}`;button.append(title,detail);button.onclick=()=>connect(d);$('devices').append(button);}
}
async function connect(device){selected=device;$('ip').value=device.ip;if(['LG','Samsung','Philips'].includes(device.brand))$('brand').value=device.brand;$('mac').value=device.mac||'';render();try{await api('connect',device);}catch(e){notice(e.message,true);}}
$('scan').onclick=async()=>{const button=$('scan');button.disabled=true;button.textContent='Се пребарува…';$('scan-note').textContent='Се бараат телевизори на домашната мрежа…';try{const result=await api('scan',{});devices=result.devices;render();$('scan-note').textContent=devices.length?`Пронајдени уреди: ${devices.length}. Избери телевизор.`:'Нема резултати. Вклучи го TV, провери дали е на истата мрежа и дозволи локална мрежа во macOS.';}catch(e){$('scan-note').textContent=e.message;}finally{button.disabled=false;button.textContent='⌕ Скенирај мрежа';}};
$('manual').onsubmit=e=>{e.preventDefault();connect({ip:$('ip').value.trim(),brand:$('brand').value});};
$('disconnect').onclick=async()=>{try{await api('disconnect',{});}catch(e){notice(e.message,true);}};
let busy=false;
for(const button of document.querySelectorAll('[data-command],[data-hdmi]'))button.onclick=async()=>{
  if(busy)return;busy=true;button.disabled=true;
  try{const result=button.dataset.hdmi?await api('hdmi',{input:Number(button.dataset.hdmi)}):await api('command',{command:button.dataset.command});notice(result.message);}
  catch(e){notice(e.message,true);}finally{busy=false;controls();}
};
$('wake-form').onsubmit=async e=>{e.preventDefault();const button=$('wake');button.disabled=true;try{const result=await api('wake',{mac:$('mac').value.trim(),ip:selected?.ip||$('ip').value.trim()});notice(result.message);}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
const events=new EventSource(`/api/events?key=${key}`);
events.onmessage=e=>{current=JSON.parse(e.data);if(current.device){selected=current.device;$('tv-name').textContent=selected.name||`${selected.brand} TV`;$('tv-detail').textContent=[selected.brand,selected.model,selected.ip].filter(Boolean).join(' · ');if(selected.mac&&!$('mac').value)$('mac').value=selected.mac;}else{$('tv-name').textContent='Избери телевизор';$('tv-detail').textContent='Скенирај ја мрежата или внеси IP-адреса.';}$('status').textContent=labels[current.status]||current.status;$('status').className='status '+current.status;$('disconnect').hidden=!current.device;notice(current.message,current.status==='error');controls();render();};
events.onerror=()=>{current.status='disconnected';$('status').textContent='Нема врска';$('status').className='status';controls();notice('Локалната апликација не одговара. Провери дали прозорецот за стартување е отворен.',true);};
controls();api('devices').then(result=>{devices=result.devices;render();}).catch(e=>notice(e.message,true));
