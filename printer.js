(() => {
  const canvas = document.querySelector('#previewCanvas');
  const ipInput = document.querySelector('#printerIp');
  const printBtn = document.querySelector('#printBtn');
  const status = document.querySelector('#printerStatus');

  if (!canvas || !ipInput || !printBtn || !status) return;

  const storageKey = 'ditherPrinter.starIp';
  ipInput.value = localStorage.getItem(storageKey) || '';

  function normalizedIp() {
    return ipInput.value.trim().replace(/,/g, '.');
  }

  function saveIp() {
    const value = normalizedIp();
    if (ipInput.value !== value) ipInput.value = value;
    localStorage.setItem(storageKey, value);
  }

  function isReady() {
    return canvas.width > 0 && canvas.height > 0 && normalizedIp().length > 0;
  }

  function updateButton() {
    printBtn.disabled = !isReady();
    if (!normalizedIp()) status.textContent = 'Non configurée';
    else if (status.dataset.busy !== 'true' && !status.dataset.result) status.textContent = 'Prête';
  }

  ipInput.addEventListener('input', () => {
    saveIp();
    delete status.dataset.result;
    updateButton();
  });
  ipInput.addEventListener('change', saveIp);
  ipInput.addEventListener('blur', saveIp);

  const canvasObserver = new MutationObserver(() => {
    delete status.dataset.result;
    updateButton();
  });
  canvasObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });

  function fitForPrinter(source, maxWidth = 576, maxHeight = 2200) {
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
        if (data[pixel] < 128) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
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
    return [
      '<StarWebPrint>',
      '<initialization/>',
      '<alignment position="center"/>',
      '<text width="2" height="2">DITHER PRINTER TEST\n</text>',
      '<text>Connexion webPRNT OK\n\n</text>',
      `<bitImage x="${printCanvas.width}" y="${printCanvas.height}">${raster}</bitImage>`,
      '<feed line="2"/>',
      '<cutpaper feed="true" type="partial"/>',
      '</StarWebPrint>'
    ].join('');
  }

  function parsePrinterResponse(text) {
    const outerXml = new DOMParser().parseFromString(text, 'application/xml');
    const responseNode = outerXml.querySelector('Response');
    const innerText = responseNode?.textContent?.trim();
    const xml = innerText
      ? new DOMParser().parseFromString(innerText, 'application/xml')
      : outerXml;

    const successText = xml.querySelector('success')?.textContent?.trim().toLowerCase();
    const traderSuccess = outerXml.documentElement?.getAttribute('TraderSuccess')?.toLowerCase();
    const code = xml.querySelector('code')?.textContent?.trim()
      || outerXml.documentElement?.getAttribute('TraderCode')
      || '';
    const printerStatus = xml.querySelector('status')?.textContent?.trim()
      || outerXml.documentElement?.getAttribute('Status')
      || '';
    const success = successText === 'true' || traderSuccess === 'true';
    return { success, code, printerStatus };
  }

  async function sendWebPrnt(ip, request) {
    const host = ip.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const endpoint = `https://${host}/StarWebPRNT/SendMessage`;
    const body = new URLSearchParams();
    body.set('Request', request);
    body.set('CheckedBlock', 'true');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
        signal: controller.signal
      });

      const text = await response.text();
      const contentType = response.headers.get('content-type') || 'inconnu';
      if (!response.ok) throw new Error(`HTTP ${response.status} — ${text.slice(0, 220)}`);

      const result = parsePrinterResponse(text);
      if (!result.success) {
        const preview = text.replace(/\s+/g, ' ').trim().slice(0, 260) || '(réponse vide)';
        throw new Error(`Réponse inattendue [${contentType}] : ${preview}`);
      }
      if (result.code && result.code !== '0') {
        throw new Error(`webPRNT code ${result.code}${result.printerStatus ? ` — ${result.printerStatus}` : ''}`);
      }
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  printBtn.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!isReady()) return;
    saveIp();
    delete status.dataset.result;
    status.dataset.busy = 'true';
    status.textContent = 'Envoi…';
    printBtn.disabled = true;

    try {
      const printCanvas = fitForPrinter(canvas);
      const request = buildRequest(printCanvas);
      await sendWebPrnt(normalizedIp(), request);
      status.textContent = 'Imprimé ✓';
      status.dataset.result = 'success';
    } catch (error) {
      console.error('Erreur webPRNT:', error);
      const message = error?.name === 'AbortError'
        ? 'Délai dépassé : aucune réponse de l’imprimante.'
        : `Échec webPRNT : ${error?.message || 'erreur inconnue'}`;
      status.textContent = 'Échec';
      status.dataset.result = 'error';
      alert(message);
    } finally {
      status.dataset.busy = 'false';
      printBtn.disabled = !isReady();
    }
  });

  updateButton();
})();