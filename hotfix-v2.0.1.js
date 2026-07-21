// Dither Printer β2.0.1 — ImageBitmap dimension hotfix
// ImageBitmap exposes width/height, while HTMLImageElement exposes naturalWidth/naturalHeight.
target=function(img){
  const sourceWidth=Number(img&&((img.naturalWidth||img.videoWidth||img.width)));
  const sourceHeight=Number(img&&((img.naturalHeight||img.videoHeight||img.height)));
  const requestedWidth=Number(controls&&controls.resolution&&controls.resolution.value);
  const width=Number.isFinite(requestedWidth)&&requestedWidth>0?Math.round(requestedWidth):576;
  if(!Number.isFinite(sourceWidth)||sourceWidth<=0||!Number.isFinite(sourceHeight)||sourceHeight<=0){
    throw new Error('Dimensions de l’image invalides');
  }
  const height=Math.max(1,Math.round(width*sourceHeight/sourceWidth));
  if(!Number.isFinite(height)||height<1)throw new Error('Dimensions de rendu invalides');
  return{width,height};
};
