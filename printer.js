(() => {
  const canvas = document.querySelector('#previewCanvas');
  const ipInput = document.querySelector('#printerIp');
  const printBtn = document.querySelector('#printBtn');
  const status = document.querySelector('#printerStatus');

  if (!canvas || !ipInput || !printBtn || !status) return;

  ipInput.value = localStorage.getItem('ditherPrinter.starIp') || '';

  function isReady() {
    return canvas.width > 0 && canvas.height > 0 && ipInput.value.trim().length > 0;
  }

  function updateButton() {
    printBtn.disabled = !isReady();
    if (!ipInput.value.trim()) status.textContent = 'Non configurée';
    else if (status.dataset.busy !== 'true') status.textContent = 'Prête';
  }

  ipInput.addEventListener('input', () => {
    localStorage.setItem('ditherPrinter.starIp', ipInput.value.trim());
    updateButton();
  });

  const canvasObserver = new MutationObserver(updateButton);
  canvasObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  window.setInterval(updateButton, 800);

  function fitForPrinter(source, maxWidth = 576, maxHeight = 2400) {
    const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
    const width = Math.max(1, Math.floor(source.width * scale));
    const height = Math.max(1, Math.floor(source.height * scale));
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputCtx = output.getContext('2d', { willReadFrequently: true });
    outputCtx.fillStyle = '#fff';
    outputCtx.fillRect(0, 0, width, height);
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.drawImage(source, 0, 0, width, height);
    return output;
  }

  function canvasToRasterBase64(source) {
    const sourceCtx = source.getContext('2d', { willReadFrequently: true });
    const { data } = sourceCtx.getImageData(0, 0, source.width, source.height);
    const bytesPerRow = Math.ceil(source.width / 8);
    const bytes = new Uint8Array(bytesPerRow * source.height);

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const pixel = (y * source.width + x) * 4;
        const isBlack = data[pixel] < 128;
        if (isBlack) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function buildRequest(printCanvas) {
    const raster = canvasToRasterBase64(printCanvas);
    return `<root><initialization/><alignment position="center"/><bitimage width="${printCanvas.width}" height="${printCanvas.height}">${raster}</bitimage><feed line="2"/><cutpaper feed="true" type="partial"/></root>`;
  }

  async function sendWebPrnt(ip, request) {
    const host = ip.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const endpoint = `https://${host}/StarWebPRNT/SendMessage`;
    const body = new URLSearchParams({
      Request: request,
      CheckedBlock: 'true'
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString()
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/TraderSuccess=['"]?false/i.test(text) || /<success>false<\/success>/i.test(text)) {
      throw new Error('L’imprimante a refusé le travail');
    }
    return text;
  }

  printBtn.addEventListener('click', async () => {
    if (!isReady()) return;
    status.dataset.busy = 'true';
    status.textContent = 'Envoi…';
    printBtn.disabled = true;

    try {
      const printCanvas = fitForPrinter(canvas);
      const request = buildRequest(printCanvas);
      await sendWebPrnt(ipInput.value.trim(), request);
      status.textContent = 'Imprimé';
    } catch (error) {
      console.error(error);
      status.textContent = 'Connexion refusée';
      alert('Impossible de joindre la mC-Print3 en HTTPS. Vérifie son adresse IP et ouvre d’abord son adresse dans Safari pour accepter le certificat de l’imprimante.');
    } finally {
      status.dataset.busy = 'false';
      updateButton();
    }
  });

  updateButton();
})();