// Main application - Amiga Image Converter
// Imports from modular components

import { openFileWithPicker, saveFileWithPicker } from './src/fileIO.js';
import { ColorPicker } from './src/colorPicker.js';
import { createCurvesEditor } from './src/curvesEditor.js';
import { quantizeColor, rgbToHex, formatHex, getBitDepth } from './src/colorUtils.js';
import { createPaletteDisplay } from './src/paletteDisplay.js';
import { createIndexedPNG } from './src/pngExport.js';
import {
  DEFAULT_SETTINGS,
  gatherSettings,
  applySettings,
  getAdjustmentValues,
  getConversionValues,
  getAlphaValues,
  parseMatteColor,
  updateDitherControlVisibility,
} from './src/settingsManager.js';

// Helper functions to reduce duplication

// Get pixel position from click event on canvas
function getPixelFromClick(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
  const ctx = canvas.getContext("2d");
  return ctx.getImageData(x, y, 1, 1).data;
}

// Apply all adjustments (curves, brightness, contrast, saturation, gamma) and convert to quantized hex
function getAdjustedQuantizedHex(r, g, b, curvesEditorRef) {
  // Apply curves if available
  if (curvesEditorRef && curvesEditorRef.applyToPixel) {
    const adjusted = curvesEditorRef.applyToPixel(r, g, b);
    r = adjusted.r;
    g = adjusted.g;
    b = adjusted.b;
  }

  // Get adjustment values from shared helper
  const { brightness, contrast, saturation, gamma } = getAdjustmentValues();

  // Apply brightness
  r += brightness;
  g += brightness;
  b += brightness;

  // Apply contrast
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  r = contrastFactor * (r - 128) + 128;
  g = contrastFactor * (g - 128) + 128;
  b = contrastFactor * (b - 128) + 128;

  // Apply saturation
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const satFactor = 1 + saturation / 100;
  r = gray + (r - gray) * satFactor;
  g = gray + (g - gray) * satFactor;
  b = gray + (b - gray) * satFactor;

  // Apply gamma
  r = 255 * Math.pow(r / 255, 1 / gamma);
  g = 255 * Math.pow(g / 255, 1 / gamma);
  b = 255 * Math.pow(b / 255, 1 / gamma);

  // Clamp to valid range
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));

  // Quantize to current bit depth
  const bitDepth = getBitDepth();
  const rQ = quantizeColor(r, bitDepth);
  const gQ = quantizeColor(g, bitDepth);
  const bQ = quantizeColor(b, bitDepth);

  return rgbToHex(rQ, gQ, bQ);
}

// Toggle locked color state and reconvert
function toggleLockedColor(hexColor) {
  if (lockedColors.has(hexColor)) {
    lockedColors.delete(hexColor);
  } else {
    lockedColors.add(hexColor);
  }
  if (window.sourceImage) {
    convertImage();
  }
}

// Lock/unlock color from preview canvas (already converted colors)
function togglePreviewColor(hexColor) {
  if (lockedColors.has(hexColor)) {
    lockedColors.delete(hexColor);
    if (window.sourceImage) {
      convertImage();
    }
  } else {
    lockedColors.add(hexColor);
    // Update palette display to show locked state
    document.querySelectorAll(".palette-color").forEach((el) => {
      if (el.dataset.rgbFull === hexColor) {
        el.classList.add("locked");
      }
    });
  }
}

// State variables
let lockedColors = new Set();
let currentPalette = [];
let currentIndexedData = null;

// Web Worker setup for non-blocking image processing
let conversionWorker = null;
let currentConversionId = 0;
let conversionInProgress = false;
let pendingConversion = false;

// Slide reveal state
let isDraggingSlider = false;
let currentSlidePosition = 50;

// Aspect ratio lock
let lastEditedDimension = null;

// Create curves editor with convertImage callback
const curvesEditor = createCurvesEditor(convertImage);

// Create palette display manager
const paletteDisplayManager = createPaletteDisplay({
  getCurrentPalette: () => currentPalette,
  setCurrentPalette: (palette) => { currentPalette = palette; },
  getLockedColors: () => lockedColors,
  convertImageCallback: convertImage,
});

// Expose for palette loading
function displayPalette(palette) {
  paletteDisplayManager.displayPalette(palette);
}

