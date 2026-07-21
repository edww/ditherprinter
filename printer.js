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

  const normalizedIp = () => ipInput.value.trim().replace(/,/g, '.');
  const hasIp = () => normalizedIp().length > 0;
  const hasImage = () => canvas.width > 0 && canvas.height > 0;

  function saveIp() {
    const value = normalizedIp();
    ipInput.value = value;
    localStorage.setItem(storageKey, value);
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

  ipInput.addEventListener('input', () => { saveIp(); resetResult(); });
  ipInput.addEventListener('change', saveIp);
  ipInput.addEventListener('blur', saveIp);
  new MutationObserver(resetResult).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });

  function fitForPrinter(source, maxWidth = 576, maxHeight = 2200) {
    const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.floor(source.width * scale));
    output.height = Math.max(1, Math.floor(source.height * scale));
    const ctx = output.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, output.width, output.height);
    return output;
  }

  function canvasToRasterBase64(source) {
    const { data } = source.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, source.width, source.height);
    const bytesPerRow = Math.ceil(source.width / 8);
    const bytes = new Uint8Array(bytesPerRow * source.height);
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const pixel = (y * source.width + x) * 4;
        if (data[pixel] < 128) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // Sortie exacte du StarWebPrintBuilder officiel : les caractères de contrôle
  // sont encodés en séquences littérales \xNN dans les éléments <text>.
  function buildTestElements() {
    return [
      '<initialization/>',
      '<alignment position="center"/>',
      '<text emphasis="true" width="2" height="2">TEST PRINTER\\x0a</text>',
      '<text>WEBPRNT TEXT OK\\x0a\\x0a</text>',
      '<cutpaper feed="true" type="partial"/>'
    ].join('');
  }

  function buildImageElements(printCanvas) {
    const raster = canvasToRasterBase64(printCanvas);
    return [
      '<initialization/>',
      '<alignment position="center"/>',
      `<bitimage width="${printCanvas.width}" height="${printCanvas.height}">${raster}</bitimage>`,
      '<cutpaper feed="true" type="partial"/>'
    ].join('');
  }

  function escapeTraderXml(value) {
    return value.replace(/[<>&]/g, char => char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;');
  }

  // Reproduction stricte de StarWebPrintTrader.js v1.2.0.
  function buildTraderBody(elements) {
    const request = `<root>${elements}</root>`;
    return '<StarWebPrint xmlns="http://www.star-m.jp" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">'
      + `<Request>${escapeTraderXml(request)}</Request>`
      + '</StarWebPrint>';
  }

  function firstByLocalName(xml, name) {
    return xml.getElementsByTagNameNS('*', name)[0] || xml.getElementsByTagName(name)[0] || null;
  }

  function parsePrinterResponse(text) {
    const parser = new DOMParser();
    const outerXml = parser.parseFromString(text, 'application/xml');
    const responseNode = firstByLocalName(outerXml, 'Response');
    const innerText = responseNode?.textContent?.trim() || '';
    const innerXml = innerText ? parser.parseFromString(innerText, 'application/xml') : outerXml;
    const successText = firstByLocalName(innerXml, 'success')?.textContent?.trim().toLowerCase() || '';
    const code = firstByLocalName(innerXml, 'code')?.textContent?.trim() || '';
    const printerStatus = firstByLocalName(innerXml, 'status')?.textContent?.trim() || '';
    return { success: successText === 'true', code, printerStatus, innerText };
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

  async function sendWebPrnt(ip, elements) {
    const host = ip.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const endpoint = `https://${host}/StarWebPRNT/SendMessage`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
        body: buildTraderBody(elements),
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
      window.clearTimeout(timer);
    }
  }

  async function runJob(elements, pendingLabel) {
    saveIp();
    delete status.dataset.result;
    status.dataset.busy = 'true';
    status.textContent = pendingLabel;
    updateButtons();
    try {
      const result = await sendWebPrnt(normalizedIp(), elements);
      status.textContent = result.success ? 'Succès ✓' : 'Échec';
      status.dataset.result = result.success ? 'success' : 'error';
    } catch (error) {
      console.error('Erreur webPRNT:', error);
      status.textContent = 'Échec';
      status.dataset.result = 'error';
      alert(error?.name === 'AbortError'
        ? 'Délai dépassé : aucune réponse de l’imprimante.'
        : `Échec webPRNT : ${error?.message || 'erreur inconnue'}`);
    } finally {
      status.dataset.busy = 'false';
      updateButtons();
    }
  }

  testBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (hasIp()) runJob(buildTestElements(), 'Test…');
  });

  printBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasIp() || !hasImage()) return;
    runJob(buildImageElements(fitForPrinter(canvas)), 'Envoi…');
  });

  updateButtons();
})();