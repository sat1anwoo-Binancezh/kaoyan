import * as pdfjs from './vendor/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

export function createLayout(root, documents, onError) {
  const pdfs = new Map();
  const glyphs = new Map();
  let observer;
  let displayed = [];
  let sections = [];

  function getPdf(id) {
    if (!pdfs.has(id)) {
      pdfs.set(id, pdfjs.getDocument(new URL(`./subjective-pdf/${id}.pdf`, import.meta.url).href).promise.catch(error => {
        pdfs.delete(id);
        throw error;
      }));
    }
    return pdfs.get(id);
  }

  async function paintPage(surface) {
    if (surface.loading || surface.canvas) return;
    surface.loading = true;
    try {
      const pdf = await getPdf(surface.id);
      const page = await pdf.getPage(surface.page + 1);
      if (!surface.visible || !surface.node.isConnected) return;
      const scale = Math.min(3, Math.max(1.35, surface.node.clientWidth / surface.width * (devicePixelRatio || 1)));
      const viewport = page.getViewport({scale});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil((surface.bottom - surface.top) * viewport.height / surface.height);
      const translateY = -surface.top * viewport.height / surface.height;
      await page.render({canvas, viewport, transform: [1, 0, 0, 1, 0, translateY]}).promise;
      if (!surface.visible || !surface.node.isConnected) return;
      surface.node.prepend(canvas);
      surface.canvas = canvas;
    } catch (error) {
      if (surface.node.isConnected) {
        surface.node.dataset.error = '原版页面载入失败，请刷新重试。';
        onError(error);
      }
    } finally {
      surface.loading = false;
    }
  }

  function addSurface(parent, doc, pageIndex, top, bottom, first = 0, last = doc.text.length) {
    const page = doc.layout.pages[pageIndex];
    const [width, height] = page.size;
    const span = bottom - top;
    const node = document.createElement('div');
    node.className = 'pdf-surface';
    node.style.aspectRatio = `${width} / ${span}`;
    const layer = document.createElement('div');
    layer.className = 'glyph-layer';
    const entries = [];
    let previous;
    for (const [index, x, y, w, h] of page.glyphs) {
      if (index < first || index >= last) continue;
      if (previous !== undefined) {
        const gap = doc.text.slice(previous + 1, index);
        if (gap && !gap.trim()) layer.append(gap);
      }
      const element = document.createElement('span');
      element.className = 'pdf-glyph';
      const char = doc.text[index];
      const size = Math.min(h, /[\u3000-\uffff]/.test(char) ? w : w * 1.65);
      element.style.cssText = `left:${x / width * 100}%;top:${(y - top) / span * 100}%;width:${w / width * 100}%;height:${h / span * 100}%;font-size:${size / width * 100}cqw`;
      element.textContent = doc.text[index];
      layer.append(element);
      const glyph = {document: doc.id, index, element, text: element.firstChild, page: pageIndex, y};
      displayed.push(glyph);
      entries.push(glyph);
      glyphs.set(`${doc.id}:${index}`, glyph);
      previous = index;
    }
    node.append(layer);
    parent.append(node);
    const surface = {node, id: doc.id, page: pageIndex, width, height, top, bottom, entries};
    sections.push(surface);
  }

  function show(id, order) {
    observer?.disconnect();
    glyphs.clear();
    displayed = [];
    sections = [];
    const fragment = document.createDocumentFragment();
    if (order === 'original') {
      const doc = documents.get(id);
      doc.layout.pages.forEach((page, index) => addSurface(fragment, doc, index, 0, page.size[1]));
    } else {
      const scope = order === 'all-frequency' ? [...documents.values()] : [documents.get(id)];
      const topics = scope.flatMap(doc => doc.layout.topics.map(topic => ({doc, topic}))).sort((a, b) => b.topic.frequency - a.topic.frequency);
      for (const {doc, topic} of topics) {
        const card = document.createElement('article');
        card.className = 'pdf-topic';
        card.dataset.frequency = topic.frequency;
        card.setAttribute('aria-label', `${doc.name} ${topic.label} ${topic.frequency}次`);
        const label = document.createElement('div');
        label.className = 'topic-meta';
        label.textContent = `${doc.name} · ${topic.frequency} 次`;
        card.append(label);
        for (const [page, top, bottom] of topic.regions) addSurface(card, doc, page, top, bottom, topic.start, topic.end);
        fragment.append(card);
      }
    }
    root.replaceChildren(fragment);
    const byNode = new Map(sections.map(surface => [surface.node, surface]));
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const surface = byNode.get(entry.target);
        if (!surface) continue;
        surface.visible = entry.isIntersecting;
        if (surface.visible) paintPage(surface);
        else if (surface.canvas) {
          surface.canvas.remove();
          surface.canvas.width = 0;
          surface.canvas = null;
        }
      }
    }, {rootMargin: '550px 0px'});
    for (const surface of sections) observer.observe(surface.node);
  }

  function highlight(excerpts) {
    const byDoc = Map.groupBy ? Map.groupBy(excerpts, item => item.document) : new Map([...documents.keys()].map(id => [id, excerpts.filter(item => item.document === id)]));
    for (const glyph of displayed) {
      const active = byDoc.get(glyph.document)?.some(item => glyph.index >= item.start && glyph.index < item.end);
      glyph.element.classList.toggle('collected', Boolean(active));
    }
  }

  function selectedRanges(range) {
    const ranges = [];
    for (const glyph of displayed) {
      if (!range.intersectsNode(glyph.text)) continue;
      if (range.startContainer === glyph.text && range.startOffset >= glyph.text.length) continue;
      if (range.endContainer === glyph.text && range.endOffset === 0) continue;
      const last = ranges.at(-1);
      if (last?.document === glyph.document && last.end <= glyph.index && !documents.get(glyph.document).text.slice(last.end, glyph.index).trim()) {
        last.end = glyph.index + glyph.text.length;
      } else {
        ranges.push({document: glyph.document, start: glyph.index, end: glyph.index + glyph.text.length});
      }
    }
    return ranges;
  }

  function at(screenY) {
    const section = sections.find(item => item.node.getBoundingClientRect().bottom > screenY) ?? sections.at(-1);
    if (!section?.entries.length) return null;
    const rect = section.node.getBoundingClientRect();
    const y = section.top + (screenY - rect.top) / rect.height * (section.bottom - section.top);
    const glyph = section.entries.find(item => item.y >= y - 2) ?? section.entries.at(-1);
    return {document: glyph.document, offset: glyph.index};
  }

  function jump(id, offset, screenY) {
    const exact = glyphs.get(`${id}:${offset}`);
    const next = exact ?? displayed.find(g => g.document === id && g.index >= offset);
    if (!next) return false;
    window.scrollTo(0, Math.max(0, window.scrollY + next.element.getBoundingClientRect().top - screenY));
    return true;
  }

  return {show, highlight, selectedRanges, at, jump};
}
