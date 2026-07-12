import { initCrystal } from "./crystal.js";
import { PASSPORT_SPECS, BACKGROUND_OPTIONS, specPixels } from "./passport-specs.js";
import { computeMask } from "./background-removal.js";
import { composeCutout, renderPassport, buildPrintSheet, canvasToBlob, downloadBlob, DEFAULT_ADJUST } from "./passport-render.js";

const $ = id => document.getElementById(id);

// State
let phase = "upload";
let cutout = null;
let specId = PASSPORT_SPECS[0].id;
let bgColor = BACKGROUND_OPTIONS[0].color;
let adjust = { ...DEFAULT_ADJUST };
let showGuides = true;
let format = "jpeg";
let backend = null;
let timings = null;
let busy = false;

// Views
const views = { upload:$("uploadView"), processing:$("processingView"), result:$("resultView") };
function setPhase(p){
  phase = p;
  for (const [k,el] of Object.entries(views)) el.classList.toggle("hidden", k !== p);
  if (p === "upload" && !crystalTeardown) startCrystal();
  if (p !== "upload" && crystalTeardown){ crystalTeardown(); crystalTeardown = null; }
}

// Crystal (only on landing)
let crystalTeardown = null;
function startCrystal(){
  crystalTeardown = initCrystal($("crystalCanvas"), $("crystalBox"));
}
startCrystal();

// Header dropdowns
const profileBtn = $("profileBtn"), menuBtn = $("menuBtn");
const profileMenu = $("profileMenu"), menuMenu = $("menuMenu");
function closeMenus(){ profileMenu.classList.add("hidden"); menuMenu.classList.add("hidden"); profileBtn.setAttribute("aria-expanded","false"); menuBtn.setAttribute("aria-expanded","false"); }
profileBtn.addEventListener("click", e => { e.stopPropagation(); const open = profileMenu.classList.toggle("hidden"); menuMenu.classList.add("hidden"); profileBtn.setAttribute("aria-expanded", String(!open)); menuBtn.setAttribute("aria-expanded","false"); });
menuBtn.addEventListener("click", e => { e.stopPropagation(); const open = menuMenu.classList.toggle("hidden"); profileMenu.classList.add("hidden"); menuBtn.setAttribute("aria-expanded", String(!open)); profileBtn.setAttribute("aria-expanded","false"); });
document.addEventListener("click", e => { if (!e.target.closest(".btnGroup")) closeMenus(); });
menuMenu.addEventListener("click", e => {
  const btn = e.target.closest(".ddItem"); if (!btn) return;
  if (btn.dataset.action === "new") reset();
  closeMenus();
});
profileMenu.addEventListener("click", e => { if (e.target.closest(".ddItem")) closeMenus(); });

// Upload
const drop = $("drop"), fileInput = $("fileInput"), pickBtn = $("pickBtn"), uploadError = $("uploadError");
pickBtn.addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });
fileInput.addEventListener("change", e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; });

