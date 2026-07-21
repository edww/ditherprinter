const $=s=>document.querySelector(s);
const canvas=$('#previewCanvas');
const ctx=canvas.getContext('2d',{willReadFrequently:true});
const emptyState=$('#emptyState');
const downloadBtn=$('#downloadBtn');
const modeBadge=$('#modeBadge');
const sizeBadge=$('#sizeBadge');
const modeCount=$('#modeCount');
const controls={
  resolution:$('#resolutionRange'),threshold:$('#thresholdRange'),contrast:$('#contrastRange'),
  amount:$('#amountRange'),warp:$('#warpRange'),turb:$('#turbRange'),
  signalContrast:$('#signalContrastRange'),brightness:$('#brightnessRange')
};
const outputs=Object.fromEntries(Object.keys(controls).map(k=>[k,$(`#${k}Value`)]));
const modes=[...document.querySelectorAll('.mode-chip')];
const names=Object.fromEntries(modes.map(b=>[b.dataset.mode,b.textContent.toUpperCase()]));
const state={image:null,imageUrl:null,mode:'threshold',inverted:false,timer:null,language:localStorage.getItem('dp-language')||'fr'};
const b4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const b8=[[0,48,12,60,3,51,15,63],[32,16,44,28,35,19,47,31],[8,56,4,52,11,59,7,55],[40,24,36,20,43,27,39,23],[2,50,14,62,1,49,13,61],[34,18,46,30,33,17,45,29],[10,58,6,54,9,57,5,53],[42,26,38,22,41,25,37,21]];
const kernels={floyd:[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],atkinson:[[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]],stucki:[[1,0,8/42],[2,0,4/42],[-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],[-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42]],sierra:[[1,0,.5],[-1,1,.25],[0,1,.25]]};
const clamp=(v,a=0,b=255)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):a;
const lum=(r,g,b)=>.2126*r+.7152*g+.0722*b;
function adjusted(r,g,b,c=+controls.contrast.value,br=0){const safe=clamp(c,-100,100),f=259*(safe+255)/(255*(259-safe));return clamp(f*(lum(r,g,b)-128)+128+br)}
function target(img){const w=clamp(Math.round(+controls.resolution.value),100,576),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;if(!iw||!ih)throw new Error('Dimensions image invalides');return{width:w,height:Math.max(1,Math.round(w*ih/iw))}}
function forceBW(d){for(let i=0;i<d.length;i+=4){const v=d[i]<128?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}}
function invert(d){for(let i=0;i<d.length;i+=4)d[i]=d[i+1]=d[i+2]=d[i]===0?255:0}
function threshold(im){const t=+controls.threshold.value,d=im.data;for(let i=0;i<d.length;i+=4){const v=adjusted(d[i],d[i+1],d[i+2])<t?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}}
function diffusion(im,type){const{data,width:w,height:h}=im,a=new Float32Array(w*h),t=+controls.threshold.value;for(let i=0,p=0;i<data.length;i+=4,p++)a[p]=adjusted(data[i],data[i+1],data[i+2]);for(let y=0;y<h;y++){const rev=type==='riemersma'&&y%2;for(let s=0;s<w;s++){const x=rev?w-1-s:s,i=y*w+x,n=a[i]<t?0:255,e=a[i]-n;a[i]=n;(type==='riemersma'?kernels.floyd:kernels[type]).forEach(([dx,dy,k])=>{const nx=rev?x-dx:x+dx,ny=y+dy;if(nx>=0&&nx<w&&ny>=0&&ny<h)a[ny*w+nx]+=e*k})}}for(let p=0,i=0;p<a.length;p++,i+=4)data[i]=data[i+1]=data[i+2]=a[p]<128?0:255}
function ordered(im,m){const{data,width:w}=im,n=m.length,t0=+controls.threshold.value,span=n===8?90:180;for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%w,y=(p/w)|0,t=t0+(((m[y%n][x%n]+.5)/(n*n))-.5)*span,v=adjusted(data[i],data[i+1],data[i+2])<t?0:255;data[i]=data[i+1]=data[i+2]=v}}
function hash(x,y){let n=(x*374761393+y*668265263)^(x*y*1274126177);n=(n^(n>>>13))*1274126177;return((n^(n>>>16))>>>0)/4294967295}
function noisy(im,grain=false){const{data,width:w}=im,t=+controls.threshold.value;for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%w,y=(p/w)|0,n=grain?hash(x*3,y*3)*.65+hash(x+91,y+17)*.35:(hash(x,y)+hash(x+17,y+43)+hash(x+59,y+11))/3,v=adjusted(data[i],data[i+1],data[i+2])<t+(n-.5)*(grain?82:115)?0:255;data[i]=data[i+1]=data[i+2]=v}}
function gray(im){const a=new Float32Array(im.width*im.height),c=+controls.signalContrast.value,b=+controls.brightness.value;for(let p=0,i=0;p<a.length;p++,i+=4)a[p]=adjusted(im.data[i],im.data[i+1],im.data[i+2],c,b)/255;return a}
const sample=(a,w,h,x,y)=>a[clamp(Math.round(y),0,h-1)*w+clamp(Math.round(x),0,w-1)];
function paperCanvas(w,h){if(!window.paper)throw new Error('Paper.js non chargé');const c=document.createElement('canvas');c.width=w;c.height=h;const scope=new paper.PaperScope();scope.setup(c);new scope.Path.Rectangle({rectangle:scope.view.bounds,fillColor:'white'});return{c,scope}}
function paperFinish(c){const o=c.getContext('2d',{willReadFrequently:true}),im=o.getImageData(0,0,c.width,c.height);forceBW(im.data);return im}
function paperSpiral(im){
  const w=im.width,h=im.height,g=gray(im),{c,scope}=paperCanvas(w,h);
  const density=clamp(+controls.amount.value,12,160),force=clamp(+controls.warp.value,0,100)/100,thick=clamp(+controls.turb.value,0,100)/100;
  const cx=w/2,cy=h/2,maxR=Math.hypot(w,h)*.56,turnGap=Math.max(2.4,w/(density*1.1)),steps=Math.max(900,Math.round(maxR/turnGap*260));
  const path=new scope.Path({strokeColor:'black',strokeWidth:Math.max(.65,w/850*(.8+thick*2.2)),strokeCap:'round',strokeJoin:'round'});
  for(let i=0;i<=steps;i++){
    const t=i/steps,angle=t*(maxR/turnGap)*Math.PI*2,r=t*maxR;
    const x0=cx+Math.cos(angle)*r,y0=cy+Math.sin(angle)*r,tone=sample(g,w,h,x0,y0),dark=1-tone;
    const wobble=(dark-.5)*turnGap*1.8*force;
    const x=cx+Math.cos(angle)*(r+wobble),y=cy+Math.sin(angle)*(r+wobble);
    if(Number.isFinite(x)&&Number.isFinite(y))path.add(new scope.Point(x,y));
  }
  path.simplify(Math.max(.35,w/1400));
  scope.view.update();return paperFinish(c);
}
function paperMetaballs(im){
  const w=im.width,h=im.height,g=gray(im),{c,scope}=paperCanvas(w,h);
  const density=clamp(+controls.amount.value,8,120),force=clamp(+controls.warp.value,0,100)/100,thick=clamp(+controls.turb.value,0,100)/100;
  const cell=Math.max(7,w/(density*.72)),limit=900;let count=0;
  for(let y=cell/2;y<h&&count<limit;y+=cell)for(let x=cell/2;x<w&&count<limit;x+=cell){
    const tone=sample(g,w,h,x,y),dark=1-tone;if(dark<.18)continue;
    const chance=clamp((dark-.12)*(1.05+force*.9),0,1);if(hash(Math.round(x),Math.round(y))>chance)continue;
    const jitter=cell*.42*force,px=x+(hash(x+9,y)-.5)*jitter,py=y+(hash(x,y+11)-.5)*jitter;
    const radius=cell*(.16+dark*(.42+thick*.58));
    new scope.Path.Circle({center:[px,py],radius:Math.max(1,radius),fillColor:'black'});count++;
  }
  scope.view.update();return paperFinish(c);
}
function paperDivide(im){
  const w=im.width,h=im.height,g=gray(im),{c,scope}=paperCanvas(w,h);
  const density=clamp(+controls.amount.value,8,120),force=clamp(+controls.warp.value,0,100)/100,thick=clamp(+controls.turb.value,0,100)/100;
  const cell=Math.max(8,w/(density*.66));let row=0;
  for(let y=0;y<h;y+=cell,row++)for(let x=0;x<w;x+=cell){
    const tone=sample(g,w,h,x+cell/2,y+cell/2),dark=1-tone;if(dark<.1)continue;
    const inset=cell*(.08+(1-dark)*(.3-.18*thick)),jitter=cell*.22*force;
    const p1=new scope.Point(x+inset+(hash(x,y)-.5)*jitter,y+inset);
    const p2=new scope.Point(Math.min(w,x+cell-inset),y+inset+(hash(x+4,y)-.5)*jitter);
    const p3=new scope.Point(Math.min(w,x+cell-inset+(hash(x,y+8)-.5)*jitter),Math.min(h,y+cell-inset));
    const p4=new scope.Point(x+inset,Math.min(h,y+cell-inset+(hash(x+7,y+3)-.5)*jitter));
    const path=new scope.Path({segments:row%2?[p1,p2,p4]:[p1,p2,p3,p4],closed:true,fillColor:dark>.42?'black':null,strokeColor:'black',strokeWidth:Math.max(.6,w/1000*(.8+thick*2))});
    if(!path.fillColor&&dark>.2){const dot=new scope.Path.Circle({center:path.bounds.center,radius:Math.max(.8,cell*dark*.12),fillColor:'black'});dot.sendToBack()}
  }
  scope.view.update();return paperFinish(c);
}
const isPaper=()=>state.mode.startsWith('paper');
function render(){if(!state.image)return;try{const{width,height}=target(state.image);canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(state.image,0,0,width,height);let im=ctx.getImageData(0,0,width,height);switch(state.mode){case'floyd':case'atkinson':case'stucki':case'sierra':case'riemersma':diffusion(im,state.mode);break;case'bayer':ordered(im,b4);break;case'ordered8':ordered(im,b8);break;case'bluenoise':noisy(im);break;case'grain':noisy(im,true);break;case'paperSpiral':im=paperSpiral(im);break;case'paperMetaballs':im=paperMetaballs(im);break;case'paperDivide':im=paperDivide(im);break;default:threshold(im)}forceBW(im.data);if(state.inverted)invert(im.data);ctx.putImageData(im,0,0);emptyState.hidden=true;sizeBadge.textContent=`${width} × ${height}`;downloadBtn.disabled=false}catch(error){console.error('Render failed',error);emptyState.hidden=false;emptyState.querySelector('strong').textContent='Erreur de rendu';emptyState.querySelector('span').textContent=error.message}}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(render,70)}
async function load(file){if(!file)return;try{if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);state.imageUrl=URL.createObjectURL(file);const img=new Image();img.decoding='async';await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Image illisible'));img.src=state.imageUrl});state.image=img;render()}catch(error){console.error(error);emptyState.hidden=false;emptyState.querySelector('strong').textContent='Photo non chargée';emptyState.querySelector('span').textContent='Essaie une autre photo.'}}
function labels(){Object.entries(controls).forEach(([k,c])=>{if(!c||!outputs[k])return;outputs[k].textContent=(k==='contrast'||k==='signalContrast'||k==='brightness')&&+c.value>0?`+${c.value}`:c.value});modeBadge.textContent=names[state.mode]||state.mode.toUpperCase();modeCount.textContent=`${modes.findIndex(b=>b.dataset.mode===state.mode)+1} / ${modes.length}`}
function groups(){$('#basicControls').hidden=isPaper();$('#paperControls').hidden=!isPaper()}
function preset(mode){if(mode==='paperSpiral'){controls.amount.value=72;controls.warp.value=58;controls.turb.value=38;controls.signalContrast.value=42;controls.brightness.value=-4;$('#amountLabel').textContent='Tours';$('#warpLabel').textContent='Déformation';$('#turbLabel').textContent='Épaisseur'}else if(mode==='paperMetaballs'){controls.amount.value=68;controls.warp.value=52;controls.turb.value=62;controls.signalContrast.value=35;controls.brightness.value=-8;$('#amountLabel').textContent='Cellules';$('#warpLabel').textContent='Fusion';$('#turbLabel').textContent='Taille'}else if(mode==='paperDivide'){controls.amount.value=54;controls.warp.value=38;controls.turb.value=45;controls.signalContrast.value=45;controls.brightness.value=-5;$('#amountLabel').textContent='Divisions';$('#warpLabel').textContent='Irrégularité';$('#turbLabel').textContent='Trait'}}
['cameraInput','libraryInput'].forEach(id=>{const input=$(`#${id}`);input.addEventListener('change',e=>{load(e.target.files&&e.target.files[0]);e.target.value=''})});
modes.forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;modes.forEach(x=>x.classList.toggle('active',x===b));preset(state.mode);groups();labels();schedule()}));
Object.values(controls).forEach(c=>c&&c.addEventListener('input',()=>{labels();schedule()}));
$('#invertBtn').addEventListener('click',()=>{state.inverted=!state.inverted;schedule()});
$('#resetBtn').addEventListener('click',()=>location.reload());
downloadBtn.addEventListener('click',()=>canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=`dither-printer-${state.mode}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)},'image/png'));
const dialog=$('#settingsDialog');$('#settingsBtn').addEventListener('click',()=>dialog.showModal());$('#closeSettingsBtn').addEventListener('click',()=>dialog.close());$('#languageSelect').value=state.language;
function syncSettings(){const p=localStorage.getItem('dp-show-printer')!=='false',t=localStorage.getItem('dp-show-test')!=='false';$('#showPrinterToggle').checked=p;$('#showTestToggle').checked=t;$('#printerPanel').hidden=!p;$('#testPrinterBtn').hidden=!t}
$('#showPrinterToggle').addEventListener('change',e=>{localStorage.setItem('dp-show-printer',e.target.checked);syncSettings()});$('#showTestToggle').addEventListener('change',e=>{localStorage.setItem('dp-show-test',e.target.checked);syncSettings()});$('#languageSelect').addEventListener('change',e=>{state.language=e.target.value;localStorage.setItem('dp-language',state.language)});
syncSettings();labels();groups();
if('serviceWorker'in navigator)window.addEventListener('load',async()=>{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));if('caches'in window)await Promise.all((await caches.keys()).map(k=>caches.delete(k)))});