// Main conversion function
async function convertImage() {
  if (!window.sourceImage) return;

  // If a conversion is already in progress, mark that we need another one
  if (conversionInProgress) {
    pendingConversion = true;
    return;
  }

  // Mark that we're starting a conversion
  conversionInProgress = true;

  // Show palette actions
  document.getElementById("paletteActions").classList.remove("hidden");

  // Use setTimeout to allow UI to update
  setTimeout(() => {
    const originalCanvas = document.getElementById("originalCanvas");
    const previewCanvas = document.getElementById("previewCanvas");
    const slideOriginalCanvas = document.getElementById("slideOriginalCanvas");
    const slidePreviewCanvas = document.getElementById("slidePreviewCanvas");

    const ctx = originalCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    // Get resize dimensions (will auto-detect if different from original)
    const resizeWidth = parseInt(document.getElementById("resizeWidth").value);
    const resizeHeight = parseInt(
      document.getElementById("resizeHeight").value,
    );

    // Use resize dimensions if valid, otherwise use original
    const width =
      !isNaN(resizeWidth) && resizeWidth > 0
        ? resizeWidth
        : window.sourceImage.width;
    const height =
      !isNaN(resizeHeight) && resizeHeight > 0
        ? resizeHeight
        : window.sourceImage.height;

    // Only set canvas sizes if they've changed (setting dimensions clears the canvas)
    if (originalCanvas.width !== width || originalCanvas.height !== height) {
      originalCanvas.width = width;
      originalCanvas.height = height;
      previewCanvas.width = width;
      previewCanvas.height = height;
      slideOriginalCanvas.width = width;
      slideOriginalCanvas.height = height;
      slidePreviewCanvas.width = width;
      slidePreviewCanvas.height = height;
    }

    // Draw original to main canvas (resized if enabled)
    ctx.drawImage(window.sourceImage, 0, 0, width, height);

    // Get image data and calculate histogram
    let imageData = ctx.getImageData(0, 0, width, height);
    curvesEditor.calculateHistogram(imageData);

    // Draw original to slide canvas
    const slideOriginalCtx = slideOriginalCanvas.getContext("2d");
    slideOriginalCtx.drawImage(window.sourceImage, 0, 0, width, height);

    // Increment conversion ID to track this conversion
    currentConversionId++;
    const thisConversionId = currentConversionId;

    // Get settings from shared helpers
    const adj = getAdjustmentValues();
    const conv = getConversionValues();
    const alpha = getAlphaValues();

    // Gather all parameters for worker
    const params = {
      ...adj,
      curvesLUTs: curvesEditor.getCurvesLUTs(),
      colorCount: conv.colorCount,
      bitDepth: conv.bitDepth,
      quantMethod: conv.quantMethod,
      colorDistance: conv.colorDistance,
      lockedColors: Array.from(lockedColors),
      ditherMethod: conv.ditherMethod,
      ditherAmount: conv.ditherAmount,
      bayerSize: conv.bayerSize,
      errorDampening: conv.errorDampeningEnabled ? conv.errorDampeningThreshold : null,
      alphaMode: alpha.mode,
      alphaThreshold: alpha.threshold,
      matteColor: parseMatteColor(alpha.matteColorHex),
    };

    // Send to worker for processing (copy data, don't transfer)
    // This keeps the original preview visible while processing
    conversionWorker.postMessage({
      id: thisConversionId,
      imageData: imageData.data.slice(0), // Copy the array
      width: width,
      height: height,
      params: params,
    });
  }, 10);
}

// Update view mode display
function updateViewMode() {
  const viewMode = document.getElementById("viewMode").value;
  const zoomLevel = document.getElementById("zoomLevel").value;
  const canvasGrid = document.getElementById("canvasGrid");
  const slideContainer = document.getElementById("slideRevealContainer");
  const originalWrapper = document.getElementById("originalWrapper");
  const previewWrapper = document.getElementById("previewWrapper");

  // Hide everything first
  canvasGrid.style.display = "none";
  slideContainer.style.display = "none";
  originalWrapper.classList.remove("hidden");
  previewWrapper.classList.remove("hidden");

  // Apply zoom to all canvases
  const allCanvases = [
    document.getElementById("originalCanvas"),
    document.getElementById("previewCanvas"),
    document.getElementById("slideOriginalCanvas"),
    document.getElementById("slidePreviewCanvas"),
  ];

  if (zoomLevel === "fit") {
    // For fit mode, use responsive CSS approach
    const isStacked = viewMode === "stacked";

    allCanvases.forEach((canvas) => {
      if (!canvas) return;

      // Use responsive sizing with constraints
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.maxWidth = "100%";
      // In stacked mode, each canvas gets 50% of height
      canvas.style.maxHeight = isStacked ? "50%" : "100%";
      canvas.style.objectFit = "contain";
    });
  } else {
    allCanvases.forEach((canvas) => {
      if (!canvas) return;

      const scale = parseFloat(zoomLevel);
      canvas.style.width = "";
      canvas.style.height = "";
      canvas.style.maxWidth = "";
      canvas.style.maxHeight = "";
      canvas.style.objectFit = "";

      if (scale === 1) {
        // For 100%, let browser use natural canvas size
        canvas.style.width = "";
        canvas.style.height = "";
      } else {
        // For zoom, explicitly set CSS size
        const cssWidth = canvas.width * scale;
        const cssHeight = canvas.height * scale;
        canvas.style.width = cssWidth + "px";
        canvas.style.height = cssHeight + "px";
      }
    });
  }

  // Show based on mode
  if (viewMode === "slide-reveal") {
    slideContainer.style.display = "flex";
    slideContainer.style.justifyContent = "center";
    slideContainer.style.alignItems = "flex-start";

    if (zoomLevel === "fit") {
      slideContainer.style.width = "100%";
    }else{
      slideContainer.style.width = "unset";
    }

    setTimeout(() => {
      updateSlideDivider(currentSlidePosition); // Use stored position
    }, 100);
  } else {
    canvasGrid.style.display = "grid";
    canvasGrid.className = "canvas-grid " + viewMode;

    if (viewMode === "original-only") {
      previewWrapper.classList.add("hidden");
    } else if (viewMode === "preview-only") {
      originalWrapper.classList.add("hidden");
    }
  }
}