async function fileToSourceCanvas(file){
  const bitmap = await createImageBitmap(file, { imageOrientation:"from-image" });
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width*scale));
  const h = Math.max(1, Math.round(bitmap.height*scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

function showError(el, msg){ if (!msg){ el.classList.add("hidden"); return; } el.textContent = msg; el.classList.remove("hidden"); }

async function handleFile(file){
  if (!file.type.startsWith("image/")){ showError(uploadError, "Please choose an image file (JPG or PNG)."); return; }
  showError(uploadError, null);
  backend = null; timings = null;
  adjust = { ...DEFAULT_ADJUST };
  setPhase("processing");
  updateProc("download", null);

  try {
    const t0 = performance.now();
    const source = await fileToSourceCanvas(file);
    const mask = await computeMask(source, p => updateProc(p.stage, p.total ? Math.round((p.loaded/p.total)*100) : null));
    cutout = composeCutout(source, mask.maskCanvas, source.width, source.height);
    backend = mask.backend;
    timings = { inference: mask.inferenceMs, total: performance.now() - t0 };
    renderBackendBadge();
    setPhase("result");
    renderResult();
  } catch (err){
    console.error(err);
    showError(uploadError, err instanceof Error ? err.message : "Something went wrong while processing.");
    setPhase("upload");
  }
}

function updateProc(stage, pct){
  const t = $("procTitle"), s = $("procSub");
  if (stage === "download"){ t.textContent = "Loading AI model…"; s.textContent = pct != null ? `${pct}% downloaded` : "Preparing model…"; }
  else if (stage === "compile"){ t.textContent = "Preparing AI…"; s.textContent = "Compiling model for your device."; }
  else if (stage === "ready"){ t.textContent = "Removing background…"; s.textContent = "Almost there."; }
}

function renderBackendBadge(){
  const el = $("backendBadge");
  if (!backend){ el.classList.add("hidden"); return; }
  el.textContent = backend === "webgpu" ? "⚡ WebGPU" : "WASM";
  el.classList.remove("hidden");
}

// Result view
const specSelect = $("specSelect"), specMeta = $("specMeta");
PASSPORT_SPECS.forEach(s => {
  const o = document.createElement("option"); o.value = s.id; o.textContent = s.label; specSelect.appendChild(o);
});
specSelect.addEventListener("change", () => { specId = specSelect.value; renderResult(); });

const bgSwatches = $("bgSwatches");
BACKGROUND_OPTIONS.forEach(b => {
  const btn = document.createElement("button");
  btn.className = "sw"; btn.style.backgroundColor = b.color; btn.title = b.label;
  btn.addEventListener("click", () => { bgColor = b.color; renderResult(); });
  bgSwatches.appendChild(btn);
});
const colorLabel = document.createElement("label");
colorLabel.className = "swColor"; colorLabel.title = "Custom color"; colorLabel.textContent = "+";
const colorInput = document.createElement("input");
colorInput.type = "color"; colorInput.value = bgColor;
colorInput.addEventListener("input", e => { bgColor = e.target.value; renderResult(); });
colorLabel.appendChild(colorInput);
bgSwatches.appendChild(colorLabel);

document.querySelectorAll(".fmtBtn").forEach(b => {
  b.addEventListener("click", () => {
    format = b.dataset.fmt;
    document.querySelectorAll(".fmtBtn").forEach(x => x.classList.toggle("active", x === b));
  });
});

$("zoom").addEventListener("input", e => { adjust.zoom = +e.target.value; renderPreview(); });
$("offY").addEventListener("input", e => { adjust.offsetY = +e.target.value; renderPreview(); });
$("offX").addEventListener("input", e => { adjust.offsetX = +e.target.value; renderPreview(); });
$("guidesChk").addEventListener("change", e => { showGuides = e.target.checked; renderPreview(); });
$("resetFrame").addEventListener("click", () => {
  adjust = { ...DEFAULT_ADJUST };
  $("zoom").value = 1; $("offY").value = 0; $("offX").value = 0;
  renderPreview();
});
$("newBtn").addEventListener("click", reset);
$("dlSingle").addEventListener("click", () => download("single"));
$("dlSheet").addEventListener("click", () => download("sheet"));

function reset(){
  cutout = null;
  showError(uploadError, null);
  setPhase("upload");
}

function renderResult(){
  const spec = PASSPORT_SPECS.find(s => s.id === specId) || PASSPORT_SPECS[0];
  const px = specPixels(spec);
  specMeta.textContent = `${spec.widthMM}×${spec.heightMM} mm · ${px.width}×${px.height}px · ${spec.dpi} DPI`;
  Array.from(bgSwatches.querySelectorAll(".sw")).forEach((btn, i) => btn.classList.toggle("active", BACKGROUND_OPTIONS[i].color === bgColor));
  if (timings){
    $("timings").textContent = `Processed in ${(timings.total/1000).toFixed(2)}s · AI inference ${Math.round(timings.inference)}ms`;
  }
  renderPreview();
}

function renderPreview(){
  if (phase !== "result" || !cutout) return;
  const spec = PASSPORT_SPECS.find(s => s.id === specId) || PASSPORT_SPECS[0];
  const rendered = renderPassport(cutout, spec, bgColor, adjust);
  const display = $("previewCanvas");
  const maxSide = 520;
  const scale = Math.min(maxSide / rendered.width, maxSide / rendered.height, 1.6);
  display.width = Math.round(rendered.width * scale);
  display.height = Math.round(rendered.height * scale);
  const ctx = display.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, display.width, display.height);
  ctx.drawImage(rendered, 0, 0, display.width, display.height);
  if (showGuides){
    const W = display.width, H = display.height;
    ctx.save();
    ctx.strokeStyle = "rgba(192, 100, 250, 0.6)";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    [0.1, 0.86].forEach(f => { ctx.beginPath(); ctx.moveTo(0, H*f); ctx.lineTo(W, H*f); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
    ctx.restore();
  }
}

async function download(kind){
  if (!cutout || busy) return;
  busy = true;
  $("dlSingle").disabled = true; $("dlSheet").disabled = true;
  showError($("resultError"), null);
  try {
    const spec = PASSPORT_SPECS.find(s => s.id === specId) || PASSPORT_SPECS[0];
    const photo = renderPassport(cutout, spec, bgColor, adjust);
    const target = kind === "sheet" ? buildPrintSheet(photo, spec) : photo;
    const type = format === "png" ? "image/png" : "image/jpeg";
    const ext = format === "png" ? "png" : "jpg";
    const blob = await canvasToBlob(target, type, format === "jpeg" ? 0.95 : undefined);
    const name = kind === "sheet" ? `passport-4x6-sheet.${ext}` : `passport-${spec.id}.${ext}`;
    downloadBlob(blob, name);
  } catch (err){
    console.error(err);
    showError($("resultError"), "Could not export the image.");
  } finally {
    busy = false;
    $("dlSingle").disabled = false; $("dlSheet").disabled = false;
  }
}
