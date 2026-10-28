const key=document.querySelector('meta[name="session-key"]').content;
const $=id=>document.getElementById(id);
const compact=new URLSearchParams(location.search).get('compact')==='1';
if(compact)document.body.classList.add('compact');
$('full-window').hidden=!compact;
let selected=null,current={status:'idle',sleep:null},devices=[],busy=false,onlyFavorites=false,toastTimer;
const labels={idle:'Неповрзан',connecting:'Поврзување…',pairing:'Одобри на TV',connected:'Поврзан',disconnected:'Прекината врска',error:'Провери ја врската'};
const storage={get(name,fallback=''){try{return localStorage.getItem('doma.'+name)??fallback;}catch{return fallback;}},set(name,value){try{localStorage.setItem('doma.'+name,value);}catch{}}};
document.body.classList.toggle('light',storage.get('theme')==='light');
$('shortcuts-enabled').checked=storage.get('shortcuts','on')==='on';
function notice(message,error=false){$('toast').textContent=message;$('toast').hidden=false;$('toast').classList.toggle('error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?9500:6500);}
async function api(route,data){const response=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Doma-Key':key},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error||'Неуспешно барање.');return result;}
function setView(view){for(const name of ['remote','devices','settings'])$('view-'+name).hidden=name!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('page-label').textContent={remote:'ДАЛЕЧИНСКО',devices:'ТЕЛЕВИЗОРИ',settings:'ПОСТАВКИ'}[view];if(!compact)window.scrollTo({top:0,behavior:'instant'});}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>setView(button.dataset.view);
function theme(){document.body.classList.toggle('light');storage.set('theme',document.body.classList.contains('light')?'light':'dark');}
$('theme').onclick=theme;$('settings-theme').onclick=theme;$('shortcuts-enabled').onchange=()=>storage.set('shortcuts',$('shortcuts-enabled').checked?'on':'off');
function controls(){const ready=current.status==='connected'&&current.device?.ip===selected?.ip;document.querySelectorAll('[data-command],[data-hdmi],[data-app],[data-minutes],#channel-send').forEach(b=>b.disabled=!ready||busy||(b.dataset.command==='source'&&selected?.brand==='LG')||((b.dataset.hdmi||b.dataset.app)&&selected?.brand!=='LG'));$('wake-quick').disabled=!selected?.mac||busy;$('disconnect').hidden=!current.device;$('connect-current').hidden=!selected||ready||['connecting','pairing'].includes(current.status);$('quick-device').disabled=['connecting','pairing'].includes(current.status);}
function displaySelected(){
  $('tv-name').textContent=selected?.name||'Избери го твојот екран';
  $('tv-detail').textContent=selected?[selected.brand,selected.room,selected.ip,'MAC: '+(selected.mac||'Не е позната')].filter(Boolean).join(' · '):'Скенирај ја мрежата или додај телевизор.';
  $('tv-monogram').textContent=selected?.brand==='Other'?'TV':selected?.brand?.toUpperCase()||'TV';
  $('status').textContent=labels[current.status]||current.status;$('status').className='pill '+current.status;
  $('quick-device').value=selected?.ip||'';controls();
}
function cardFor(d){
  const card=document.createElement('article');card.className='device'+(selected?.ip===d.ip?' selected':'');
  const button=document.createElement('button');button.className='device-connect';button.title='Поврзи се';
  const title=document.createElement('strong');title.textContent=d.name;
  const detail=document.createElement('span');detail.textContent=[d.brand,d.room,d.model].filter(Boolean).join(' · ');
  const ip=document.createElement('span');ip.textContent='IP: '+d.ip;
  const mac=document.createElement('span');mac.className='device-mac';mac.textContent='MAC: '+(d.mac||'Не е позната');
  const tag=document.createElement('span');tag.className='device-tag';tag.textContent=d.saved?'✓ ЗАЧУВАН':'ПРОНАЈДЕН · НЕЗАЧУВАН';
  button.append(title,detail,ip,mac,tag);button.onclick=()=>{setView('remote');connect(d);};
  const actions=document.createElement('div');actions.className='device-actions';
  const edit=document.createElement('button');edit.className='device-edit';edit.textContent=d.saved?'Измени телевизор':'＋ Зачувај';edit.onclick=()=>editDevice(d);
  const favorite=document.createElement('button');favorite.className='favorite-button'+(d.favorite?' favorited':'');favorite.textContent=d.favorite?'★':'☆';favorite.setAttribute('aria-label',d.favorite?'Отстрани од омилени':'Додај во омилени');favorite.onclick=async()=>{favorite.disabled=true;try{const result=await api('save',{...d,favorite:!d.favorite});receiveDevices(result.devices);}catch(error){notice(error.message,true);}finally{favorite.disabled=false;}};
  actions.append(edit,favorite);card.append(button,actions);return card;
}
function render(){
  $('device-count').textContent=devices.length;
  const sorted=[...devices].sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||(a.room||'').localeCompare(b.room||'')||a.name.localeCompare(b.name));
  for(const [id,list] of [['devices',sorted],['device-grid',sorted.filter(d=>!onlyFavorites||d.favorite)]]){
    $(id).replaceChildren();if(!list.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=onlyFavorites&&id==='device-grid'?'Нема омилени. Означи телевизор со ☆.':'Додај телевизор или скенирај ја домашната мрежа.';$(id).append(empty);}else for(const d of list)$(id).append(cardFor(d));
  }
  $('quick-device').replaceChildren(new Option('Избери телевизор',''));for(const d of sorted)$('quick-device').append(new Option((d.favorite?'★ ':'')+d.name+(d.room?' · '+d.room:''),d.ip));displaySelected();
}
function receiveDevices(list){devices=list;if(selected)selected=devices.find(d=>d.ip===selected.ip)||selected;else selected=devices.find(d=>d.ip===storage.get('selected'))||null;render();}
function editDevice(d=null){$('manual').reset();$('form-error').hidden=true;$('editor-title').textContent=d?.saved?'Измени телевизор':'Додај телевизор';if(d){$('device-name').value=d.name||'';$('ip').value=d.ip;$('brand').value=d.brand;$('device-mac').value=d.mac||'';$('device-room').value=d.room||'';$('device-favorite').checked=!!d.favorite;}$('device-dialog').showModal();$('device-name').focus();}
for(const button of document.querySelectorAll('[data-add]'))button.onclick=()=>editDevice();$('close-editor').onclick=()=>$('device-dialog').close();
$('manual').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('form-error').hidden=true;try{const result=await api('save',{ip:$('ip').value.trim(),brand:$('brand').value,name:$('device-name').value.trim(),mac:$('device-mac').value.trim(),room:$('device-room').value.trim(),favorite:$('device-favorite').checked});receiveDevices(result.devices);$('device-dialog').close();notice(result.message);}catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}finally{button.disabled=false;}};
async function connect(device){if(['connecting','pairing'].includes(current.status)){notice('Почекај го поврзувањето или прекини ја тековната врска.');return;}selected=device;storage.set('selected',device.ip);render();try{await api('connect',{ip:device.ip,brand:device.brand});}catch(error){notice(error.message,true);}}
$('quick-device').onchange=event=>{const device=devices.find(d=>d.ip===event.target.value);if(device)connect(device);};
$('connect-current').onclick=()=>{if(selected)connect(selected);};
async function scan(){for(const id of ['scan','scan-mobile'])$(id).disabled=true;$('scan-note').textContent='Се пребарува домашната мрежа…';try{const result=await api('scan',{});receiveDevices(result.devices);const found=devices.filter(d=>d.discovered).length;const message=found?'Пронајдени телевизори: '+found+'. Зачуваните остануваат во листата.':'Нема нови резултати. Зачуваните телевизори остануваат.';$('scan-note').textContent=message;notice(message);}catch(error){$('scan-note').textContent=error.message;notice(error.message,true);}finally{for(const id of ['scan','scan-mobile'])$(id).disabled=false;}}
$('scan').onclick=scan;$('scan-mobile').onclick=scan;
$('all-devices').onclick=()=>{onlyFavorites=false;$('all-devices').classList.add('active');$('favorite-devices').classList.remove('active');render();};
$('favorite-devices').onclick=()=>{onlyFavorites=true;$('favorite-devices').classList.add('active');$('all-devices').classList.remove('active');render();};
$('disconnect').onclick=async()=>{try{await api('disconnect',{});}catch(error){notice(error.message,true);}};
async function action(route,data){if(busy)return;busy=true;controls();try{const result=await api(route,data);notice(result.message||'Командата е испратена.');}catch(error){notice(error.message,true);}finally{busy=false;controls();}}
for(const button of document.querySelectorAll('[data-command]'))button.onclick=()=>action('command',{command:button.dataset.command});
for(const button of document.querySelectorAll('[data-hdmi]'))button.onclick=()=>action('hdmi',{input:Number(button.dataset.hdmi)});
for(const button of document.querySelectorAll('[data-app]'))button.onclick=()=>action('launch',{app:button.dataset.app});
for(const button of document.querySelectorAll('[data-minutes]'))button.onclick=()=>action('sleep',{minutes:Number(button.dataset.minutes)});
$('cancel-timer').onclick=()=>action('sleep',{minutes:0});
$('wake-quick').onclick=()=>{if(selected?.mac)action('wake',{ip:selected.ip,mac:selected.mac});};
$('channel-form').onsubmit=event=>{event.preventDefault();action('channel',{channel:$('channel-number').value.trim()});};
function timerDisplay(){const timer=current.sleep;$('cancel-timer').hidden=!timer;if(!timer){$('timer-state').textContent='Нема активен тајмер.';return;}const remaining=Math.max(0,Math.ceil((timer.endsAt-Date.now())/1000));$('timer-state').textContent=timer.name+' · '+Math.floor(remaining/60).toString().padStart(2,'0')+':'+(remaining%60).toString().padStart(2,'0')+' до гасење';}
setInterval(timerDisplay,1000);
const events=new EventSource('/api/events?key='+key);
events.onmessage=event=>{const previous=current;current=JSON.parse(event.data);if(current.device){selected=current.device;storage.set('selected',selected.ip);const index=devices.findIndex(d=>d.ip===selected.ip);if(index>=0)devices[index]={...devices[index],...selected};else devices.push(selected);}render();timerDisplay();if(current.status==='error'||current.status==='pairing'||current.message!==previous.message&&current.message?.startsWith('Тајмерот'))notice(current.message,current.status==='error');};
events.onerror=()=>{current.status='disconnected';displaySelected();notice('Нема врска со локалниот сервис. Провери дали Дома TV работи.',true);};
let lastKey=0;document.addEventListener('keydown',event=>{if(!$('shortcuts-enabled').checked||$('device-dialog').open||$('view-remote').hidden||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||event.metaKey||event.ctrlKey||event.altKey)return;const commands={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'ok',Backspace:'back',Home:'home','+':'volumeUp','=':'volumeUp','-':'volumeDown',m:'mute'};const command=commands[event.key];if(!command||current.status!=='connected')return;event.preventDefault();if(Date.now()-lastKey<160)return;lastKey=Date.now();action('command',{command});});
$('full-window').onclick=()=>{if(window.webkit?.messageHandlers?.doma)window.webkit.messageHandlers.doma.postMessage({action:'openWindow'});};
render();api('devices').then(result=>receiveDevices(result.devices)).catch(error=>notice(error.message,true));
