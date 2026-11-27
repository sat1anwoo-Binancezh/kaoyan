const $ = id => document.getElementById(id);
const body = $('body');
const storageKey = 'politics-subjective-pdf-text-v1';
const emptyState = () => ({excerpts: [], bookmarks: [], positions: {}, document: '34'});
let state = emptyState();
let documents = new Map();
let current, toastTimer, positionTimer;
let reading = true;

function toast(message, undo) {
  clearTimeout(toastTimer);
  const status = $('toast');
  status.textContent = message;
  if (undo) {
    const button = document.createElement('button');
    button.textContent = '撤销';
    button.onclick = undo;
    status.append(button);
  }
  status.hidden = false;
  toastTimer = setTimeout(() => status.hidden = true, undo ? 12000 : 3000);
}

function save(next = state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    state = next;
    return true;
  } catch {
    toast('浏览器未能保存，请检查存储空间或导出已有备份。');
    return false;
  }
}

function updateCount() {
  $('count').textContent = state.excerpts.length;
  $('bookmarkCount').textContent = state.bookmarks.length;
}

function renderText() {
  const spans = state.excerpts.filter(item => item.document === current.id).sort((a, b) => a.start - b.start);
  const output = document.createDocumentFragment();
  let start = 0;
  let index = 0;
  for (const line of current.text.split('\n')) {
    const row = document.createElement('span');
    if (line.startsWith('考点')) row.className = 'section-title';
    if (line.startsWith('频次')) row.className = 'frequency';
    const end = start + line.length;
    let cursor = start;
    while (index < spans.length && spans[index].end <= start) index++;
    for (let i = index; i < spans.length && spans[i].start < end; i++) {
      const item = spans[i];
      const a = Math.max(cursor, item.start), b = Math.min(end, item.end);
      if (a >= b) continue;
      row.append(current.text.slice(cursor, a));
      const mark = document.createElement('mark');
      mark.textContent = current.text.slice(a, b);
      row.append(mark);
      cursor = b;
    }
    row.append(current.text.slice(cursor, end));
    if (start) output.append('\n');
    output.append(row);
    start = end + 1;
  }
  body.replaceChildren(output);
  updateCount();
}

function selectionOffsets() {
  const selection = window.getSelection();
  if (!current || !reading || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(body);
  prefix.setEnd(range.startContainer, range.startOffset);
  let start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  let end = prefix.toString().length;
  while (start < end && /\s/.test(current.text[start])) start++;
  while (start < end && /\s/.test(current.text[end - 1])) end--;
  return end > start ? {start, end} : null;
}

function labelFor(documentId, start) {
  const doc = documents.get(documentId);
  const headings = doc.text.slice(0, start).match(/^考点[^\n]+/gm);
  return headings?.at(-1) || doc.name;
}

const hasText = (documentId, start, end) => end > start && documents.get(documentId).text.slice(start, end).trim() !== '';
const excerptId = (documentId, start, end) => `${documentId}-${start}-${end}`;
function toggleSelection() {
  const range = selectionOffsets();
  if (!range) {
    toast('请先框选主观题正文。');
    return;
  }
  const {start, end} = range;
  const documentId = current.id;
  const before = state.excerpts;
  const overlapping = before.filter(item => item.document === documentId && item.start < end && item.end > start).sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = start;
  for (const item of overlapping) {
    if (hasText(documentId, cursor, item.start)) gaps.push([cursor, item.start]);
    cursor = Math.max(cursor, item.end);
  }
  if (hasText(documentId, cursor, end)) gaps.push([cursor, end]);
  const create = (a, b, prior = {}) => ({
    id: excerptId(documentId, a, b), document: documentId, start: a, end: b,
    note: prior.note ?? '', created: prior.created ?? Date.now()
  });
  let next;
  if (gaps.length) {
    next = [...before, ...gaps.map(([a, b]) => create(a, b))];
  } else {
    next = before.filter(item => !overlapping.includes(item));
    for (const item of overlapping) {
      if (hasText(documentId, item.start, start)) next.push(create(item.start, start, item));
      if (hasText(documentId, end, item.end)) next.push(create(end, item.end, item));
    }
  }
  if (!save({...state, excerpts: next})) return;
  window.getSelection().removeAllRanges();
  renderText();
  toast(gaps.length ? '已标黄并加入积累本' : '已取消选中文字的摘录', () => restoreExcerpts(before));
}

function restoreExcerpts(excerpts) {
  if (!save({...state, excerpts})) return;
  renderText();
  if (!reading) renderNotes();
  toast('已撤销');
}

function renderNotes() {
  const list = $('notebook');
  list.replaceChildren();
  if (!state.excerpts.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '积累本为空。回到原文框选文字，按 R 收录。';
    list.append(empty);
    return;
  }
  for (const item of [...state.excerpts].sort((a, b) => a.created - b.created || a.start - b.start)) {
    const card = document.createElement('article');
    card.className = 'excerpt';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const label = document.createElement('span');
    label.textContent = `${documents.get(item.document).name} · ${labelFor(item.document, item.start)}`;
    const back = document.createElement('button');
    back.textContent = '回到原文';
    back.onclick = () => openDocument(item.document, item.start);
    const remove = document.createElement('button');
    remove.textContent = '移出积累本';
    remove.onclick = () => {
      const before = state.excerpts;
      if (!save({...state, excerpts: before.filter(entry => entry.id !== item.id)})) return;
      updateCount();
      renderNotes();
      toast('已移出积累本', () => restoreExcerpts(before));
    };
    actions.append(label, back, remove);
    const clip = document.createElement('div');
    clip.className = 'clip';
    const mark = document.createElement('mark');
    mark.textContent = documents.get(item.document).text.slice(item.start, item.end);
    clip.append(mark);
    const note = document.createElement('input');
    note.placeholder = '自己的备注（可选）';
    note.setAttribute('aria-label', '摘录备注');
    note.value = item.note;
    note.onchange = () => save({...state, excerpts: state.excerpts.map(entry => entry.id === item.id ? {...entry, note: note.value} : entry)});
    card.append(actions, clip, note);
    list.append(card);
  }
}

function anchor() {
  return document.querySelector('header').getBoundingClientRect().bottom + 14;
}

function offsetAtReadingPosition() {
  const rect = body.getBoundingClientRect();
  if (!body.firstChild || rect.top > anchor()) return 0;
  const x = rect.left + 3, y = Math.min(anchor(), innerHeight - 1);
  const hit = document.caretRangeFromPoint?.(x, y);
  if (hit && body.contains(hit.startContainer)) {
    const range = document.createRange();
    range.selectNodeContents(body);
    range.setEnd(hit.startContainer, hit.startOffset);
    return range.toString().length;
  }
  let offset = 0;
  for (const child of body.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && child.getBoundingClientRect().bottom > anchor()) break;
    offset += child.textContent.length;
  }
  return offset;
}

