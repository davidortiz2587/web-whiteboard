const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Controls
const colorEl = document.getElementById('color');
const backgroundColorEl = document.getElementById('background-color');
const sizeEl  = document.getElementById('size');
const sizeVal = document.getElementById('sizeVal');
const penBtn = document.getElementById('pen');
const eraserBtn = document.getElementById('eraser');
const gridBtn = document.getElementById('grid');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const clearBtn = document.getElementById('clear');
const removeBackgroundBtn = document.getElementById('removeBackground');
const uploadBtn = document.getElementById('upload');
const saveBtn = document.getElementById('save');
const gridSizeEl = document.getElementById('gridSize');
const gridSizeValueEl = document.getElementById('gridSizeValue');

// File upload elements
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');

// Background image state
let backgroundImage = null;
let backgroundImageData = null;

// Drawing state
let mode = 'pen'; // 'pen' | 'eraser'
let drawing = false;
let paths = []; // history stack: { color, size, op, points: [{x,y,pressure}] }
let redoStack = [];
let showGrid = false;

// Handle high-DPI and resize
function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    // Save current drawing to an offscreen canvas to preserve on resize
    const prev = document.createElement('canvas');
    prev.width = canvas.width; prev.height = canvas.height;
    if (prev.width && prev.height) {
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }
    canvas.width = w; canvas.height = h;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    // Redraw vector history for crispness
    redrawAll();
  }
}

window.addEventListener('resize', resizeCanvas);
// Initial size & scale
(function initSize(){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.scale(dpr, dpr);
})();

// Utilities
function pointFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
    pressure: (ev.pressure && ev.pressure > 0 ? ev.pressure : 1)
  };
}

function beginPathAt(p) {
  const stroke = {
    color: mode === 'pen' ? colorEl.value : backgroundColorEl.value,
    size: parseFloat(sizeEl.value),
    // Track intent: 'pen' draws ink, 'erase' removes ink (not background)
    op: mode === 'pen' ? 'pen' : 'erase',
    points: [p]
  };
  paths.push(stroke);
  redoStack.length = 0; // clear redo on new draw
  updateUndoRedoState();
}

function drawSegment(path, targetCtx) {
  if (path.points.length < 2) return;
  const c = targetCtx || ctx;
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = path.color;
  // Use last point's pressure for width variation
  const last = path.points[path.points.length - 1];
  const base = path.size;
  c.lineWidth = Math.max(0.5, base * (last.pressure || 1));

  const n = path.points.length;
  // Smooth with quadratic curves between midpoints
  c.beginPath();
  c.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < n - 1; i++) {
    const p0 = path.points[i];
    const p1 = path.points[i + 1];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    c.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  // Last segment
  const pn = path.points[n - 1];
  c.lineTo(pn.x, pn.y);
  c.stroke();
  c.restore();
}

function updateCanvasBackground() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
  // Fill with background color first
  ctx.fillStyle = backgroundColorEl.value;
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  
  // Draw background image if exists
  if (backgroundImage) {
    const canvasWidth = canvas.width / dpr;
    const canvasHeight = canvas.height / dpr;
    
    // Calculate scaling to fit image within canvas while maintaining aspect ratio
    const imgAspect = backgroundImage.width / backgroundImage.height;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let drawWidth, drawHeight, offsetX, offsetY;
    
    if (imgAspect > canvasAspect) {
      // Image is wider than canvas
      drawWidth = canvasWidth;
      drawHeight = canvasWidth / imgAspect;
      offsetX = 0;
      offsetY = (canvasHeight - drawHeight) / 2;
    } else {
      // Image is taller than canvas
      drawHeight = canvasHeight;
      drawWidth = canvasHeight * imgAspect;
      offsetX = (canvasWidth - drawWidth) / 2;
      offsetY = 0;
    }
    
    ctx.drawImage(backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
  }
  
  ctx.restore();
}