// Slide reveal divider handling
function updateSlideDivider(percentage) {
  currentSlidePosition = percentage; // Remember the position
  const wrapper = document.getElementById("slideRevealWrapper");
  const divider = document.getElementById("slideDivider");
  const topCanvas = document.getElementById("slideOriginalCanvas");
  const bottomCanvas = document.getElementById("slidePreviewCanvas");

  if (!wrapper || !bottomCanvas || bottomCanvas.width === 0) {
    return;
  }

  // Use the canvas's actual displayed width (CSS width), not pixel width
  const width = bottomCanvas.offsetWidth;
  const position = (percentage / 100) * width;

  divider.style.left = position + "px";
  topCanvas.style.clipPath = `inset(0 ${100 - percentage}% 0 0)`;
}

document.getElementById("slideDivider").addEventListener("mousedown", () => {
  isDraggingSlider = true;
});

document.addEventListener("mousemove", (e) => {
  if (!isDraggingSlider) return;

  const wrapper = document.getElementById("slideRevealWrapper");
  const canvas = document.getElementById("slidePreviewCanvas");
  const rect = wrapper.getBoundingClientRect();
  const x = e.clientX - rect.left;
  // Use offsetWidth (displayed width) not canvas.width (pixel width)
  const percentage = Math.max(0, Math.min(100, (x / canvas.offsetWidth) * 100));

  updateSlideDivider(percentage);
});

document.addEventListener("mouseup", () => {
  isDraggingSlider = false;
});

// Drag and drop
const canvasDisplay = document.getElementById("canvasDisplay");

canvasDisplay.addEventListener("dragover", (e) => {
  e.preventDefault();
  canvasDisplay.classList.add("drop-target");
});

canvasDisplay.addEventListener("dragleave", () => {
  canvasDisplay.classList.remove("drop-target");
});

canvasDisplay.addEventListener("drop", (e) => {
  e.preventDefault();
  canvasDisplay.classList.remove("drop-target");

  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    loadImageFile(file);
  }
});

function loadImageFile(file) {
  // Store original filename (without extension) for download
  const lastDot = file.name.lastIndexOf(".");
  window.sourceFilename = lastDot > 0 ? file.name.substring(0, lastDot) : file.name;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      window.sourceImage = img;

      // Set resize dimensions to image's natural size
      document.getElementById("resizeWidth").value = img.width;
      document.getElementById("resizeHeight").value = img.height;

      // Store aspect ratio for lock functionality
      window.sourceAspectRatio = img.width / img.height;

      document.getElementById("canvasDisplay").classList.add("has-image");
      document.getElementById("canvasGrid").style.display = "grid";

      // Toggle image buttons
      document.getElementById("chooseImageBtn").style.display = "none";
      document.getElementById("changeImageBtn").style.display = "block";

      convertImage();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function getImageFileFromClipboardEvent(event) {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  return null;
}

function isTextInputElement(element) {
  if (!element) return false;

  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

// Update preview title based on bit depth
function updatePreviewTitle() {
  const bitDepth = getBitDepth();
  const title = document.getElementById("previewTitle");
  if (title) {
    title.textContent = `${bitDepth}-bit Preview`;
  }
}

// Initialize page state on load
window.addEventListener("DOMContentLoaded", () => {
  // Reset to empty state
  document.getElementById("downloadBtn").disabled = true;
  document.getElementById("chooseImageBtn").style.display = "block";
  document.getElementById("changeImageBtn").style.display = "none";
  document.getElementById("canvasDisplay").classList.remove("has-image");
  document.getElementById("canvasGrid").style.display = "none";

  // Clear any persisted file input
  document.getElementById("imageInput").value = "";

  // Apply default settings (prevents browser form persistence)
  applySettings(DEFAULT_SETTINGS, curvesEditor);

  // Update preview title to match default bit depth
  updatePreviewTitle();

  // Reset window state
  window.sourceImage = null;
});

// Event listeners
document.getElementById("imageInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadImageFile(file);
});

// Make drop message clickable
document.getElementById("dropMessage").addEventListener("click", async () => {
  const file = await openFileWithPicker(
    document.getElementById("imageInput"),
    [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] } }]
  );
  if (file) loadImageFile(file);
});

