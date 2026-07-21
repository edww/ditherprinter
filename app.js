const canvas = document.querySelector('#previewCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const emptyState = document.querySelector('#emptyState');
const downloadBtn = document.querySelector('#downloadBtn');
const modeBadge = document.querySelector('#modeBadge');
const sizeBadge = document.querySelector('#sizeBadge');
const modeCount = document.querySelector('#modeCount');

const controls = {
  threshold: document.querySelector('#thresholdRange'),
  contrast: document.querySelector('#contrastRange'),
  resolution: document.querySelector('#resolutionRange')
};

const outputs = {
  threshold: document.querySelector('#thresholdValue'),
  contrast: document.querySelector('#contrastValue'),
  resolution: document.querySelector('#resolutionValue')
};

const state = { image: null, mode: 'threshold', inverted: false, renderTimer: null };

const modeNames = {
  threshold: 'SEUIL', floyd: 'FLOYD–STEINBERG', atkinson: 'ATKINSON',
  stucki: 'STUCKI', sierra: 'SIERRA LITE', bayer: 'BAYER 4×4',
  ordered8: 'ORDERED 8×8', bluenoise: 'BLUE NOISE', riemersma: 'RIEMERSMA',
  halftone: 'TRAME', noise: 'GRAIN', signalfield: 'SIGNAL FIELD'
};

const bayer4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const bayer8 = [
  [0,48,12,60,3,51,15,63],[32,16,44,28,35,19,47,31],
  [8,56,4,52,11,59,7,55],[40,24,36,20,43,27,39,23],
  [2,50,14,62,1,49,13,61],[34,18,46,30,33,17,45,29],
  [10,58,6,54,9,57,5,53],[42,26,38,22,41,25,37,21]
];

function clamp(v, min = 0, max = 255) { return Math.max(min, Math.min(max, v)); }
function luminance(r,g,b) { return 0.2126*r + 0.7152*g + 0.0722*b; }
function adjustedGray(r,g,b) {
  const c = Number(controls.contrast.value);
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  return clamp(factor * (luminance(r,g,b) - 128) + 128);
}
function getTargetSize(image) {
  const width = Number(controls.resolution.value);
  return { width, height: Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth)) };
}
function forcePureBlackWhite(data, threshold = 128) {
  for (let i=0;i<data.length;i+=4) {
    const v = data[i] < threshold ? 0 : 255;
    data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}
function applyThreshold(data, threshold) {
  for (let i=0;i<data.length;i+=4) {
    const v = adjustedGray(data[i],data[i+1],data[i+2]) < threshold ? 0 : 255;
    data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}

const kernels = {
  floyd: [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]],
  atkinson: [[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]],
  stucki: [[1,0,8/42],[2,0,4/42],[-2,1,2/42],[-1,1,4/42],[0,1,8/42],[1,1,4/42],[2,1,2/42],[-2,2,1/42],[-1,2,2/42],[0,2,4/42],[1,2,2/42],[2,2,1/42]],
  sierra: [[1,0,2/4],[-1,1,1/4],[0,1,1/4]]
};

function applyErrorDiffusion(imageData, type) {
  const {data,width,height} = imageData;
  const gray = new Float32Array(width*height);
  const threshold = Number(controls.threshold.value);
  for (let i=0,p=0;i<data.length;i+=4,p++) gray[p]=adjustedGray(data[i],data[i+1],data[i+2]);
  const kernel = kernels[type];
  for (let y=0;y<height;y++) {
    const reverse = (type === 'riemersma') && (y % 2 === 1);
    for (let step=0;step<width;step++) {
      const x = reverse ? width-1-step : step;
      const idx = y*width+x;
      const old = gray[idx];
      const next = old < threshold ? 0 : 255;
      const err = old-next;
      gray[idx]=next;
      const active = type === 'riemersma' ? kernels.floyd : kernel;
      active.forEach(([dx,dy,w]) => {
        const nx = reverse ? x-dx : x+dx;
        const ny = y+dy;
        if (nx>=0 && nx<width && ny>=0 && ny<height) gray[ny*width+nx]+=err*w;
      });
    }
  }
  for (let p=0,i=0;p<gray.length;p++,i+=4) {
    const v=gray[p]<128?0:255; data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}

function applyOrdered(imageData, matrix) {
  const {data,width}=imageData;
  const n=matrix.length;
  const base=Number(controls.threshold.value);
  const span = n===8 ? 90 : 180;
  for (let i=0,p=0;i<data.length;i+=4,p++) {
    const x=p%width, y=Math.floor(p/width);
    const normalized=(matrix[y%n][x%n]+0.5)/(n*n)-0.5;
    const t=base+normalized*span;
    const v=adjustedGray(data[i],data[i+1],data[i+2])<t?0:255;
    data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}

function hashNoise(x,y) {
  let n=(x*374761393 + y*668265263) ^ (x*y*1274126177);
  n=(n^(n>>>13))*1274126177; return ((n^(n>>>16))>>>0)/4294967295;
}
function applyBlueNoise(imageData) {
  const {data,width}=imageData;
  const base=Number(controls.threshold.value);
  for (let i=0,p=0;i<data.length;i+=4,p++) {
    const x=p%width,y=Math.floor(p/width);
    const n=(hashNoise(x,y)+hashNoise(x+17,y+43)+hashNoise(x+59,y+11))/3;
    const t=base+(n-0.5)*115;
    const v=adjustedGray(data[i],data[i+1],data[i+2])<t?0:255;
    data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}

function applyNoise(imageData) {
  const {data}=imageData, base=Number(controls.threshold.value);
  for (let i=0;i<data.length;i+=4) {
    const v=adjustedGray(data[i],data[i+1],data[i+2]) < base+(Math.random()-.5)*105 ? 0:255;
    data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
  }
}

function applyHalftone(source) {
  const {width,height,data}=source;
  const temp=document.createElement('canvas'); temp.width=width; temp.height=height;
  const t=temp.getContext('2d',{willReadFrequently:true});
  t.fillStyle='#fff'; t.fillRect(0,0,width,height); t.fillStyle='#000';
  const cell=Math.max(4,Math.round(width/100));
  for(let y=0;y<height;y+=cell) for(let x=0;x<width;x+=cell){
    let total=0,count=0;
    for(let yy=y;yy<Math.min(y+cell,height);yy+=2) for(let xx=x;xx<Math.min(x+cell,width);xx+=2){
      const i=(yy*width+xx)*4; total+=adjustedGray(data[i],data[i+1],data[i+2]); count++;
    }
    const radius=Math.sqrt(1-total/(Math.max(1,count)*255))*cell*.72;
    if(radius>.25){t.beginPath();t.arc(x+cell/2,y+cell/2,radius,0,Math.PI*2);t.fill();}
  }
  const result=t.getImageData(0,0,width,height); forcePureBlackWhite(result.data); return result;
}

function applySignalField(source) {
  const {width,height,data}=source;
  const out=document.createElement('canvas'); out.width=width; out.height=height;
  const o=out.getContext('2d',{willReadFrequently:true});
  o.fillStyle='#000'; o.fillRect(0,0,width,height); o.strokeStyle='#fff'; o.lineWidth=Math.max(1,width/420);
  const spacing=Math.max(4,Math.round(width/58));
  const sample=(x,y)=>{
    const sx=Math.max(0,Math.min(width-1,Math.round(x))), sy=Math.max(0,Math.min(height-1,Math.round(y)));
    const i=(sy*width+sx)*4; return adjustedGray(data[i],data[i+1],data[i+2]);
  };
  for(let start=0;start<width+height;start+=spacing){
    let x=start<width?start:0, y=start<width?0:start-width;
    o.beginPath(); o.moveTo(x,y);
    for(let s=0;s<width+height;s+=2){
      const gx=sample(x+2,y)-sample(x-2,y), gy=sample(x,y+2)-sample(x,y-2);
      const dark=1-sample(x,y)/255;
      const angle=Math.atan2(gy,gx)+Math.PI/2;
      x+=Math.cos(angle)*1.7 + Math.sin(y*.08)*dark*.8;
      y+=Math.sin(angle)*1.7 + 1.05;
      if(x<0||x>=width||y<0||y>=height) break;
      o.lineTo(x,y);
    }
    o.stroke();
  }
  return o.getImageData(0,0,width,height);
}

function invertPixels(data){for(let i=0;i<data.length;i+=4)data[i]=data[i+1]=data[i+2]=data[i]===0?255:0;}

function render(){
  if(!state.image)return;
  const {width,height}=getTargetSize(state.image);
  canvas.width=width; canvas.height=height;
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,width,height); ctx.drawImage(state.image,0,0,width,height);
  let imageData=ctx.getImageData(0,0,width,height);
  const threshold=Number(controls.threshold.value);
  switch(state.mode){
    case 'floyd': case 'atkinson': case 'stucki': case 'sierra': case 'riemersma': applyErrorDiffusion(imageData,state.mode); break;
    case 'bayer': applyOrdered(imageData,bayer4); break;
    case 'ordered8': applyOrdered(imageData,bayer8); break;
    case 'bluenoise': applyBlueNoise(imageData); break;
    case 'halftone': imageData=applyHalftone(imageData); break;
    case 'noise': applyNoise(imageData); break;
    case 'signalfield': imageData=applySignalField(imageData); break;
    default: applyThreshold(imageData.data,threshold);
  }
  forcePureBlackWhite(imageData.data);
  if(state.inverted)invertPixels(imageData.data);
  ctx.putImageData(imageData,0,0);
  sizeBadge.textContent=`${width} × ${height}`; downloadBtn.disabled=false;
}
function scheduleRender(){clearTimeout(state.renderTimer);state.renderTimer=setTimeout(render,35);}
function loadFile(file){
  if(!file||!file.type.startsWith('image/'))return;
  const url=URL.createObjectURL(file), image=new Image();
  image.onload=()=>{if(state.image?.src?.startsWith('blob:'))URL.revokeObjectURL(state.image.src);state.image=image;emptyState.hidden=true;render();};
  image.onerror=()=>URL.revokeObjectURL(url); image.src=url;
}
function reset(){
  state.image=null;state.mode='threshold';state.inverted=false;
  controls.threshold.value=128;controls.contrast.value=12;controls.resolution.value=576;
  ctx.clearRect(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;emptyState.hidden=false;downloadBtn.disabled=true;sizeBadge.textContent='— × —';
  document.querySelectorAll('.mode-chip').forEach((chip,index)=>chip.classList.toggle('active',index===0));updateLabels();
}
function updateLabels(){
  outputs.threshold.textContent=controls.threshold.value;
  const c=Number(controls.contrast.value);outputs.contrast.textContent=c>0?`+${c}`:String(c);
  outputs.resolution.textContent=controls.resolution.value;modeBadge.textContent=modeNames[state.mode];
  const chips=[...document.querySelectorAll('.mode-chip')];modeCount.textContent=`${chips.findIndex(chip=>chip.dataset.mode===state.mode)+1} / ${chips.length}`;
}
['cameraInput','libraryInput'].forEach(id=>document.querySelector(`#${id}`).addEventListener('change',e=>{loadFile(e.target.files?.[0]);e.target.value='';}));
document.querySelectorAll('.mode-chip').forEach(chip=>chip.addEventListener('click',()=>{state.mode=chip.dataset.mode;document.querySelectorAll('.mode-chip').forEach(item=>item.classList.toggle('active',item===chip));updateLabels();scheduleRender();}));
Object.values(controls).forEach(input=>input.addEventListener('input',()=>{updateLabels();scheduleRender();}));
document.querySelector('#invertBtn').addEventListener('click',()=>{state.inverted=!state.inverted;scheduleRender();});
document.querySelector('#resetBtn').addEventListener('click',reset);
downloadBtn.addEventListener('click',e=>{e.preventDefault();if(!state.image)return;canvas.toBlob(blob=>{if(!blob)return;const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=`dither-printer-${state.mode}.png`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);},'image/png');});
updateLabels();
if('serviceWorker'in navigator){window.addEventListener('load',async()=>{const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()));if('caches'in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}});}
