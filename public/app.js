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
  for(const d of devices){
    const card=document.createElement('div');card.className='device'+(selected?.ip===d.ip?' selected':'');
    const button=document.createElement('button');button.className='device-connect';button.title='Поврзи се';
    const title=document.createElement('strong');title.textContent=d.name;
    const detail=document.createElement('span');detail.textContent=[d.brand,d.model].filter(Boolean).join(' · ');
    const ip=document.createElement('span');ip.textContent='IP: '+d.ip;
    const mac=document.createElement('span');mac.className='device-mac';mac.textContent='MAC: '+(d.mac||'Не е позната');
    const status=document.createElement('span');status.className='device-tag';status.textContent=d.saved?'✓ Зачуван':'Пронајден · незачуван';
    button.append(title,detail,ip,mac,status);button.onclick=()=>connect(d);
    const edit=document.createElement('button');edit.className='device-edit';edit.textContent=d.saved?'Измени':'＋ Зачувај';edit.onclick=()=>editDevice(d);
    card.append(button,edit);$('devices').append(card);
  }
}
function editDevice(d){$('device-editor').open=true;$('device-name').value=d.name||'';$('ip').value=d.ip;$('brand').value=d.brand;$('device-mac').value=d.mac||'';$('device-name').focus();}
function refreshSelected(){if(!selected)return;const latest=devices.find(d=>d.ip===selected.ip);if(latest){selected=latest;$('mac').value=latest.mac||'';if(current.device?.ip===latest.ip)$('tv-detail').textContent=[latest.brand,latest.model,latest.ip,'MAC: '+(latest.mac||'Не е позната')].filter(Boolean).join(' · ');}}
async function connect(device){selected=device;$('ip').value=device.ip;if(['LG','Samsung','Philips'].includes(device.brand))$('brand').value=device.brand;$('mac').value=device.mac||'';render();try{await api('connect',device);}catch(e){notice(e.message,true);}}
$('scan').onclick=async()=>{const button=$('scan');button.disabled=true;button.textContent='Се пребарува…';$('scan-note').textContent='Се бараат телевизори на домашната мрежа…';try{const result=await api('scan',{});devices=result.devices;refreshSelected();render();const found=devices.filter(d=>d.discovered).length;$('scan-note').textContent=found?`Пронајдени уреди: ${found}. Зачуваните телевизори остануваат во листата.`:'Нема нови резултати. Зачуваните телевизори остануваат. Провери дали TV е вклучен и на истата мрежа.';}catch(e){$('scan-note').textContent=e.message;}finally{button.disabled=false;button.textContent='⌕ Скенирај мрежа';}};
$('device-editor').querySelector('summary').onclick=()=>{if(!$('device-editor').open){$('manual').reset();}};
$('manual').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const result=await api('save',{ip:$('ip').value.trim(),brand:$('brand').value,name:$('device-name').value.trim(),mac:$('device-mac').value.trim()});devices=result.devices;refreshSelected();render();$('device-editor').open=false;notice(result.message);}catch(error){notice(error.message,true);}finally{button.disabled=false;}};
$('disconnect').onclick=async()=>{try{await api('disconnect',{});}catch(e){notice(e.message,true);}};
let busy=false;
for(const button of document.querySelectorAll('[data-command],[data-hdmi]'))button.onclick=async()=>{
  if(busy)return;busy=true;button.disabled=true;
  try{const result=button.dataset.hdmi?await api('hdmi',{input:Number(button.dataset.hdmi)}):await api('command',{command:button.dataset.command});notice(result.message);}
  catch(e){notice(e.message,true);}finally{busy=false;controls();}
};
$('wake-form').onsubmit=async e=>{e.preventDefault();const button=$('wake');button.disabled=true;try{const result=await api('wake',{mac:$('mac').value.trim(),ip:selected?.ip||$('ip').value.trim()});notice(result.message);devices=(await api('devices')).devices;refreshSelected();render();}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
const events=new EventSource(`/api/events?key=${key}`);
events.onmessage=e=>{current=JSON.parse(e.data);if(current.device){selected=current.device;const index=devices.findIndex(d=>d.ip===selected.ip);if(index>=0)devices[index]={...devices[index],...selected};else devices.push(selected);$('tv-name').textContent=selected.name||`${selected.brand} TV`;$('tv-detail').textContent=[selected.brand,selected.model,selected.ip,'MAC: '+(selected.mac||'Не е позната')].filter(Boolean).join(' · ');$('mac').value=selected.mac||'';}else{$('tv-name').textContent='Избери телевизор';$('tv-detail').textContent='Скенирај ја мрежата или внеси IP-адреса.';}$('status').textContent=labels[current.status]||current.status;$('status').className='status '+current.status;$('disconnect').hidden=!current.device;notice(current.message,current.status==='error');controls();render();};
events.onerror=()=>{current.status='disconnected';$('status').textContent='Нема врска';$('status').className='status';controls();notice('Локалната апликација не одговара. Провери дали прозорецот за стартување е отворен.',true);};
controls();api('devices').then(result=>{devices=result.devices;render();}).catch(e=>notice(e.message,true));
