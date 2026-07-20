(() => {
  const canvas = document.querySelector('#previewCanvas');
  const ipInput = document.querySelector('#printerIp');
  const printBtn = document.querySelector('#printBtn');
  const testBtn = document.querySelector('#testPrinterBtn');
  const status = document.querySelector('#printerStatus');
  const debugPanel = document.querySelector('#printerDebug');
  const debugHttp = document.querySelector('#debugHttp');
  const debugSuccess = document.querySelector('#debugSuccess');
  const debugCode = document.querySelector('#debugCode');
  const debugStatus = document.querySelector('#debugStatus');
  const debugRaw = document.querySelector('#debugRaw');

  if (!canvas || !ipInput || !printBtn || !testBtn || !status) return;

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

  function hasIp() {
    return normalizedIp().length > 0;
  }

  function hasImage() {
    return canvas.width > 0 && canvas.height > 0;
  }

  function updateButtons() {
    const busy = status.dataset.busy === 'true';
    testBtn.disabled = !hasIp() || busy;
    printBtn.disabled = !hasIp() || !hasImage() || busy;
    if (!hasIp()) status.textContent = 'Non configurée';
    else if (!busy && !status.dataset.result) status.textContent = 'Prête';
  }

  function resetResult() {
    delete status.dataset.result;
    updateButtons();
  }

  ipInput.addEventListener('input', () => {
    saveIp();
    resetResult();
  });
  ipInput.addEventListener('change', saveIp);
  ipInput.addEventListener('blur', saveIp);

  new MutationObserver(resetResult).observe(canvas, {
    attributes: true,
    attributeFilter: ['width', 'height']
  });

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

  function buildTestRequest() {
    const timestamp = new Date().toLocaleString('fr-FR');
    return [
      '<StarWebPrint>',
      '<initialization/>',
      '<alignment position="center"/>',
      '<text width="2" height="2">DITHER PRINTER\n</text>',
      '<text>TEST WEBPRNT OK\n</text>',
      `<text>${timestamp}\n</text>`,
      '<feed line="2"/>',
      '<cutpaper feed="true" type="partial"/>',
      '</StarWebPrint>'
    ].join('');
  }

  function buildImageRequest(printCanvas) {
    const raster = canvasToRasterBase64(printCanvas);
    return [
      '<StarWebPrint>',
      '<initialization/>',
      '<alignment position="center"/>',
      `<bitImage x="${printCanvas.width}" y="${printCanvas.height}">${raster}</bitImage>`,
      '<feed line="2"/>',
      '<cutpaper feed="true" type="partial"/>',
      '</StarWebPrint>'
    ].join('');
  }

  function firstByLocalName(xml, name) {
    return xml.getElementsByTagNameNS('*', name)[0]
      || xml.getElementsByTagName(name)[0]
      || null;
  }

  function parsePrinterResponse(text) {
    const parser = new DOMParser();
    const outerXml = parser.parseFromString(text, 'application/xml');
    const responseNode = firstByLocalName(outerXml, 'Response');
    const innerText = responseNode?.textContent?.trim() || '';
    const innerXml = innerText ? parser.parseFromString(innerText, 'application/xml') : outerXml;

    const successText = firstByLocalName(innerXml, 'success')?.textContent?.trim().toLowerCase() || '';
    const code = firstByLocalName(innerXml, 'code')?.textContent?.trim()
      || outerXml.documentElement?.getAttribute('TraderCode')
      || '';
    const printerStatus = firstByLocalName(innerXml, 'status')?.textContent?.trim()
      || outerXml.documentElement?.getAttribute('Status')
      || '';
    const traderSuccess = outerXml.documentElement?.getAttribute('TraderSuccess')?.toLowerCase() || '';

    return {
      success: successText === 'true' || traderSuccess === 'true',
      code,
      printerStatus,
      innerText
    };
  }

  function showDebug({ httpStatus = '—', result = {}, raw = '' }) {
    if (!debugPanel) return;
    debugPanel.hidden = false;
    debugHttp.textContent = String(httpStatus);
    debugSuccess.textContent = result.success === true ? 'true' : result.success === false ? 'false' : '—';
    debugCode.textContent = result.code || '—';
    debugStatus.textContent = result.printerStatus || '—';
    debugRaw.textContent = result.innerText || raw || '(réponse vide)';
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
      const result = parsePrinterResponse(text);
      showDebug({ httpStatus: response.status, result, raw: text });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!result.success) throw new Error('Réponse webPRNT sans succès');
      if (result.code && result.code !== '0') throw new Error(`webPRNT code ${result.code}`);
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function runJob(request, pendingLabel) {
    saveIp();
    delete status.dataset.result;
    status.dataset.busy = 'true';
    status.textContent = pendingLabel;
    updateButtons();

    try {
      const result = await sendWebPrnt(normalizedIp(), request);
      status.textContent = result.success ? 'Succès ✓' : 'Échec';
      status.dataset.result = result.success ? 'success' : 'error';
    } catch (error) {
      console.error('Erreur webPRNT:', error);
      status.textContent = 'Échec';
      status.dataset.result = 'error';
      if (error?.name === 'AbortError') alert('Délai dépassé : aucune réponse de l’imprimante.');
    } finally {
      status.dataset.busy = 'false';
      updateButtons();
    }
  }

  testBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasIp()) return;
    runJob(buildTestRequest(), 'Test…');
  });

  printBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasIp() || !hasImage()) return;
    const printCanvas = fitForPrinter(canvas);
    runJob(buildImageRequest(printCanvas), 'Envoi…');
  });

  updateButtons();
})();