// Choose Image button (empty state)
document.getElementById("chooseImageBtn").addEventListener("click", async () => {
  const file = await openFileWithPicker(
    document.getElementById("imageInput"),
    [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] } }]
  );
  if (file) loadImageFile(file);
});

// Change Image button (loaded state)
document.getElementById("changeImageBtn").addEventListener("click", async () => {
  const file = await openFileWithPicker(
    document.getElementById("imageInput"),
    [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] } }]
  );
  if (file) loadImageFile(file);
});

document.addEventListener("paste", (e) => {
  if (isTextInputElement(document.activeElement)) return;

  const file = getImageFileFromClipboardEvent(e);
  if (!file) return;

  e.preventDefault();
  loadImageFile(file);
});

// Helper function to update control group max-height
function updateControlGroupHeight(element) {
  const group = element.closest(".control-group");
  if (group && !group.classList.contains("collapsed")) {
    const content = group.querySelector(".control-group-content");
    if (content) {
      content.style.maxHeight = content.scrollHeight + "px";
    }
  }
}

// Show/hide Bayer size control, dither amount, and error dampening
document.getElementById("ditherMethod").addEventListener("change", (e) => {
  updateDitherControlVisibility(e.target.value);
  // Update the control group height to accommodate the new visibility
  updateControlGroupHeight(document.getElementById("bayerSizeControl"));
});

// Trigger conversion on any control change
const continuousControls = [
  "colors",
  "ditherAmount",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "gamma",
  "errorDampeningThreshold",
];

const discreteControls = [
  "bitDepth",
  "quantMethod",
  "ditherMethod",
  "bayerSize",
  "colorDistance",
  "errorDampeningEnabled",
];

continuousControls.forEach((id) => {
  const element = document.getElementById(id);
  element.addEventListener("input", convertImage);
  element.addEventListener("change", convertImage);
});

discreteControls.forEach((id) => {
  const element = document.getElementById(id);
  element.addEventListener("change", convertImage);
});

// Update preview title when bit depth changes
document.getElementById("bitDepth").addEventListener("change", updatePreviewTitle);

// Matte color input converts on change (when user finishes typing)
document
  .getElementById("matteColorInput")
  .addEventListener("change", convertImage);

// Alpha mode toggle
document.getElementById("alphaMode").addEventListener("change", (e) => {
  const mode = e.target.value;
  document.getElementById("alphaModeMatteOptions").style.display = mode === "matte" ? "flex" : "none";
  document.getElementById("alphaModeThresholdOptions").style.display = mode === "threshold" ? "flex" : "none";
  if (window.sourceImage) {
    convertImage();
  }
});

// Alpha threshold slider sync
document.getElementById("alphaThreshold").addEventListener("input", (e) => {
  document.getElementById("alphaThresholdNumber").value = e.target.value;
  if (window.sourceImage) {
    convertImage();
  }
});

document.getElementById("alphaThresholdNumber").addEventListener("input", (e) => {
  const value = Math.max(1, Math.min(255, parseInt(e.target.value) || 128));
  document.getElementById("alphaThreshold").value = value;
  if (window.sourceImage) {
    convertImage();
  }
});

// View mode and zoom changes
document.getElementById("viewMode").addEventListener("change", () => {
  if (window.sourceImage) {
    updateViewMode();
  }
});

document.getElementById("zoomLevel").addEventListener("change", () => {
  if (window.sourceImage) {
    convertImage();
  }
});

// Handle window resize for fit mode
let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const zoomLevel = document.getElementById("zoomLevel").value;
    if (window.sourceImage && zoomLevel === "fit") {
      updateViewMode();
    }
  }, 100);
});

// Download button
document.getElementById("downloadBtn").addEventListener("click", async () => {
  // Always export as indexed PNG
  const previewCanvas = document.getElementById("previewCanvas");
  const slidePreviewCanvas = document.getElementById("slidePreviewCanvas");
  const viewMode = document.getElementById("viewMode").value;

  // Choose the appropriate canvas based on view mode
  let canvas;
  if (viewMode === "slide-reveal") {
    canvas = slidePreviewCanvas;
  } else {
    canvas = previewCanvas;
  }

  const baseName = window.sourceFilename || "amiga-converted";

  if (currentPalette.length > 0) {
    // Create indexed PNG with exact palette
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Create indexed pixel array by mapping each pixel to palette index
    const indexed = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Find closest palette color
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < currentPalette.length; j++) {
        const dr = r - currentPalette[j].r;
        const dg = g - currentPalette[j].g;
        const db = b - currentPalette[j].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      }
      indexed[i / 4] = bestIdx;
    }

    // Create indexed PNG
    const pngData = createIndexedPNG(
      canvas.width,
      canvas.height,
      indexed,
      currentPalette,
    );

    const blob = new Blob([pngData], { type: "image/png" });
    await saveFileWithPicker(blob, `${baseName}.png`);
  } else {
    // Fallback to RGB PNG if no palette available
    const dataUrl = canvas.toDataURL();
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await saveFileWithPicker(blob, `${baseName}.png`);
  }
});

