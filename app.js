const canvas=document.querySelector('#previewCanvas');
const ctx=canvas.getContext('2d',{willReadFrequently:true});
const emptyState=document.querySelector('#emptyState');
const downloadBtn=document.querySelector('#downloadBtn');
const modeBadge=document.querySelector('#modeBadge');
const sizeBadge=document.querySelector('#sizeBadge');
const modeCount=document.querySelector('#modeCount');
const basicControls=document.querySelector('#basicControls');
const signalControls=document.querySelector('#signalControls');

const ids=['threshold','contrast','resolution','amount','density','flow','warp','turb','bias','signalContrast','brightness'];
const controls=Object.fromEntries(ids.map(id=>[id,document.querySelector(`#${id}Range`)]));
const outputs=Object.fromEntries(ids.map(id=>[id,document.querySelector(`#${id}Value`)]));

const state={image:null,mode:'threshold',inverted:false,renderTimer:null};
const modeNames={threshold:'SEUIL',floyd:'FLOYD–STEINBERG',atkinson:'ATKINSON',stucki:'STUCKI',sierra:'SIERRA LITE',bayer:'BAYER 4×4',ordered8:'ORDERED 8×8',bluenoise:'BLUE NOISE',riemersma:'RIEMERSMA',grain:'GRAIN',signal1:'SIGNAL 1',signal2:'SIGNAL 2',signal3:'SIGNAL 3',signal4:'SIGNAL 4'};
const signalPresets={
 signal1:{amount:88,density:4.2,flow:62,warp:34,turb:18,bias:0,signalContrast:28,brightness:0},
 signal2:{amount:118,density:3.1,flow:78,warp:18,turb:7,bias:-12,signalContrast:38,brightness:-6},
 signal3:{amount:64,density:5.8,flow:48,warp:62,turb:34,bias:18,signalContrast:18,brightness:8},
 signal4:{amount:142,density:2.4,flow:88,warp:42,turb:52,bias:-28,signalContrast:44,brightness:-14}
};
const bayer4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const bayer8=[[0,48,12,60,3,51,15,63],[32,16,44,28,35,19,47,31],[8,56,4,52,11,59,7,55],[40,24,36,20,43,27,39,23],[2,50,14,62,1,49,13,61],[34,18,46,30,33,17,45,29],[10,58,6,54,9,57,5,53],[42,26,38,22,41,25,37,21]];
const kernels={floyd:[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],atkinson:[[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]],stucki:[[1,0,8/42],[2,0,4/42],[-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],[-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42]],sierra:[[1,0,.5],[-1,1,.25],[0,1,.25]]};