function drawGrid() {
  if (!showGrid) return;
  
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const canvasWidth = canvas.width / dpr;
  const canvasHeight = canvas.height / dpr;
  const gridSize = parseFloat(gridSizeEl.value); // Grid spacing in pixels
  
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(0, 0, 0)';
  ctx.lineWidth = 0.5;
  
  // Draw vertical lines
  for (let x = 0; x <= canvasWidth; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  
  // Draw horizontal lines
  for (let y = 0; y <= canvasHeight; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }
  
  ctx.restore();
}

function redrawAll() {
  // 1) Paint background to main canvas
  updateCanvasBackground();

  // 2) Draw grid if enabled
  drawGrid();

  // 3) Render strokes into an offscreen canvas so erasing only affects ink
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const offCtx = off.getContext('2d');
  offCtx.scale(dpr, dpr);
  

  for (const path of paths) {
    // Eraser should erase only ink, not the background fill
    offCtx.globalCompositeOperation = (path.op === 'erase') ? 'destination-out' : 'source-over';
    drawSegment(path, offCtx);
  }

  // 4) Composite the ink layer over the background and grid
  ctx.save();
  // Draw using device pixels; reset transform temporarily
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  // Restore DPR transform
  const currentDpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
  ctx.restore();
}

// Pointer (mouse/touch/pen) handling via Pointer Events
canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  drawing = true;
  beginPathAt(pointFromEvent(ev));
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drawing) return;
  const p = pointFromEvent(ev);
  const path = paths[paths.length - 1];
  path.points.push(p);
  // Incremental draw: redraw only the last path for performance
  redrawAll();
});

function endStroke(ev){
  if (!drawing) return;
  drawing = false;
  canvas.releasePointerCapture(ev.pointerId);
  // Ensure final render
  redrawAll();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerout', (ev)=>{ if (drawing) endStroke(ev); });

// Controls wiring
sizeEl.addEventListener('input', () => {
  sizeVal.textContent = sizeEl.value + ' px';
});

// Update grid size live while sliding
gridSizeEl.addEventListener('input', () => {
  gridSizeValueEl.textContent = gridSizeEl.value + ' px';
  if (showGrid) redrawAll();
});

backgroundColorEl.addEventListener('input', () => {
  updateCanvasBackground();
});

// File upload handling
fileInput.addEventListener('change', handleFileUpload);

function handleFileUpload() {
  const file = fileInput.files[0];
  if (!file) return;

  const fileType = file.type;
  
  if (fileType.startsWith("image/")) {
    // Handle image files
    const img = new Image();
    img.onload = () => {
      backgroundImage = img;
      removeBackgroundBtn.style.display = 'inline-block';
      redrawAll();
      showPreview(img, file.name);
    };
    img.src = URL.createObjectURL(file);
  } else if (fileType === "application/pdf") {
    // Handle PDF files - show preview but note that PDF background isn't supported yet
    showPreview(null, file.name, 'pdf');
  } else {
    alert('Unsupported file type. Please upload an image (PNG, JPG, JPEG) or PDF.');
  }
  
  // Reset file input
  fileInput.value = '';
}

function showPreview(img, fileName, fileType = 'image') {
  preview.innerHTML = '';
  
  if (fileType === 'pdf') {
    preview.innerHTML = `
      <button class="preview-close" onclick="closePreview()">×</button>
      <h3>PDF Uploaded: ${fileName}</h3>
      <p>PDF backgrounds are not yet supported for drawing. Please upload an image file instead.</p>
    `;
  } else if (img) {
    preview.innerHTML = `
      <button class="preview-close" onclick="closePreview()">×</button>
      <h3>Background Image: ${fileName}</h3>
      <img src="${img.src}" alt="Background preview">
      <p>Image has been set as background. You can now draw on top of it!</p>
    `;
  }
  
  preview.style.display = 'block';
}

function closePreview() {
  preview.style.display = 'none';
}

function removeBackground() {
  backgroundImage = null;
  removeBackgroundBtn.style.display = 'none';
  redrawAll();
  
  // Show confirmation
  preview.innerHTML = `
    <button class="preview-close" onclick="closePreview()">×</button>
    <h3>Background Removed</h3>
    <p>The background image has been removed. You can now upload a new one or continue drawing.</p>
  `;
  preview.style.display = 'block';
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    preview.style.display = 'none';
  }, 3000);
}

