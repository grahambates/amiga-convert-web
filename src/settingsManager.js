// Settings save/load manager

/**
 * Default settings for initializing the application
 * @type {Settings}
 */
export const DEFAULT_SETTINGS = {
  version: 1,
  conversion: {
    colors: 32,
    bitDepth: 12,
    quantMethod: 'rgbquant',
    colorDistance: 'rgb-euclidean',
    ditherMethod: 'floyd-steinberg',
    bayerSize: 4,
    ditherAmount: 0.5,
    errorDampeningEnabled: false,
    errorDampeningThreshold: 48,
    resampleMethod: 'bilinear',
  },
  curves: {
    rgb: [[0, 0], [255, 255]],
    red: [[0, 0], [255, 255]],
    green: [[0, 0], [255, 255]],
    blue: [[0, 0], [255, 255]],
  },
  adjustments: {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    gamma: 1,
  },
  alpha: {
    mode: 'matte',
    threshold: 128,
    matteColor: '#FFF',
  },
};

/**
 * @typedef {Object} AdjustmentValues
 * @property {number} brightness - Brightness adjustment (-100 to 100)
 * @property {number} contrast - Contrast adjustment (-100 to 100)
 * @property {number} saturation - Saturation adjustment (-100 to 100)
 * @property {number} hue - Hue rotation in degrees (-180 to 180)
 * @property {number} gamma - Gamma correction (0.1 to 3.0)
 */

/**
 * @typedef {Object} ConversionValues
 * @property {number} colorCount - Number of colors in palette (2-256)
 * @property {string} quantMethod - Quantization method ('median-cut', 'wu', 'neuquant', 'rgb-quant')
 * @property {string} colorDistance - Color distance metric ('rgb-euclidean', 'weighted-rgb', 'redmean', 'cie76-lab')
 * @property {string} ditherMethod - Dithering algorithm ('none', 'ordered', 'floyd-steinberg', etc.)
 * @property {number} ditherAmount - Dithering intensity (0.0 to 1.0)
 * @property {number} bayerSize - Bayer matrix size for ordered dithering (2, 4, 8, 16)
 * @property {boolean} errorDampeningEnabled - Whether error dampening is enabled
 * @property {number} errorDampeningThreshold - Error dampening threshold (0-255)
 */

/**
 * @typedef {Object} AlphaValues
 * @property {string} mode - Alpha handling mode ('matte', 'threshold')
 * @property {number} threshold - Alpha threshold for threshold mode (0-255)
 * @property {string} matteColorHex - Matte color as hex string (#RGB or #RRGGBB)
 */

/**
 * Get current image adjustment values from DOM
 * @returns {AdjustmentValues} Current adjustment settings
 */
export function getAdjustmentValues() {
  return {
    brightness: parseInt(document.getElementById("brightness").value),
    contrast: parseInt(document.getElementById("contrast").value),
    saturation: parseInt(document.getElementById("saturation").value),
    hue: parseInt(document.getElementById("hue").value),
    gamma: parseFloat(document.getElementById("gamma").value),
  };
}

/**
 * Get current conversion settings from DOM
 * @returns {ConversionValues} Current conversion settings
 */
export function getConversionValues() {
  return {
    colorCount: parseInt(document.getElementById("colors").value),
    bitDepth: parseInt(document.getElementById("bitDepth").value),
    quantMethod: document.getElementById("quantMethod").value,
    colorDistance: document.getElementById("colorDistance").value,
    ditherMethod: document.getElementById("ditherMethod").value,
    ditherAmount: parseFloat(document.getElementById("ditherAmount").value),
    bayerSize: parseInt(document.getElementById("bayerSize").value),
    errorDampeningEnabled: document.getElementById("errorDampeningEnabled").checked,
    errorDampeningThreshold: parseInt(document.getElementById("errorDampeningThreshold").value),
    resampleMethod: document.getElementById("resampleMethod").value,
  };
}

/**
 * Get current alpha/transparency settings from DOM
 * @returns {AlphaValues} Current alpha settings
 */
