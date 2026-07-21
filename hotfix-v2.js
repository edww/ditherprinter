// Hotfix iOS/ImageBitmap: ImageBitmap exposes width/height, not naturalWidth/naturalHeight.
// Loaded after app-v2.js so it replaces the original sizing helper before any photo is imported.
target=function(img){
  const sourceWidth=Number(img?.naturalWidth||img?.videoWidth||img?.width);
  const sourceHeight=Number(img?.naturalHeight||img?.videoHeight||img?.height);
  const requested=Number(controls?.resolution?.value);
  const width=Number.isFinite(requested)&&requested>0?Math.round(requested):576;
  if(!Number.isFinite(sourceWidth)||!Number.isFinite(sourceHeight)||sourceWidth<=0||sourceHeight<=0){
    throw new Error('Dimensions de l’image invalides');
  }
  const height=Math.max(1,Math.round(width*sourceHeight/sourceWidth));
  if(!Number.isFinite(height))throw new Error('Dimensions de rendu invalides');
  return{width,height};
};