function jumpToOffset(offset) {
  if (!offset) {
    window.scrollTo(0, 0);
    return;
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (offset >= node.length) { offset -= node.length; continue; }
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();
    if (rect.height) window.scrollTo(0, window.scrollY + rect.top - anchor());
    return;
  }
}

function rememberPosition() {
  clearTimeout(positionTimer);
  if (!reading || !current) return;
  const offset = offsetAtReadingPosition();
  if (offset !== state.positions[current.id] || state.document !== current.id) {
    save({...state, document: current.id, positions: {...state.positions, [current.id]: offset}});
  }
}

function showReading(on) {
  reading = on;
  $('reading').hidden = !on;
  $('notebook').hidden = on;
  $('noteTools').hidden = on;
  $('subjects').hidden = !on;
  $('resume').hidden = !on;
  $('addBookmark').hidden = !on;
  $('bookTab').classList.toggle('active', on);
  $('notesTab').classList.toggle('active', !on);
  $('bookTab').setAttribute('aria-pressed', String(on));
  $('notesTab').setAttribute('aria-pressed', String(!on));
}

function openDocument(id, offset) {
  if (!documents.has(id)) return;
  if (current && current.id !== id) rememberPosition();
  current = documents.get(id);
  showReading(true);
  $('subjects').value = id;
  $('title').textContent = `${current.name}（第 ${id} 题）`;
  $('source').textContent = `研之道 · ${current.file}`;
  renderText();
  jumpToOffset(offset ?? state.positions[id] ?? 0);
  if (state.document !== id) save({...state, document: id});
}

function renderBookmarks() {
  const list = $('bookmarkList');
  list.replaceChildren();
  updateCount();
  if (!state.bookmarks.length) list.textContent = '暂无书签。';
  for (const bookmark of state.bookmarks) {
    const row = document.createElement('div');
    row.className = 'bookmark-row';
    const name = document.createElement('input');
    name.value = bookmark.label;
    name.setAttribute('aria-label', '书签名称');
    name.onchange = () => save({...state, bookmarks: state.bookmarks.map(item => item.id === bookmark.id ? {...item, label: name.value.trim() || bookmark.label} : item)});
    const go = document.createElement('button');
    go.textContent = '跳转';
    go.onclick = () => { $('bookmarkDialog').close(); openDocument(bookmark.document, bookmark.offset); };
    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.onclick = () => {
      const before = state.bookmarks;
      if (!save({...state, bookmarks: before.filter(item => item.id !== bookmark.id)})) return;
      renderBookmarks();
      toast('已删除书签', () => { if (save({...state, bookmarks: before})) { renderBookmarks(); toast('已撤销'); } });
    };
    row.append(name, go, remove);
    list.append(row);
  }
}

