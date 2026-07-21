(()=>{
  const $=s=>document.querySelector(s);
  const sync=()=>{
    const active=$('.mode-chip.active');
    const mode=active?.dataset.mode||'threshold';
    const field=mode==='fieldMono';
    const ascii=mode==='asciiClassic'||mode==='asciiCustom';
    $('#fieldControls').hidden=!(field||ascii);
    $('#asciiControls').hidden=!ascii;
    $('#warpRow').hidden=!field;
    $('#turbRow').hidden=!field;
    $('#amountLabel').textContent=ascii?'Taille':'Lignes';
    $('#customTextWrap').hidden=mode!=='asciiCustom';
  };
  document.querySelectorAll('.mode-chip').forEach(button=>button.addEventListener('click',()=>setTimeout(sync,0)));
  sync();
})();