function clamp(v,min=0,max=255){return Math.max(min,Math.min(max,v));}
function luminance(r,g,b){return .2126*r+.7152*g+.0722*b;}
function adjustedGray(r,g,b,contrast=Number(controls.contrast.value),brightness=0){const f=(259*(contrast+255))/(255*(259-contrast));return clamp(f*(luminance(r,g,b)-128)+128+brightness);}
function getTargetSize(image){const width=Number(controls.resolution.value);return{width,height:Math.max(1,Math.round(width*image.naturalHeight/image.naturalWidth))};}
function forceBW(data){for(let i=0;i<data.length;i+=4){const v=data[i]<128?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}
function applyThreshold(data){const t=Number(controls.threshold.value);for(let i=0;i<data.length;i+=4){const v=adjustedGray(data[i],data[i+1],data[i+2])<t?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}
function applyDiffusion(imageData,type){const{data,width,height}=imageData,gray=new Float32Array(width*height),t=Number(controls.threshold.value);for(let i=0,p=0;i<data.length;i+=4,p++)gray[p]=adjustedGray(data[i],data[i+1],data[i+2]);for(let y=0;y<height;y++){const reverse=type==='riemersma'&&y%2;for(let s=0;s<width;s++){const x=reverse?width-1-s:s,idx=y*width+x,old=gray[idx],next=old<t?0:255,err=old-next;gray[idx]=next;(type==='riemersma'?kernels.floyd:kernels[type]).forEach(([dx,dy,w])=>{const nx=reverse?x-dx:x+dx,ny=y+dy;if(nx>=0&&nx<width&&ny>=0&&ny<height)gray[ny*width+nx]+=err*w;});}}for(let p=0,i=0;p<gray.length;p++,i+=4){const v=gray[p]<128?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}
function applyOrdered(imageData,matrix){const{data,width}=imageData,n=matrix.length,base=Number(controls.threshold.value),span=n===8?90:180;for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%width,y=Math.floor(p/width),t=base+(((matrix[y%n][x%n]+.5)/(n*n))-.5)*span,v=adjustedGray(data[i],data[i+1],data[i+2])<t?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}
function hashNoise(x,y){let n=(x*374761393+y*668265263)^(x*y*1274126177);n=(n^(n>>>13))*1274126177;return((n^(n>>>16))>>>0)/4294967295;}
function applyBlueNoise(imageData){const{data,width}=imageData,base=Number(controls.threshold.value);for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%width,y=Math.floor(p/width),n=(hashNoise(x,y)+hashNoise(x+17,y+43)+hashNoise(x+59,y+11))/3,t=base+(n-.5)*115,v=adjustedGray(data[i],data[i+1],data[i+2])<t?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}
function applyGrain(imageData){const{data,width}=imageData,base=Number(controls.threshold.value);for(let i=0,p=0;i<data.length;i+=4,p++){const x=p%width,y=Math.floor(p/width),n=(hashNoise(x*3,y*3)*.65+hashNoise(x+91,y+17)*.35)-.5,v=adjustedGray(data[i],data[i+1],data[i+2])<base+n*82?0:255;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}}

function applySignalField(source){
 const{width,height,data}=source;
 const out=document.createElement('canvas');out.width=width;out.height=height;
 const o=out.getContext('2d',{willReadFrequently:true});o.fillStyle='#000';o.fillRect(0,0,width,height);o.strokeStyle='#fff';o.lineCap='round';
 const amount=Number(controls.amount.value),density=Number(controls.density.value),flow=Number(controls.flow.value)/100,warp=Number(controls.warp.value)/100,turb=Number(controls.turb.value)/100,bias=Number(controls.bias.value)*Math.PI/180,contrast=Number(controls.signalContrast.value),brightness=Number(controls.brightness.value);
 const spacing=Math.max(2,height/amount*density/4),step=Math.max(1,width/360),lineWidth=Math.max(1,width/(520-density*24));o.lineWidth=lineWidth;
 const sample=(x,y)=>{const sx=Math.max(0,Math.min(width-1,Math.round(x))),sy=Math.max(0,Math.min(height-1,Math.round(y))),i=(sy*width+sx)*4;return adjustedGray(data[i],data[i+1],data[i+2],contrast,brightness);};
 for(let start=-height;start<width+height;start+=spacing){let x=start,y=0;o.beginPath();let started=false;for(let n=0;n<(width+height)*1.8;n+=step){const gx=sample(x+2,y)-sample(x-2,y),gy=sample(x,y+2)-sample(x,y-2),dark=1-sample(x,y)/255,edge=Math.min(1,Math.hypot(gx,gy)/90),field=Math.atan2(gy,gx)+Math.PI/2,noise=(hashNoise(Math.floor(x/7),Math.floor(y/7))-.5)*Math.PI*turb;const base=.72+bias;const angle=base*(1-flow)+field*flow+noise;const wave=Math.sin((x+y)*.035+density)*warp*(2+dark*5);x+=Math.cos(angle)*step+wave;y+=Math.sin(angle)*step+1.05+dark*warp*1.8;if(x>=0&&x<width&&y>=0&&y<height){if(!started){o.moveTo(x,y);started=true;}else o.lineTo(x,y);}else if(started)break;if(edge>.7&&dark<.18&&turb<.35)y+=spacing*.4;}if(started)o.stroke();}
 const result=o.getImageData(0,0,width,height);forceBW(result.data);return result;
}

function invertPixels(data){for(let i=0;i<data.length;i+=4)data[i]=data[i+1]=data[i+2]=data[i]===0?255:0;}
function isSignal(){return state.mode.startsWith('signal');}
function applyPreset(mode){const preset=signalPresets[mode];if(!preset)return;Object.entries(preset).forEach(([key,value])=>controls[key].value=value);updateLabels();}
function render(){if(!state.image)return;const{width,height}=getTargetSize(state.image);canvas.width=width;canvas.height=height;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(state.image,0,0,width,height);let imageData=ctx.getImageData(0,0,width,height);switch(state.mode){case'floyd':case'atkinson':case'stucki':case'sierra':case'riemersma':applyDiffusion(imageData,state.mode);break;case'bayer':applyOrdered(imageData,bayer4);break;case'ordered8':applyOrdered(imageData,bayer8);break;case'bluenoise':applyBlueNoise(imageData);break;case'grain':applyGrain(imageData);break;case'signal1':case'signal2':case'signal3':case'signal4':imageData=applySignalField(imageData);break;default:applyThreshold(imageData.data);}forceBW(imageData.data);if(state.inverted)invertPixels(imageData.data);ctx.putImageData(imageData,0,0);sizeBadge.textContent=`${width} × ${height}`;downloadBtn.disabled=false;}
function scheduleRender(){clearTimeout(state.renderTimer);state.renderTimer=setTimeout(render,45);}
function loadFile(file){if(!file||!file.type.startsWith('image/'))return;const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{if(state.image?.src?.startsWith('blob:'))URL.revokeObjectURL(state.image.src);state.image=image;emptyState.hidden=true;render();};image.onerror=()=>URL.revokeObjectURL(url);image.src=url;}
function reset(){state.image=null;state.mode='threshold';state.inverted=false;controls.threshold.value=128;controls.contrast.value=12;controls.resolution.value=576;ctx.clearRect(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;emptyState.hidden=false;downloadBtn.disabled=true;sizeBadge.textContent='— × —';document.querySelectorAll('.mode-chip').forEach((chip,index)=>chip.classList.toggle('active',index===0));syncControlGroups();updateLabels();}
function signed(v){const n=Number(v);return n>0?`+${n}`:String(n);}
function updateLabels(){outputs.threshold.textContent=controls.threshold.value;outputs.contrast.textContent=signed(controls.contrast.value);outputs.resolution.textContent=controls.resolution.value;['amount','density','flow','warp','turb','bias','brightness'].forEach(k=>outputs[k].textContent=controls[k].value);outputs.signalContrast.textContent=signed(controls.signalContrast.value);modeBadge.textContent=modeNames[state.mode];const chips=[...document.querySelectorAll('.mode-chip')];modeCount.textContent=`${chips.findIndex(chip=>chip.dataset.mode===state.mode)+1} / ${chips.length}`;}
function syncControlGroups(){basicControls.hidden=isSignal();signalControls.hidden=!isSignal();}
['cameraInput','libraryInput'].forEach(id=>document.querySelector(`#${id}`).addEventListener('change',e=>{loadFile(e.target.files?.[0]);e.target.value='';}));
document.querySelectorAll('.mode-chip').forEach(chip=>chip.addEventListener('click',()=>{state.mode=chip.dataset.mode;document.querySelectorAll('.mode-chip').forEach(item=>item.classList.toggle('active',item===chip));if(isSignal())applyPreset(state.mode);syncControlGroups();updateLabels();scheduleRender();}));
Object.values(controls).forEach(input=>input.addEventListener('input',()=>{updateLabels();scheduleRender();}));
document.querySelector('#invertBtn').addEventListener('click',()=>{state.inverted=!state.inverted;scheduleRender();});
document.querySelector('#resetBtn').addEventListener('click',reset);
downloadBtn.addEventListener('click',e=>{e.preventDefault();if(!state.image)return;canvas.toBlob(blob=>{if(!blob)return;const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=`dither-printer-${state.mode}.png`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);},'image/png');});
updateLabels();syncControlGroups();
if('serviceWorker'in navigator)window.addEventListener('load',async()=>{const registrations=await navigator.serviceWorker.getRegistrations();await Promise.all(registrations.map(r=>r.unregister()));if('caches'in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}});