(() => {
  const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;

  CanvasRenderingContext2D.prototype.putImageData = function patchedPutImageData(imageData, ...args) {
    if (this.canvas?.id === 'previewCanvas' && imageData?.data) {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        const value = luminance < 128 ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }

    return originalPutImageData.call(this, imageData, ...args);
  };
})();