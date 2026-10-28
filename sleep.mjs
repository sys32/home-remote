export class SleepTimer {
  constructor(onChange, onFire, clock={now:()=>Date.now(),set:setTimeout,clear:clearTimeout}) {
    this.clock=clock;this.onChange=onChange;this.onFire=onFire;this.value=null;
  }
  schedule(minutes, device, action) {
    if(!Number.isInteger(minutes)||minutes<1||minutes>180)throw Error('Избери од 1 до 180 минути.');
    this.cancel();
    const value={ip:device.ip,name:device.name,endsAt:this.clock.now()+minutes*60000};this.value=value;
    this.handle=this.clock.set(async()=>{if(this.value!==value)return;this.value=null;this.onChange(null);try{await action();this.onFire(null,value);}catch(error){this.onFire(error,value);}},minutes*60000);
    this.onChange(value);return value;
  }
  cancel() {if(this.handle)this.clock.clear(this.handle);this.handle=null;if(this.value){this.value=null;this.onChange(null);}}
}