export function getAlphaValues() {
  return {
    mode: document.getElementById("alphaMode").value,
    threshold: parseInt(document.getElementById("alphaThreshold").value),
    matteColorHex: document.getElementById("matteColorInput").value,
  };
}

/**
 * Parse hex color string to RGB array
 * Supports 3-digit (#RGB) and 6-digit (#RRGGBB) hex formats
 * @param {string} hex - Hex color string (# prefix optional)
 * @returns {number[]|null} RGB as [r, g, b] or null if invalid
 */
export function parseHexColor(hex) {
  hex = hex.replace('#', '').toUpperCase();
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16)
    ];
  } else if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }
  return null;
}

/**
 * Parse hex color string to RGB object
 * @param {string} hex - Hex color string (#RGB or #RRGGBB)
 * @returns {{r: number, g: number, b: number}} RGB color object
 * @example
 * parseMatteColor('#F00')    // { r: 255, g: 0, b: 0 }
 * parseMatteColor('#FF0000') // { r: 255, g: 0, b: 0 }
 */
export function parseMatteColor(hex) {
  const rgb = parseHexColor(hex.trim());
  if (rgb) {
    return { r: rgb[0], g: rgb[1], b: rgb[2] };
  }
  // Default to white if invalid
  return { r: 255, g: 255, b: 255 };
}

/**
 * @typedef {Object} Settings
 * @property {number} version - Settings format version
 * @property {Object} conversion - Conversion settings
 * @property {Object} curves - Curve control points for each channel
 * @property {AdjustmentValues} adjustments - Image adjustments
 * @property {Object} alpha - Alpha/transparency settings
 */

/**
 * Gather all current settings into a serializable object
 * @param {Object} curvesEditor - The curves editor instance
 * @returns {Settings} Complete settings object
 */
export function gatherSettings(curvesEditor) {
  const adj = getAdjustmentValues();
  const conv = getConversionValues();
  const alpha = getAlphaValues();

  return {
    version: 1,
    conversion: {
      colors: conv.colorCount,
      bitDepth: conv.bitDepth,
      quantMethod: conv.quantMethod,
      colorDistance: conv.colorDistance,
      ditherMethod: conv.ditherMethod,
      bayerSize: conv.bayerSize,
      ditherAmount: conv.ditherAmount,
      errorDampeningEnabled: conv.errorDampeningEnabled,
      errorDampeningThreshold: conv.errorDampeningThreshold,
      resampleMethod: conv.resampleMethod,
    },
    curves: {
      rgb: curvesEditor.curves.rgb.map(p => [...p]),
      red: curvesEditor.curves.red.map(p => [...p]),
      green: curvesEditor.curves.green.map(p => [...p]),
      blue: curvesEditor.curves.blue.map(p => [...p]),
    },
    adjustments: adj,
    alpha: {
      mode: alpha.mode,
      threshold: alpha.threshold,
      matteColor: alpha.matteColorHex,
    },
  };
}

/**
 * Apply loaded settings to the UI and curves editor
 * @param {Settings} settings - Settings object to apply
 * @param {Object} curvesEditor - The curves editor instance
 * @returns {boolean} True if settings were applied successfully
 */
