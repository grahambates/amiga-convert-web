// Image resampling — nearest neighbour, bilinear, Lanczos-3

function getSourceData(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: canvas.width, height: canvas.height };
}

function lanczosKernel(x, a) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

export function resampleImage(image, dstW, dstH, method) {
  if (method === 'nearest') {
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, dstW, dstH);
    return ctx.getImageData(0, 0, dstW, dstH);
  }

  const { data: src, width: srcW, height: srcH } = getSourceData(image);
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const xScale = srcW / dstW;
  const yScale = srcH / dstH;

  if (method === 'bilinear') {
    for (let dy = 0; dy < dstH; dy++) {
      for (let dx = 0; dx < dstW; dx++) {
        const sx = (dx + 0.5) * xScale - 0.5;
        const sy = (dy + 0.5) * yScale - 0.5;
        const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)));
        const x1 = Math.min(x0 + 1, srcW - 1);
        const y1 = Math.min(y0 + 1, srcH - 1);
        const fx = sx - Math.floor(sx);
        const fy = sy - Math.floor(sy);
        const dstIdx = (dy * dstW + dx) * 4;
        for (let c = 0; c < 4; c++) {
          const tl = src[(y0 * srcW + x0) * 4 + c];
          const tr = src[(y0 * srcW + x1) * 4 + c];
          const bl = src[(y1 * srcW + x0) * 4 + c];
          const br = src[(y1 * srcW + x1) * 4 + c];
          dst[dstIdx + c] = Math.round(
            tl * (1 - fx) * (1 - fy) +
            tr * fx * (1 - fy) +
            bl * (1 - fx) * fy +
            br * fx * fy
          );
        }
      }
    }
  } else if (method === 'lanczos') {
    const a = 3;
    for (let dy = 0; dy < dstH; dy++) {
      for (let dx = 0; dx < dstW; dx++) {
        const sx = (dx + 0.5) * xScale - 0.5;
        const sy = (dy + 0.5) * yScale - 0.5;
        const x0 = Math.floor(sx) - a + 1;
        const y0 = Math.floor(sy) - a + 1;
        let r = 0, g = 0, b = 0, al = 0, wSum = 0;
        for (let ky = 0; ky < 2 * a; ky++) {
          const py = y0 + ky;
          const wy = lanczosKernel(sy - py, a);
          const cpy = Math.max(0, Math.min(srcH - 1, py));
          for (let kx = 0; kx < 2 * a; kx++) {
            const px = x0 + kx;
            const wx = lanczosKernel(sx - px, a);
            const w = wx * wy;
            const cpx = Math.max(0, Math.min(srcW - 1, px));
            const idx = (cpy * srcW + cpx) * 4;
            r  += src[idx]     * w;
            g  += src[idx + 1] * w;
            b  += src[idx + 2] * w;
            al += src[idx + 3] * w;
            wSum += w;
          }
        }
        const dstIdx = (dy * dstW + dx) * 4;
        dst[dstIdx]     = Math.max(0, Math.min(255, Math.round(r  / wSum)));
        dst[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(g  / wSum)));
        dst[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(b  / wSum)));
        dst[dstIdx + 3] = Math.max(0, Math.min(255, Math.round(al / wSum)));
      }
    }
  }

  return new ImageData(dst, dstW, dstH);
}
