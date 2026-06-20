// Preview utility functions — depend on globals: chapters, _customUnit, _chapterExportFilter
// and functions: getV(), zoomFit(), renderPreview()

export function getV(id) {
  return document.getElementById(id).value;
}

export function getCustomDimsInMM() {
  const w = parseFloat(document.getElementById('customW')?.value) || 148;
  const h = parseFloat(document.getElementById('customH')?.value) || 210;
  if (typeof _customUnit !== 'undefined' && _customUnit === 'in') return [w * 25.4, h * 25.4];
  return [w, h];
}

export function getPageDims() {
  const map = { trade: [152.4, 228.6], pocket: [127, 203.2], digest: [139.7, 215.9], a4: [210, 297], letter: [215.9, 279.4] };
  const val = getV('pageSize');
  if (val === 'custom') return getCustomDimsInMM();
  return map[val] || map.trade;
}

export function getChapters() {
  const all = chapters.filter(c => c.type === 'chapter');
  if (!_chapterExportFilter) return all;
  return all.filter(c => c.id === _chapterExportFilter);
}

export function getFront() {
  if (!_chapterExportFilter) return chapters.filter(c => c.type === 'pre');
  const ch = chapters.find(c => c.id === _chapterExportFilter);
  return (ch && ch.type === 'pre') ? [ch] : [];
}

export function getBack() {
  if (!_chapterExportFilter) return chapters.filter(c => c.type === 'post');
  const ch = chapters.find(c => c.id === _chapterExportFilter);
  return (ch && ch.type === 'post') ? [ch] : [];
}

export function setPreviewSize(val) {
  // Show/hide custom size inputs
  const ci = document.getElementById('customSizeInputs');
  if (ci) ci.style.display = val === 'custom' ? 'flex' : 'none';
  // Keep the Design tab select in sync (custom not in Design tab — that's fine)
  const ds = document.getElementById('pageSize');
  if (ds && val !== 'custom') ds.value = val;
  // Keep toolbar select in sync
  const ts = document.getElementById('toolbarPageSize');
  if (ts) ts.value = val;
  if (typeof zoomFit === 'function') zoomFit();
}