// Reset all button
document.getElementById("resetAllBtn").addEventListener("click", () => {
  // Reset only adjustment sliders (not curves or conversion options)
  document.getElementById("brightness").value = 0;
  document.getElementById("brightnessNumber").value = 0;
  document.getElementById("contrast").value = 0;
  document.getElementById("contrastNumber").value = 0;
  document.getElementById("saturation").value = 0;
  document.getElementById("saturationNumber").value = 0;
  document.getElementById("hue").value = 0;
  document.getElementById("hueNumber").value = 0;
  document.getElementById("gamma").value = 1;
  document.getElementById("gammaNumber").value = 1;

  // Trigger conversion if image is loaded
  if (window.sourceImage) {
    convertImage();
  }
});

// Save Settings button
document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const settings = gatherSettings(curvesEditor);
  const json = JSON.stringify(settings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  await saveFileWithPicker(blob, "amiga-converter-settings.json", [{
    description: 'JSON Files',
    accept: { 'application/json': ['.json'] }
  }]);
});

// Load Settings button
document.getElementById("loadSettingsBtn").addEventListener("click", async () => {
  const file = await openFileWithPicker(
    document.getElementById("settingsInput"),
    [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
  );
  if (file) {
    try {
      const text = await file.text();
      const settings = JSON.parse(text);
      if (applySettings(settings, curvesEditor)) {
        updatePreviewTitle();
        if (window.sourceImage) {
          convertImage();
        }
      }
    } catch (e) {
      alert('Failed to load settings: ' + e.message);
    }
  }
});

// Settings input fallback (for browsers without File System Access API)
document.getElementById("settingsInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const settings = JSON.parse(text);
    if (applySettings(settings, curvesEditor)) {
      updatePreviewTitle();
      if (window.sourceImage) {
        convertImage();
      }
    }
  } catch (err) {
    alert('Failed to load settings: ' + err.message);
  }

  e.target.value = "";
});

// Initialize curves editor
curvesEditor.init();

// Collapsible sections
document.querySelectorAll(".control-group h3").forEach((h3) => {
  h3.addEventListener("click", () => {
    const group = h3.parentElement;
    const content = group.querySelector(".control-group-content");

    if (group.classList.contains("collapsed")) {
      group.classList.remove("collapsed");
      content.style.maxHeight = content.scrollHeight + "px";
    } else {
      group.classList.add("collapsed");
      content.style.maxHeight = "0";
    }
  });

  // Set initial max-height
  const group = h3.parentElement;
  const content = group.querySelector(".control-group-content");
  if (content && !group.classList.contains("collapsed")) {
    content.style.maxHeight = content.scrollHeight + "px";
  }
});

// Sync slider and number inputs
function setupSliderNumberSync(sliderId, numberId) {
  const slider = document.getElementById(sliderId);
  const number = document.getElementById(numberId);

  if (!slider || !number) return;

  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);

  slider.addEventListener("input", () => {
    number.value = slider.value;
    number.style.borderColor = ""; // Clear any error state
  });

  // Allow typing but don't update slider until valid
  number.addEventListener("input", () => {
    const value = parseFloat(number.value);

    if (isNaN(value) || value < min || value > max) {
      // Invalid value - show visual feedback but allow typing
      number.style.borderColor = "#ff4a4a";
    } else {
      // Valid value - update slider and trigger conversion
      number.style.borderColor = "";
      slider.value = number.value;
      slider.dispatchEvent(new Event("input"));
    }
  });

  // On blur, enforce valid value
  number.addEventListener("blur", () => {
    const value = parseFloat(number.value);

    if (isNaN(value) || value < min || value > max) {
      // Reset to slider value if invalid
      number.value = slider.value;
      number.style.borderColor = "";
    }
  });
}

setupSliderNumberSync("brightness", "brightnessNumber");
setupSliderNumberSync("contrast", "contrastNumber");
setupSliderNumberSync("saturation", "saturationNumber");
setupSliderNumberSync("hue", "hueNumber");
setupSliderNumberSync("gamma", "gammaNumber");
setupSliderNumberSync("colors", "colorsNumber");
setupSliderNumberSync("ditherAmount", "ditherAmountNumber");
setupSliderNumberSync("errorDampeningThreshold", "errorDampeningThresholdNumber");