function validOffset(id, value) {
  return documents.has(id) && Number.isInteger(value) && value >= 0 && value <= documents.get(id).text.length;
}

function validate(data) {
  if (!data || !Array.isArray(data.excerpts) || !Array.isArray(data.bookmarks)) throw new Error('Invalid backup');
  const excerpts = data.excerpts.map(item => {
    if (!validOffset(item.document, item.start) || !validOffset(item.document, item.end) || !hasText(item.document, item.start, item.end) || typeof item.note !== 'string') throw new Error('Invalid excerpt');
    const {document, start, end, note} = item;
    return {id: excerptId(document, start, end), document, start, end, note, created: Number.isFinite(item.created) ? item.created : Date.now()};
  });
  const bookmarks = data.bookmarks.map(item => {
    const {id, document, offset, label} = item;
    if (typeof id !== 'string' || typeof label !== 'string' || !validOffset(document, offset)) throw new Error('Invalid bookmark');
    return {id, document, offset, label};
  });
  const positions = Object.fromEntries(Object.entries(data.positions || {}).filter(([id, value]) => validOffset(id, value)));
  return {excerpts, bookmarks, positions, document: documents.has(data.document) ? data.document : '34'};
}

$('toggleSelection').onmousedown = event => event.preventDefault();
$('toggleSelection').onclick = toggleSelection;
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'r' || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.target.closest?.('input, textarea, select, [contenteditable]') || !selectionOffsets()) return;
  event.preventDefault();
  toggleSelection();
});
$('bookTab').onclick = () => { if (current && !reading) openDocument(current.id); };
$('notesTab').onclick = () => { rememberPosition(); showReading(false); renderNotes(); window.scrollTo(0, 0); };
$('subjects').onchange = event => openDocument(event.target.value);
$('resume').onclick = () => { if (current) jumpToOffset(state.positions[current.id] ?? 0); };
$('addBookmark').onclick = () => {
  if (!current) return;
  const offset = offsetAtReadingPosition();
  if (state.bookmarks.some(item => item.document === current.id && item.offset === offset)) return toast('当前位置已有书签');
  const bookmark = {id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, document: current.id, offset, label: `${current.name} · ${labelFor(current.id, offset)}`};
  if (save({...state, bookmarks: [...state.bookmarks, bookmark]})) { updateCount(); toast('已添加当前位置书签'); }
};
$('openBookmarks').onclick = () => { renderBookmarks(); $('bookmarkDialog').showModal(); };
$('closeBookmarks').onclick = () => $('bookmarkDialog').close();
$('print').onclick = () => window.print();
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, book: 'politics-subjective-2027', ...state})], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = '政治主观题积累本备份.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5000000) throw new Error('Backup too large');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || data.book !== 'politics-subjective-2027') throw new Error('Wrong backup type');
    const imported = validate(data);
    const merge = (a, b) => [...new Map([...a, ...b].map(item => [item.id, item])).values()];
    if (save({...state, excerpts: merge(state.excerpts, imported.excerpts), bookmarks: merge(state.bookmarks, imported.bookmarks), positions: {...state.positions, ...imported.positions}})) {
      renderText(); renderNotes(); toast('已合并导入主观题积累与书签');
    }
  } catch {
    toast('导入失败，请选择主观题积累本导出的备份。');
  } finally {
    event.target.value = '';
  }
};
window.addEventListener('scroll', () => {
  clearTimeout(positionTimer);
  if (reading) positionTimer = setTimeout(rememberPosition, 180);
}, {passive: true});
window.addEventListener('pagehide', rememberPosition);
try { history.scrollRestoration = 'manual'; } catch {}

try {
  const response = await fetch('./subjective-data.json?v=1');
  if (!response.ok) throw new Error('Text unavailable');
  documents = new Map((await response.json()).map(doc => [doc.id, doc]));
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) state = validate(JSON.parse(raw));
  } catch {
    toast('已有记录未能读取。');
  }
  for (const doc of documents.values()) $('subjects').add(new Option(`${doc.name} · 第 ${doc.id} 题`, doc.id));
  openDocument(state.document);
} catch {
  $('title').textContent = '主观题原文载入失败，请刷新重试。';
}
