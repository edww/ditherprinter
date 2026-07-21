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

const state = {
  image: null,
  mode: 'threshold',
  inverted: false,
  renderTimer: null
};

const modeNames = {
  threshold: 'SEUIL',
  floyd: 'FLOYD–STEINBERG',
  atkinson: 'ATKINSON',
  bayer: 'BAYER 4×4',
  halftone: 'TRAME',
  noise: 'GRAIN'
};

const bayer4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function adjustedGray(r, g, b) {
  const contrast = Number(controls.contrast.value);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  return clamp(factor * (luminance(r, g, b) - 128) + 128);
}

function getTargetSize(image) {
  const maxSide = Number(controls.resolution.value);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  return {
    width: Math.max(1, Math.round(image.naturalWidth * scale)),
    height: Math.max(1, Math.round(image.naturalHeight * scale))
  };
}

function forcePureBlackWhite(data, threshold = 128) {
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] < threshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
}

function applyThreshold(data, threshold) {
  for (let i = 0; i < data.length; i += 4) {
    const gray = adjustedGray(data[i], data[i + 1], data[i + 2]);
    const value = gray < threshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
}

function applyErrorDiffusion(imageData, type) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  const threshold = Number(controls.threshold.value);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = adjustedGray(data[i], data[i + 1], data[i + 2]);
  }

  const add = (x, y, amount) => {
    if (x >= 0 && x < width && y >= 0 && y < height) gray[y * width + x] += amount;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const oldValue = gray[index];
      const newValue = oldValue < threshold ? 0 : 255;
      const error = oldValue - newValue;
      gray[index] = newValue;

      if (type === 'floyd') {
        add(x + 1, y, error * 7 / 16);
        add(x - 1, y + 1, error * 3 / 16);
        add(x, y + 1, error * 5 / 16);
        add(x + 1, y + 1, error * 1 / 16);
      } else {
        const e = error / 8;
        add(x + 1, y, e); add(x + 2, y, e);
        add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e);
        add(x, y + 2, e);
      }
    }
  }

  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const value = gray[p] < 128 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
}

function applyBayer(imageData) {
  const { data, width } = imageData;
  const base = Number(controls.threshold.value);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const x = p % width;
    const y = Math.floor(p / width);
    const localThreshold = base + (bayer4[y % 4][x % 4] - 7.5) * 12;
    const gray = adjustedGray(data[i], data[i + 1], data[i + 2]);
    const value = gray < localThreshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
}

function applyNoise(imageData) {
  const { data } = imageData;
  const base = Number(controls.threshold.value);
  for (let i = 0; i < data.length; i += 4) {
    const gray = adjustedGray(data[i], data[i + 1], data[i + 2]);
    const localThreshold = base + (Math.random() - 0.5) * 105;
    const value = gray < localThreshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
}

function applyHalftone(sourceImageData) {
  const { width, height, data } = sourceImageData;
  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  const tctx = temp.getContext('2d', { willReadFrequently: true });
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, width, height);
  tctx.fillStyle = '#000';

  const cell = Math.max(4, Math.round(width / 100));
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      let total = 0;
      let count = 0;
      for (let yy = y; yy < Math.min(y + cell, height); yy += 2) {
        for (let xx = x; xx < Math.min(x + cell, width); xx += 2) {
          const i = (yy * width + xx) * 4;
          total += adjustedGray(data[i], data[i + 1], data[i + 2]);
          count++;
        }
      }
      const gray = total / Math.max(1, count);
      const darkness = 1 - gray / 255;
      const radius = Math.sqrt(darkness) * cell * 0.72;
      if (radius > 0.25) {
        tctx.beginPath();
        tctx.arc(x + cell / 2, y + cell / 2, radius, 0, Math.PI * 2);
        tctx.fill();
      }
    }
  }

  const result = tctx.getImageData(0, 0, width, height);
  forcePureBlackWhite(result.data, 128);
  return result;
}

function invertPixels(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = data[i] === 0 ? 255 : 0;
  }
}

function render() {
  if (!state.image) return;
  const { width, height } = getTargetSize(state.image);
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(state.image, 0, 0, width, height);

  let imageData = ctx.getImageData(0, 0, width, height);
  const threshold = Number(controls.threshold.value);

  switch (state.mode) {
    case 'floyd':
    case 'atkinson':
      applyErrorDiffusion(imageData, state.mode);
      break;
    case 'bayer':
      applyBayer(imageData);
      break;
    case 'halftone':
      imageData = applyHalftone(imageData);
      break;
    case 'noise':
      applyNoise(imageData);
      break;
    default:
      applyThreshold(imageData.data, threshold);
  }

  forcePureBlackWhite(imageData.data, 128);
  if (state.inverted) invertPixels(imageData.data);
  ctx.putImageData(imageData, 0, 0);
  sizeBadge.textContent = `${width} × ${height}`;
  downloadBtn.disabled = false;
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(render, 35);
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (state.image?.src?.startsWith('blob:')) URL.revokeObjectURL(state.image.src);
    state.image = image;
    emptyState.hidden = true;
    render();
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

function reset() {
  state.image = null;
  state.mode = 'threshold';
  state.inverted = false;
  controls.threshold.value = 128;
  controls.contrast.value = 12;
  controls.resolution.value = 600;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  emptyState.hidden = false;
  downloadBtn.disabled = true;
  sizeBadge.textContent = '— × —';
  document.querySelectorAll('.mode-chip').forEach((chip, index) => chip.classList.toggle('active', index === 0));
  updateLabels();
}

function updateLabels() {
  outputs.threshold.textContent = controls.threshold.value;
  const contrast = Number(controls.contrast.value);
  outputs.contrast.textContent = contrast > 0 ? `+${contrast}` : String(contrast);
  outputs.resolution.textContent = controls.resolution.value;
  modeBadge.textContent = modeNames[state.mode];
  const chips = [...document.querySelectorAll('.mode-chip')];
  modeCount.textContent = `${chips.findIndex(chip => chip.dataset.mode === state.mode) + 1} / ${chips.length}`;
}

['cameraInput', 'libraryInput'].forEach(id => {
  document.querySelector(`#${id}`).addEventListener('change', event => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
});

document.querySelectorAll('.mode-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    state.mode = chip.dataset.mode;
    document.querySelectorAll('.mode-chip').forEach(item => item.classList.toggle('active', item === chip));
    updateLabels();
    scheduleRender();
  });
});

Object.entries(controls).forEach(([key, input]) => {
  input.addEventListener('input', () => {
    updateLabels();
    scheduleRender();
  });
});

document.querySelector('#invertBtn').addEventListener('click', () => {
  state.inverted = !state.inverted;
  scheduleRender();
});

document.querySelector('#resetBtn').addEventListener('click', reset);

downloadBtn.addEventListener('click', event => {
  event.preventDefault();
  if (!state.image) return;
  canvas.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `dither-printer-${state.mode}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }, 'image/png');
});

updateLabels();

// L'application doit toujours charger la version réseau la plus récente.
// L'adresse IP de l'imprimante reste mémorisée séparément dans localStorage.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  });
}