// Double-click to reset sliders to default values
const sliderDefaults = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  gamma: 1,
  colors: 32,
  ditherAmount: 0.5,
  errorDampeningThreshold: 48,
};

Object.entries(sliderDefaults).forEach(([sliderId, defaultValue]) => {
  const slider = document.getElementById(sliderId);
  const numberId = sliderId + "Number";
  const number = document.getElementById(numberId);

  if (slider) {
    slider.addEventListener("dblclick", () => {
      slider.value = defaultValue;
      if (number) {
        number.value = defaultValue;
      }
      slider.dispatchEvent(new Event("input"));
    });
  }
});

// Track mouse on preview canvas to highlight palette color
document.getElementById("previewCanvas").addEventListener("mousemove", (e) => {
  const canvas = document.getElementById("previewCanvas");
  const pixel = getPixelFromClick(canvas, e);
  const bitDepth = getBitDepth();

  // Convert to appropriate format for comparison based on bit depth
  const pixelColorHex = formatHex(pixel[0], pixel[1], pixel[2], bitDepth);

  // Find matching palette color by comparing the tooltip's hex portion
  document.querySelectorAll(".palette-color").forEach((el) => {
    const tooltip = el.dataset.rgb || "";
    const tooltipHex = tooltip.split(" ")[0]; // Get the hex part before the bullet
    if (tooltipHex === pixelColorHex) {
      el.classList.add("highlighted");
    } else {
      el.classList.remove("highlighted");
    }
  });
});

document.getElementById("previewCanvas").addEventListener("mouseleave", () => {
  document.querySelectorAll(".palette-color").forEach((el) => {
    el.classList.remove("highlighted");
  });
});

// Click preview canvas to lock color
document.getElementById("previewCanvas").addEventListener("click", (e) => {
  const canvas = document.getElementById("previewCanvas");
  const pixel = getPixelFromClick(canvas, e);
  const hexColor = rgbToHex(pixel[0], pixel[1], pixel[2]);
  togglePreviewColor(hexColor);
});

// Click original canvas to add/remove custom color
document.getElementById("originalCanvas").addEventListener("click", (e) => {
  const canvas = document.getElementById("originalCanvas");
  const pixel = getPixelFromClick(canvas, e);
  const hexColor = getAdjustedQuantizedHex(pixel[0], pixel[1], pixel[2], curvesEditor);
  toggleLockedColor(hexColor);
});

// Click slide preview canvas to lock color
document.getElementById("slidePreviewCanvas").addEventListener("click", (e) => {
  const canvas = document.getElementById("slidePreviewCanvas");
  const pixel = getPixelFromClick(canvas, e);
  const hexColor = rgbToHex(pixel[0], pixel[1], pixel[2]);
  togglePreviewColor(hexColor);
});

// Click slide original canvas to add/remove custom color
document.getElementById("slideOriginalCanvas").addEventListener("click", (e) => {
  const canvas = document.getElementById("slideOriginalCanvas");
  const pixel = getPixelFromClick(canvas, e);
  const hexColor = getAdjustedQuantizedHex(pixel[0], pixel[1], pixel[2], curvesEditor);
  toggleLockedColor(hexColor);
});

// Add color picker
let addColorPicker = null;
let addColorValue = [255, 255, 255];

document.getElementById("addColorBtn").addEventListener("click", () => {
  document.getElementById("addColorModal").classList.add("active");
  if (!addColorPicker) {
    addColorPicker = ColorPicker.create(
      document.getElementById("addColorPicker"),
      (r, g, b) => { addColorValue = [r, g, b]; }
    );
  }
  ColorPicker.setColor(addColorPicker, [255, 255, 255]);
});

document.getElementById("cancelAddColor").addEventListener("click", () => {
  document.getElementById("addColorModal").classList.remove("active");
});

document.getElementById("confirmAddColor").addEventListener("click", () => {
  addCustomColor();
});

document.querySelector("#addColorPicker .color-picker-hex").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addCustomColor();
  }
});

function addCustomColor() {
  const [r, g, b] = addColorValue;
  lockedColors.add(rgbToHex(r, g, b));
  document.getElementById("addColorModal").classList.remove("active");
  if (window.sourceImage) {
    convertImage();
  }
}

// Matte color picker modal
let matteColorPicker = null;
const matteColorModal = document.getElementById("matteColorModal");
const matteColorBtn = document.getElementById("matteColorBtn");
const matteColorInput = document.getElementById("matteColorInput");

function updateMatteFromPicker(r, g, b) {
  const hex = ColorPicker.rgbToHex3(r, g, b);
  matteColorInput.value = hex;
  matteColorBtn.style.background = `rgb(${r}, ${g}, ${b})`;
}

