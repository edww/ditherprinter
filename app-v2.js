const $=s=>document.querySelector(s);
const canvas=$('#previewCanvas');
const ctx=canvas.getContext('2d',{willReadFrequently:true});
const emptyState=$('#emptyState');
const downloadBtn=$('#downloadBtn');
const modeBadge=$('#modeBadge');
const sizeBadge=$('#sizeBadge');
const modeCount=$('#modeCount');
const controls={resolution:$('#resolutionRange'),threshold:$('#thresholdRange'),contrast:$('#contrastRange'),density:$('#densityRange'),strength:$('#strengthRange'),motion:$('#motionRange'),artContrast:$('#artContrastRange')};
const outputs=Object.fromEntries(Object.keys(controls).map(k=>[k,$(`#${k}Value`)]));
const modes=[...document.querySelectorAll('.mode-chip')];
const names=Object.fromEntries(modes.map(b=>[b.dataset.mode,b.textContent.toUpperCase()]));
const state={image:null,imageUrl:null,mode:'threshold',inverted:false,timer:null,language:localStorage.getItem('dp-language')||'fr'};
const b4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const kernels={floyd:[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],atkinson:[[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]]};
const clamp=(v,a=0,b=255)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):a;
const lum=(r,g,b)=>.2126*r+.7152*g+.0722*b;
function adjusted(r,g,b,c=+controls.contrast.value){const safe=clamp(c,-100,100),f=259*(safe+255)/(255*(259-safe));return clamp(f*(lum(r,g,b)-128)+128)}
function target(img){const w=clamp(Math.round(+controls.resolution.value),100,576),iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;if(!iw||!ih)throw new Error('Dimensions image invalides');return{width:w,height:Math.max(1,Math.round(w*ih/iw))}}
function forceBW(d){for(let i=0;i<d.length;i+=4){const v=d[i]<128?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}}
function invert(d){for(let i=0;i<d.length;i+=4)d[i]=d[i+1]=d[i+2]=d[i]===0?255:0}
function threshold(im){const t=+controls.threshold.value,d=im.data;for(let i=0;i<d.length;i+=4){const v=adjusted(d[i],d[i+1],d[i+2])<t?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}}
function diffusion(im,type){const{data,width:w,height:h}=im,a=new Float32Array(w*h),t=+controls.threshold.value;for(let i=0,p=0;i<data.length;i+=4,p++)a[p]=adjusted(data[i],data[i+1],data[i+2]);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,n=a[i]<t?0:255,e=a[i]-n;a[i]=n;kernels[type].forEach(([dx,dy,k])=>{const nx=x+dx,ny=y+dy;if(nx>=0&&nx<w&&ny<h)a[ny*w+nx]+=e*k})}for(let p=0,i=0;p<a.length;p++,i+=4)data[i]=data[i+1]=data[i+2]=a[p]<128?0:255}
function ordered(im,m){const{data,width:w}=im,n=m.length,t0=+controls.threshold.value;for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%w,y=(p/w)|0,t=t0+(((m[y%n][x%n]+.5)/(n*n))-.5)*180,v=adjusted(data[i],data[i+1],data[i+2])<t?0:255;data[i]=data[i+1]=data[i+2]=v}}
function hash(x,y){let n=(x*374761393+y*668265263)^(x*y*1274126177);n=(n^(n>>>13))*1274126177;return((n^(n>>>16))>>>0)/4294967295}
function gray(im){const a=new Float32Array(im.width*im.height),c=+controls.artContrast.value;for(let p=0,i=0;p<a.length;p++,i+=4)a[p]=adjusted(im.data[i],im.data[i+1],im.data[i+2],c)/255;return a}
const sample=(a,w,h,x,y)=>a[clamp(Math.round(y),0,h-1)*w+clamp(Math.round(x),0,w-1)];
function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const o=c.getContext('2d',{willReadFrequently:true});o.fillStyle='#fff';o.fillRect(0,0,w,h);o.strokeStyle='#000';o.fillStyle='#000';o.lineCap='round';o.lineJoin='round';return{c,o}}
function finish(c){const im=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);forceBW(im.data);return im}
function halftone(im){
  const w=im.width,h=im.height,g=gray(im),{c,o}=makeCanvas(w,h);
  const density=+controls.density.value/100,strength=+controls.strength.value/100,motion=+controls.motion.value/100;
  const spacing=18-density*13.5;
  const step=Math.max(2,spacing*.42);
  const maxThickness=spacing*(.38+strength*.58);
  for(let row=0,y=spacing*.5;y<h+spacing;y+=spacing,row++){
    const top=[],bottom=[];
    for(let x=-step;x<=w+step;x+=step){
      const wave=(Math.sin(x*.022+row*.73)+Math.sin(x*.008-row*.41)*.55)*spacing*.38*motion;
      const yy=y+wave;
      const dark=Math.pow(clamp(1-sample(g,w,h,x,yy),0,1),.72);
      const thickness=Math.max(0,dark*maxThickness-.22);
      top.push([x,yy-thickness*.5]);
      bottom.push([x,yy+thickness*.5]);
    }
    o.beginPath();
    o.moveTo(top[0][0],top[0][1]);
    for(let i=1;i<top.length;i++)o.lineTo(top[i][0],top[i][1]);
    for(let i=bottom.length-1;i>=0;i--)o.lineTo(bottom[i][0],bottom[i][1]);
    o.closePath();o.fill();
  }
  return finish(c)
}
function squiggle(im){const w=im.width,h=im.height,g=gray(im),{c,o}=makeCanvas(w,h),density=+controls.density.value,strength=+controls.strength.value/100,motion=+controls.motion.value/100,spacing=Math.max(4,26-density*.2),step=2;for(let row=0,y=spacing/2;y<h;y+=spacing,row++){o.beginPath();for(let x=0;x<=w;x+=step){const dark=1-sample(g,w,h,x,y),amp=dark*spacing*(.2+motion*1.05),yy=y+Math.sin(x*(.055+motion*.09)+row*.8)*amp;if(x===0)o.moveTo(x,yy);else o.lineTo(x,yy)}o.lineWidth=Math.max(.65,w/800*(.75+strength*2.2));o.stroke()}return finish(c)}
function hatch(im){const w=im.width,h=im.height,g=gray(im),{c,o}=makeCanvas(w,h),density=+controls.density.value,strength=+controls.strength.value/100,motion=+controls.motion.value/100,cell=Math.max(5,24-density*.17),len=cell*(1.1+strength*.8);o.lineWidth=Math.max(.55,w/1000*(1+strength*1.8));for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell){const dark=1-sample(g,w,h,x+cell/2,y+cell/2),cx=x+cell/2,cy=y+cell/2;if(dark>.18)line(cx,cy,len,Math.PI/4);if(dark>.42)line(cx,cy,len,-Math.PI/4);if(dark>.68&&motion>.25)line(cx,cy,len,0);if(dark>.84&&motion>.6)line(cx,cy,len,Math.PI/2)}function line(cx,cy,l,a){o.beginPath();o.moveTo(cx-Math.cos(a)*l/2,cy-Math.sin(a)*l/2);o.lineTo(cx+Math.cos(a)*l/2,cy+Math.sin(a)*l/2);o.stroke()}return finish(c)}
function ribbon(im){const w=im.width,h=im.height,g=gray(im),{c,o}=makeCanvas(w,h),density=+controls.density.value,strength=+controls.strength.value/100,motion=+controls.motion.value/100,spacing=Math.max(5,30-density*.22),step=3;for(let row=0,y=spacing/2;y<h;y+=spacing,row++){o.beginPath();for(let s=0;s<=w;s+=step){const x=row%2?w-s:s,dark=1-sample(g,w,h,x,y),drift=Math.sin(s*.018+row*1.7)*spacing*motion*.8+(dark-.5)*spacing*motion,yy=y+drift;if(s===0)o.moveTo(x,yy);else o.lineTo(x,yy)}o.lineWidth=Math.max(.8,spacing*(.08+strength*.28));o.stroke()}return finish(c)}
function worms(im){const w=im.width,h=im.height,g=gray(im),{c,o}=makeCanvas(w,h),density=+controls.density.value,strength=+controls.strength.value/100,motion=+controls.motion.value/100,count=Math.round(35+density*2.2),steps=Math.round(35+density*.9),stepLen=1.5+motion*2.2;o.lineWidth=Math.max(.55,w/1100*(1+strength*2.4));for(let n=0;n<count;n++){let x=hash(n,17)*w,y=hash(n,71)*h,a=hash(n,131)*Math.PI*2;o.beginPath();o.moveTo(x,y);for(let s=0;s<steps;s++){const dark=1-sample(g,w,h,x,y);if(dark<.12&&hash(n,s)>.12)break;const e=2,left=sample(g,w,h,x-e,y),right=sample(g,w,h,x+e,y),up=sample(g,w,h,x,y-e),down=sample(g,w,h,x,y+e),target=Math.atan2(up-down,left-right);a=a*(.82-motion*.18)+target*(.18+motion*.18)+(hash(n*97+s,43)-.5)*.75*motion;x+=Math.cos(a)*stepLen;y+=Math.sin(a)*stepLen;if(x<0||x>=w||y<0||y>=h)break;o.lineTo(x,y)}o.stroke()}return finish(c)}
const artModes=new Set(['halftone','squiggle','hatch','ribbon','worms']);
function render(){if(!state.image)return;try{const{width,height}=target(state.image);canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(state.image,0,0,width,height);let im=ctx.getImageData(0,0,width,height);switch(state.mode){case'floyd':case'atkinson':diffusion(im,state.mode);break;case'bayer':ordered(im,b4);break;case'halftone':im=halftone(im);break;case'squiggle':im=squiggle(im);break;case'hatch':im=hatch(im);break;case'ribbon':im=ribbon(im);break;case'worms':im=worms(im);break;default:threshold(im)}forceBW(im.data);if(state.inverted)invert(im.data);ctx.putImageData(im,0,0);emptyState.hidden=true;sizeBadge.textContent=`${width} × ${height}`;downloadBtn.disabled=false}catch(error){console.error('Render failed',error);emptyState.hidden=false;emptyState.querySelector('strong').textContent='Erreur de rendu';emptyState.querySelector('span').textContent=error.message}}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(render,45)}
async function load(file){if(!file)return;try{if(state.imageUrl)URL.revokeObjectURL(state.imageUrl);state.imageUrl=URL.createObjectURL(file);const img=new Image();img.decoding='async';await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Image illisible'));img.src=state.imageUrl});state.image=img;render()}catch(error){console.error(error);emptyState.hidden=false;emptyState.querySelector('strong').textContent='Photo non chargée';emptyState.querySelector('span').textContent='Essaie une autre photo.'}}
function labels(){Object.entries(controls).forEach(([k,c])=>{if(!c||!outputs[k])return;outputs[k].textContent=(k==='contrast'||k==='artContrast')&&+c.value>0?`+${c.value}`:c.value});modeBadge.textContent=names[state.mode]||state.mode.toUpperCase();modeCount.textContent=`${modes.findIndex(b=>b.dataset.mode===state.mode)+1} / ${modes.length}`}
function groups(){const art=artModes.has(state.mode);$('#basicControls').hidden=art;$('#artControls').hidden=!art}
const presets={halftone:[68,88,18,48,'Densité','Épaisseur','Courbure'],squiggle:[58,52,64,38,'Lignes','Trait','Amplitude'],hatch:[62,48,48,42,'Densité','Trait','Croisement'],ribbon:[55,42,55,40,'Rubans','Largeur','Déformation'],worms:[58,55,72,48,'Population','Trait','Agitation']};
function preset(mode){const p=presets[mode];if(!p)return;[controls.density.value,controls.strength.value,controls.motion.value,controls.artContrast.value]=p;$('#densityLabel').textContent=p[4];$('#strengthLabel').textContent=p[5];$('#motionLabel').textContent=p[6]}
['cameraInput','libraryInput'].forEach(id=>{const input=$(`#${id}`);input.addEventListener('change',e=>{load(e.target.files&&e.target.files[0]);e.target.value=''})});
modes.forEach(b=>b.addEventListener('click',()=>{clearTimeout(state.timer);state.mode=b.dataset.mode;modes.forEach(x=>x.classList.toggle('active',x===b));preset(state.mode);groups();labels();render()}));
Object.values(controls).forEach(c=>c&&c.addEventListener('input',()=>{labels();schedule()}));
$('#invertBtn').addEventListener('click',()=>{state.inverted=!state.inverted;render()});
$('#resetBtn').addEventListener('click',()=>location.reload());
downloadBtn.addEventListener('click',()=>canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=`dither-printer-${state.mode}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)},'image/png'));
const dialog=$('#settingsDialog');$('#settingsBtn').addEventListener('click',()=>dialog.showModal());$('#closeSettingsBtn').addEventListener('click',()=>dialog.close());$('#languageSelect').value=state.language;
function syncSettings(){const p=localStorage.getItem('dp-show-printer')!=='false',t=localStorage.getItem('dp-show-test')!=='false';$('#showPrinterToggle').checked=p;$('#showTestToggle').checked=t;$('#printerPanel').hidden=!p;$('#testPrinterBtn').hidden=!t}
$('#showPrinterToggle').addEventListener('change',e=>{localStorage.setItem('dp-show-printer',e.target.checked);syncSettings()});$('#showTestToggle').addEventListener('change',e=>{localStorage.setItem('dp-show-test',e.target.checked);syncSettings()});$('#languageSelect').addEventListener('change',e=>{state.language=e.target.value;localStorage.setItem('dp-language',state.language)});
syncSettings();labels();groups();
if('serviceWorker'in navigator)window.addEventListener('load',async()=>{const rs=await navigator.serviceWorker.getRegistrations();await Promise.all(rs.map(r=>r.unregister()));if('caches'in window)await Promise.all((await caches.keys()).map(k=>caches.delete(k)))});