penBtn.addEventListener('click', () => {
  mode = 'pen'; penBtn.setAttribute('aria-pressed', 'true'); eraserBtn.removeAttribute('aria-pressed');
});
eraserBtn.addEventListener('click', () => {
  mode = 'eraser'; eraserBtn.setAttribute('aria-pressed', 'true'); penBtn.removeAttribute('aria-pressed');
});

gridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  gridBtn.setAttribute('aria-pressed', showGrid ? 'true' : 'false');
  redrawAll();
});

undoBtn.addEventListener('click', () => { undo(); });
redoBtn.addEventListener('click', () => { redo(); });
clearBtn.addEventListener('click', () => { clearBoard(); });
removeBackgroundBtn.addEventListener('click', () => { removeBackground(); });
uploadBtn.addEventListener('click', () => { fileInput.click(); });
saveBtn.addEventListener('click', () => { savePNG(); });

function updateUndoRedoState(){
  undoBtn.disabled = paths.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function undo(){
  if (paths.length === 0) return;
  const p = paths.pop();
  redoStack.push(p);
  updateUndoRedoState();
  redrawAll();
}
function redo(){
  if (redoStack.length === 0) return;
  const p = redoStack.pop();
  paths.push(p);
  updateUndoRedoState();
  redrawAll();
}

function clearBoard(){
  if (!paths.length) return;
  redoStack.push(...paths.reverse());
  paths = [];
  updateUndoRedoState();
  redrawAll();
}

// function savePNG(){
//   // Use CSS dimensions for perfect coordinate matching
//   const cssW = canvas.clientWidth;
//   const cssH = canvas.clientHeight;
  
//   // Create output canvas with CSS dimensions (no DPR scaling)
//   const out = document.createElement('canvas');
//   out.width = cssW;
//   out.height = cssH;
//   const octx = out.getContext('2d');
  
//   // No scaling - use 1:1 coordinates
//   octx.setTransform(1, 0, 0, 1, 0, 0);

//   // 1) Fill background color first
//   octx.fillStyle = backgroundColorEl.value;
//   octx.fillRect(0, 0, cssW, cssH);

//   // 2) Draw background image if exists (exact same logic as updateCanvasBackground)
//   if (backgroundImage) {
//     // Calculate scaling to fit image within canvas while maintaining aspect ratio
//     const imgAspect = backgroundImage.width / backgroundImage.height;
//     const canvasAspect = cssW / cssH;
    
//     let drawWidth, drawHeight, offsetX, offsetY;
    
//     if (imgAspect > canvasAspect) {
//       // Image is wider than canvas
//       drawWidth = cssW;
//       drawHeight = cssW / imgAspect;
//       offsetX = 0;
//       offsetY = (cssH - drawHeight) / 2;
//     } else {
//       // Image is taller than canvas
//       drawHeight = cssH;
//       drawWidth = cssH * imgAspect;
//       offsetX = (cssW - drawWidth) / 2;
//       offsetY = 0;
//     }
    
//     octx.drawImage(backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
//   }

//   // 3) Render ink layer with CSS dimensions (no DPR scaling)
//   const ink = document.createElement('canvas');
//   ink.width = cssW;
//   ink.height = cssH;
//   const inkCtx = ink.getContext('2d');
//   inkCtx.setTransform(1, 0, 0, 1, 0, 0);

//   for (const path of paths) {
//     inkCtx.globalCompositeOperation = (path.op === 'erase') ? 'destination-out' : 'source-over';
//     // draw path into inkCtx
//     inkCtx.save();
//     inkCtx.lineCap = 'round';
//     inkCtx.lineJoin = 'round';
//     inkCtx.strokeStyle = path.color;
//     inkCtx.lineWidth = path.size;
//     if (path.points.length > 1) {
//       inkCtx.beginPath();
//       inkCtx.moveTo(path.points[0].x, path.points[0].y);
//       for (let i = 1; i < path.points.length - 1; i++) {
//         const p0 = path.points[i]; const p1 = path.points[i+1];
//         const mx = (p0.x + p1.x)/2; const my = (p0.y + p1.y)/2;
//         inkCtx.quadraticCurveTo(p0.x, p0.y, mx, my);
//       }
//       const pn = path.points[path.points.length - 1];
//       inkCtx.lineTo(pn.x, pn.y);
//       inkCtx.stroke();
//     }
//     inkCtx.restore();
//   }

//   // 4) Composite ink over the background image
//   octx.drawImage(ink, 0, 0);

//   const url = out.toDataURL('image/png');
//   const a = document.createElement('a');
//   a.href = url; a.download = 'drawing.png';
//   a.click();
// }

function savePNG(){
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // Create output canvas at device-pixel resolution
  const out = document.createElement('canvas');
  out.width = cssW * dpr;
  out.height = cssH * dpr;
  const octx = out.getContext('2d');
  octx.scale(dpr, dpr);

  // 1) Fill background
  octx.fillStyle = backgroundColorEl.value;
  octx.fillRect(0, 0, cssW, cssH);

  // 2) Draw background image if exists
  if (backgroundImage) {
    const imgAspect = backgroundImage.width / backgroundImage.height;
    const canvasAspect = cssW / cssH;
    let drawWidth, drawHeight, offsetX, offsetY;

    if (imgAspect > canvasAspect) {
      drawWidth = cssW;
      drawHeight = cssW / imgAspect;
      offsetX = 0;
      offsetY = (cssH - drawHeight) / 2;
    } else {
      drawHeight = cssH;
      drawWidth = cssH * imgAspect;
      offsetX = (cssW - drawWidth) / 2;
      offsetY = 0;
    }
    octx.drawImage(backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
  }

  // 3) Render ink layer using the same drawSegment logic
  for (const path of paths) {
    octx.globalCompositeOperation = (path.op === 'erase') ? 'destination-out' : 'source-over';
    drawSegment(path, octx); // ✅ reuse the same function you use on screen
  }

  // 4) Downscale to CSS resolution for saving (so file size matches screen size)
  const final = document.createElement('canvas');
  final.width = cssW;
  final.height = cssH;
  final.getContext('2d').drawImage(out, 0, 0, cssW, cssH);

  // Save as PNG
  const url = final.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  if (backgroundImage && backgroundImage.src) {
    // Try to extract filename from image src (object URL or file path)
    let fname = '';
    try {
      const urlObj = new URL(backgroundImage.src, window.location.href);
      // If object URL, get last part after '/'
      fname = urlObj.pathname.split('/').pop() || 'background';
      // Remove query string if present
      fname = fname.split('?')[0];
      // Remove extension
      fname = fname.replace(/\.[^/.]+$/, "");
    } catch(e) {
      fname = 'background';
    }
    a.download = 'updated-' + fname + '.png';
  } else {
    a.download = 'drawing.png';
  }
  a.click();
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) redo(); else undo();
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'e') {
    mode = 'eraser'; eraserBtn.setAttribute('aria-pressed', 'true'); penBtn.removeAttribute('aria-pressed');
  } else if (e.key.toLowerCase() === 'p') {
    mode = 'pen'; penBtn.setAttribute('aria-pressed', 'true'); eraserBtn.removeAttribute('aria-pressed');
  } else if (e.key.toLowerCase() === 'c') {
    clearBoard();
  } else if (e.key.toLowerCase() === 's') {
    savePNG(); e.preventDefault();
  } else if (e.key.toLowerCase() === 'u') {
    fileInput.click(); e.preventDefault();
  } else if (e.key.toLowerCase() === 'r') {
    if (backgroundImage) {
      removeBackground(); e.preventDefault();
    }
  } else if (e.key.toLowerCase() === 'g') {
    showGrid = !showGrid;
    gridBtn.setAttribute('aria-pressed', showGrid ? 'true' : 'false');
    redrawAll();
    e.preventDefault();
  }
});

// Finalize
resizeCanvas();
updateCanvasBackground();