function updateMatteButtonColor() {
  const rgb = ColorPicker.parseHex(matteColorInput.value);
  if (rgb) {
    matteColorBtn.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
}

matteColorBtn.addEventListener("click", () => {
  // Initialize picker if needed
  if (!matteColorPicker) {
    matteColorPicker = ColorPicker.create(
      document.getElementById("mattePickerInner"),
      updateMatteFromPicker
    );
  }
  // Set current color
  const rgb = ColorPicker.parseHex(matteColorInput.value) || [255, 255, 255];
  ColorPicker.setColor(matteColorPicker, rgb);
  matteColorModal.classList.add("active");
});

document.getElementById("matteColorClose").addEventListener("click", () => {
  matteColorModal.classList.remove("active");
  if (window.sourceImage) {
    convertImage();
  }
});

// Update button color when input changes
matteColorInput.addEventListener("input", updateMatteButtonColor);
matteColorInput.addEventListener("change", updateMatteButtonColor);

// Initialize button color
updateMatteButtonColor();

// Lock all button
document.getElementById("lockAllBtn").addEventListener("click", () => {
  currentPalette.forEach((color) => {
    lockedColors.add(rgbToHex(color.r, color.g, color.b));
  });
  if (window.sourceImage) {
    convertImage();
  }
});

// Clear locks button
document.getElementById("clearLocksBtn").addEventListener("click", () => {
  lockedColors.clear();
  if (window.sourceImage) {
    convertImage();
  }
});

// Load palette from PNG
document.getElementById("loadPaletteBtn").addEventListener("click", async () => {
  const file = await openFileWithPicker(
    document.getElementById("paletteInput"),
    [{ description: 'PNG Images', accept: { 'image/png': ['.png'] } }]
  );
  if (file) loadPaletteFromPNG(file);
});

document.getElementById("paletteInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  loadPaletteFromPNG(file);
  e.target.value = ""; // Clear selection
});

async function loadPaletteFromPNG(file) {
  try {
    // Read file as ArrayBuffer for PNG chunk parsing
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Validate PNG signature
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < pngSignature.length; i++) {
      if (bytes[i] !== pngSignature[i]) {
        alert("Invalid PNG file");
        return;
      }
    }

    // Try to extract PLTE chunk (palette for indexed PNGs)
    const palette = extractPLTEChunk(bytes);

    if (palette && palette.length > 0) {
      // Indexed PNG - use PLTE palette
      applyLoadedPalette(
        palette,
        `Loaded ${palette.length} colors from indexed PNG palette`,
      );
    } else {
      // Non-indexed PNG - scan for unique colors
      const scannedPalette = await extractUniqueColors(file);
      if (scannedPalette) {
        applyLoadedPalette(
          scannedPalette,
          `Loaded ${scannedPalette.length} unique colors from image`,
        );
      }
    }
  } catch (error) {
    console.error("Error loading palette:", error);
    alert("Error loading palette from PNG");
  }
}

function extractPLTEChunk(bytes) {
  let offset = 8; // Skip PNG signature

  while (offset < bytes.length) {
    // Read chunk length (4 bytes, big-endian)
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    offset += 4;

    // Read chunk type (4 bytes)
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    offset += 4;

    if (type === "PLTE") {
      // Found palette chunk - extract RGB triplets
      const palette = [];
      const numColors = length / 3;
      const bitDepth = getBitDepth();

      for (let i = 0; i < numColors; i++) {
        const r = bytes[offset + i * 3];
        const g = bytes[offset + i * 3 + 1];
        const b = bytes[offset + i * 3 + 2];

        // Quantize to current bit depth
        palette.push({
          r: quantizeColor(r, bitDepth),
          g: quantizeColor(g, bitDepth),
          b: quantizeColor(b, bitDepth),
        });
      }

      return palette;
    }

    // Skip chunk data and CRC (4 bytes)
    offset += length + 4;

    // Stop at IEND chunk
    if (type === "IEND") break;
  }

  return null; // No PLTE chunk found
}

async function extractUniqueColors(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        // Draw to temporary canvas
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Collect unique colors (preserve first-occurrence order)
        const uniqueColors = [];
        const colorSet = new Set();

        const bitDepth = getBitDepth();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip fully transparent pixels
          if (a === 0) continue;

          // Create unique key
          const key = `${r},${g},${b}`;

          if (!colorSet.has(key)) {
            colorSet.add(key);
            uniqueColors.push({
              r: quantizeColor(r, bitDepth),
              g: quantizeColor(g, bitDepth),
              b: quantizeColor(b, bitDepth),
            });
          }

          // Stop if too many colors
          if (uniqueColors.length > 256) {
            alert(
              "Image has more than 256 unique colors. Please use an image with 256 or fewer colors.",
            );
            resolve(null);
            return;
          }
        }

        resolve(uniqueColors);
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function applyLoadedPalette(palette, message) {
  // Clear existing locks
  lockedColors.clear();

  // Add all palette colors to locked set
  palette.forEach((color) => {
    lockedColors.add(rgbToHex(color.r, color.g, color.b));
  });

  // Update color count to match palette size
  const colorCount = palette.length;
  document.getElementById("colors").value = colorCount;
  document.getElementById("colorsNumber").value = colorCount;

  // Show success message
  alert(message);

  // Trigger conversion if image is loaded
  if (window.sourceImage) {
    convertImage();
  }
}