export function applySettings(settings, curvesEditor) {
  if (!settings || typeof settings !== 'object') {
    alert('Invalid settings file');
    return false;
  }

  // Conversion settings
  if (settings.conversion) {
    const c = settings.conversion;
    if (c.colors !== undefined) {
      document.getElementById("colors").value = c.colors;
      document.getElementById("colorsNumber").value = c.colors;
    }
    if (c.bitDepth !== undefined) {
      document.getElementById("bitDepth").value = c.bitDepth;
    }
    if (c.quantMethod !== undefined) {
      document.getElementById("quantMethod").value = c.quantMethod;
    }
    if (c.colorDistance !== undefined) {
      document.getElementById("colorDistance").value = c.colorDistance;
    }
    if (c.ditherMethod !== undefined) {
      document.getElementById("ditherMethod").value = c.ditherMethod;
      updateDitherControlVisibility(c.ditherMethod);
    }
    if (c.bayerSize !== undefined) {
      document.getElementById("bayerSize").value = c.bayerSize;
    }
    if (c.ditherAmount !== undefined) {
      document.getElementById("ditherAmount").value = c.ditherAmount;
      document.getElementById("ditherAmountNumber").value = c.ditherAmount;
    }
    if (c.errorDampeningEnabled !== undefined) {
      document.getElementById("errorDampeningEnabled").checked = c.errorDampeningEnabled;
    }
    if (c.errorDampeningThreshold !== undefined) {
      document.getElementById("errorDampeningThreshold").value = c.errorDampeningThreshold;
      document.getElementById("errorDampeningThresholdNumber").value = c.errorDampeningThreshold;
    }
    if (c.resampleMethod !== undefined) {
      document.getElementById("resampleMethod").value = c.resampleMethod;
    }
  }

  // Curves
  if (settings.curves) {
    if (settings.curves.rgb) curvesEditor.curves.rgb = settings.curves.rgb.map(p => [...p]);
    if (settings.curves.red) curvesEditor.curves.red = settings.curves.red.map(p => [...p]);
    if (settings.curves.green) curvesEditor.curves.green = settings.curves.green.map(p => [...p]);
    if (settings.curves.blue) curvesEditor.curves.blue = settings.curves.blue.map(p => [...p]);
    curvesEditor.selectedPoint = null;
    curvesEditor.draw();
  }

  // Adjustments
  if (settings.adjustments) {
    const a = settings.adjustments;
    if (a.contrast !== undefined) {
      document.getElementById("contrast").value = a.contrast;
      document.getElementById("contrastNumber").value = a.contrast;
    }
    if (a.hue !== undefined) {
      document.getElementById("hue").value = a.hue;
      document.getElementById("hueNumber").value = a.hue;
    }
    if (a.saturation !== undefined) {
      document.getElementById("saturation").value = a.saturation;
      document.getElementById("saturationNumber").value = a.saturation;
    }
    if (a.brightness !== undefined) {
      document.getElementById("brightness").value = a.brightness;
      document.getElementById("brightnessNumber").value = a.brightness;
    }
    if (a.gamma !== undefined) {
      document.getElementById("gamma").value = a.gamma;
      document.getElementById("gammaNumber").value = a.gamma;
    }
  }

  // Alpha settings (new format)
  if (settings.alpha) {
    const a = settings.alpha;
    if (a.mode !== undefined) {
      document.getElementById("alphaMode").value = a.mode;
      document.getElementById("alphaModeMatteOptions").style.display = a.mode === "matte" ? "flex" : "none";
      document.getElementById("alphaModeThresholdOptions").style.display = a.mode === "threshold" ? "flex" : "none";
    }
    if (a.threshold !== undefined) {
      document.getElementById("alphaThreshold").value = a.threshold;
      document.getElementById("alphaThresholdNumber").value = a.threshold;
    }
    if (a.matteColor !== undefined) {
      document.getElementById("matteColorInput").value = a.matteColor;
    }
  } else if (settings.matteColor !== undefined) {
    // Backwards compatibility with old format
    document.getElementById("matteColorInput").value = settings.matteColor;
  }

  // Update control group heights for any visibility changes
  document.querySelectorAll(".control-group-content").forEach(content => {
    const group = content.closest(".control-group");
    if (group && !group.classList.contains("collapsed")) {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  });

  return true;
}

/**
 * Update visibility of dither-related controls based on selected method
 * @param {string} method - The dither method ('none', 'ordered', 'floyd-steinberg', etc.)
 */
export function updateDitherControlVisibility(method) {
  const isErrorDiffusion = method !== "ordered" && method !== "none";
  document.getElementById("bayerSizeControl").style.display = method === "ordered" ? "block" : "none";
  document.getElementById("ditherAmountControl").style.display = method === "none" ? "none" : "block";
  document.getElementById("errorDampeningControl").style.display = isErrorDiffusion ? "block" : "none";
}