// Close modal on background click
document.getElementById("addColorModal").addEventListener("click", (e) => {
  if (e.target.id === "addColorModal") {
    document.getElementById("addColorModal").classList.remove("active");
  }
});

// Aspect ratio lock functionality
document.getElementById("resizeWidth").addEventListener("input", (e) => {
  lastEditedDimension = "width";
  const aspectLocked = document.getElementById("aspectRatioLock").checked;

  if (aspectLocked && window.sourceAspectRatio) {
    const newWidth = parseInt(e.target.value);
    if (!isNaN(newWidth) && newWidth > 0) {
      const newHeight = Math.round(newWidth / window.sourceAspectRatio);
      document.getElementById("resizeHeight").value = newHeight;
    }
  }
});

document.getElementById("resizeHeight").addEventListener("input", (e) => {
  lastEditedDimension = "height";
  const aspectLocked = document.getElementById("aspectRatioLock").checked;

  if (aspectLocked && window.sourceAspectRatio) {
    const newHeight = parseInt(e.target.value);
    if (!isNaN(newHeight) && newHeight > 0) {
      const newWidth = Math.round(newHeight * window.sourceAspectRatio);
      document.getElementById("resizeWidth").value = newWidth;
    }
  }
});

// Trigger conversion when dimension values change (on blur or enter)
document.getElementById("resizeWidth").addEventListener("change", () => {
  if (window.sourceImage) {
    convertImage();
  }
});

document.getElementById("resizeHeight").addEventListener("change", () => {
  if (window.sourceImage) {
    convertImage();
  }
});

// Handle aspect ratio lock toggle
document.getElementById("aspectRatioLock").addEventListener("change", (e) => {
  if (e.target.checked && window.sourceAspectRatio) {
    // When locking, update based on the last edited dimension
    const widthInput = document.getElementById("resizeWidth");
    const heightInput = document.getElementById("resizeHeight");

    if (lastEditedDimension === "width") {
      const width = parseInt(widthInput.value);
      if (!isNaN(width) && width > 0) {
        heightInput.value = Math.round(width / window.sourceAspectRatio);
      }
    } else {
      const height = parseInt(heightInput.value);
      if (!isNaN(height) && height > 0) {
        widthInput.value = Math.round(height * window.sourceAspectRatio);
      }
    }
  }
});

// Web Worker initialization
function initWorker() {
  if (conversionWorker) return;

  conversionWorker = new Worker("worker.js");

  conversionWorker.addEventListener("message", function (e) {
    const { id, imageData, palette, success, error } = e.data;

    // Mark conversion as complete
    conversionInProgress = false;

    // Ignore stale results
    if (id !== currentConversionId) {
      // If there's a pending conversion, start it now
      if (pendingConversion) {
        pendingConversion = false;
        convertImage();
      }
      return;
    }

    if (!success) {
      console.error("Worker error:", error);
      // If there's a pending conversion, start it now
      if (pendingConversion) {
        pendingConversion = false;
        convertImage();
      }
      return;
    }

    // Get canvases
    const previewCanvas = document.getElementById("previewCanvas");
    const slidePreviewCanvas = document.getElementById("slidePreviewCanvas");

    // Create ImageData and draw to canvases
    const processedImageData = new ImageData(
      new Uint8ClampedArray(imageData),
      previewCanvas.width,
      previewCanvas.height,
    );

    const previewCtx = previewCanvas.getContext("2d");
    previewCtx.putImageData(processedImageData, 0, 0);

    const slidePreviewCtx = slidePreviewCanvas.getContext("2d");
    slidePreviewCtx.putImageData(processedImageData, 0, 0);

    // Display palette
    displayPalette(palette);

    // Update view mode
    updateViewMode();

    // Enable download
    document.getElementById("downloadBtn").disabled = false;

    // If there's a pending conversion, start it now
    if (pendingConversion) {
      pendingConversion = false;
      convertImage();
    }
  });

  conversionWorker.addEventListener("error", function (e) {
    console.error("Worker error:", e);
    conversionInProgress = false;
    // If there's a pending conversion, start it now
    if (pendingConversion) {
      pendingConversion = false;
      convertImage();
    }
  });
}

// Initialize worker on page load
initWorker();
