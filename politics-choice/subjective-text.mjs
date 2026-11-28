export function createLayout(root, documents) {
  let displayed = [];

  function content(parent, doc, start, end, styles) {
    displayed.push({node: parent, doc, start, end, styles});
  }

  function paint({node, doc, start, end, styles}, excerpts) {
    const boundaries = new Set([start, end]);
    const applicable = excerpts.filter(item => item.start < end && item.end > start);
    for (const [a, b] of [...styles, ...applicable.map(item => [item.start, item.end])]) {
      if (a > start && a < end) boundaries.add(a);
      if (b > start && b < end) boundaries.add(b);
    }
    const points = [...boundaries].sort((a,b) => a-b);
    const fragment = document.createDocumentFragment();
    for (let i = 1; i < points.length; i++) {
      const left = points[i - 1], right = points[i];
      const text = doc.text.slice(left, right);
      const style = styles.find(([a, b]) => left >= a && left < b)?.[2] ?? '';
      const highlighted = applicable.some(item => left >= item.start && left < item.end);
      if (!style && !highlighted) {
        fragment.append(text);
        continue;
      }
      const span = document.createElement(highlighted ? 'mark' : style.includes('bold') ? 'strong' : 'span');
      span.className = style + (highlighted ? ' collected' : '');
      span.textContent = text;
      fragment.append(span);
    }
    node.replaceChildren(fragment);
  }

  function appendBlocks(parent, doc, start, end) {
    let tableBody;
    for (const [kind, left, right, styles, codeEnd, questionStart] of doc.blocks.slice(start, end)) {
      if (kind === 'question') {
        if (!tableBody) {
          const table = document.createElement('table');
          table.className = 'question-table';
          table.setAttribute('aria-label', '考过的题目');
          tableBody = table.createTBody();
          parent.append(table);
        }
        const row = tableBody.insertRow();
        const code = row.insertCell(), text = row.insertCell();
        code.className = 'question-id';
        content(code, doc, left, codeEnd, styles);
        content(text, doc, questionStart, right, styles);
      } else {
        tableBody = null;
        const tag = {title: 'h2', topic: 'h3', section: 'h4'}[kind] ?? 'p';
        const node = document.createElement(tag);
        node.className = `source-${kind}`;
        content(node, doc, left, right, styles);
        parent.append(node);
        if (kind === 'choice') {
          const source = document.createElement('a');
          source.className = 'source-page';
          source.href = `./objective-pdf.html?page=${codeEnd}`;
          source.target = '_blank';
          source.rel = 'noopener';
          source.textContent = '核对原图';
          parent.append(source);
        }
      }
    }
  }

  function show(id, order) {
    const doc = documents.get(id);
    const scope = order === 'all-frequency' ? [...documents.values()] : [doc];
    const topics = scope.flatMap(item => item.topics.map(topic => ({doc: item, ...topic})));
    if (order !== 'original') topics.sort((a,b) => b.frequency-a.frequency);
    displayed = [];
    const fragment = document.createDocumentFragment();
    if (order !== 'all-frequency') appendBlocks(fragment, doc, 0, doc.topics[0].first);
    for (const topic of topics) {
      const card = document.createElement('section');
      card.className = 'source-topic-card';
      card.dataset.frequency = topic.frequency;
      if (order === 'all-frequency') {
        const badge = document.createElement('div');
        badge.className = 'subject-label';
        badge.textContent = topic.doc.name;
        badge.style.userSelect = 'none';
        card.append(badge);
      }
      appendBlocks(card, topic.doc, topic.first, topic.last);
      fragment.append(card);
    }
    root.replaceChildren(fragment);
  }

  function highlight(excerpts) {
    const byDocument = new Map([...documents.keys()].map(id => [id, excerpts.filter(item => item.document === id)]));
    for (const entry of displayed) paint(entry, byDocument.get(entry.doc.id));
  }

  function relativeOffset(element, node, offset) {
    const prefix = document.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(node, offset);
    return prefix.toString().length;
  }

  function selectedRanges(range) {
    const result = [];
    for (const {node, doc, start, end} of displayed) {
      if (!range.intersectsNode(node)) continue;
      const first = node.contains(range.startContainer) ? start + relativeOffset(node, range.startContainer, range.startOffset) : start;
      const last = node.contains(range.endContainer) ? start + relativeOffset(node, range.endContainer, range.endOffset) : end;
      if (first >= last) continue;
      const previous = result.at(-1);
      if (previous?.document === doc.id && previous.end <= first && !doc.text.slice(previous.end, first).trim()) {
        previous.end = last;
      } else {
        result.push({document: doc.id, start: first, end: last});
      }
    }
    for (const item of result) {
      const text = documents.get(item.document).text;
      while (item.start < item.end && /\s/.test(text[item.start])) item.start++;
      while (item.end > item.start && /\s/.test(text[item.end - 1])) item.end--;
    }
    return result.filter(item => item.start < item.end);
  }

  function at(screenY) {
    const entry = displayed.find(item => item.node.getBoundingClientRect().bottom > screenY) ?? displayed.at(-1);
    if (!entry) return null;
    return {document: entry.doc.id, offset: entry.start};
  }

  function jump(id, offset, screenY) {
    const entry = displayed.find(item => item.doc.id === id && item.start <= offset && item.end > offset)
      ?? displayed.find(item => item.doc.id === id && item.start >= offset);
    if (!entry) return false;
    window.scrollTo(0, Math.max(0, window.scrollY + entry.node.getBoundingClientRect().top - screenY));
    return true;
  }

  return {show, highlight, selectedRanges, at, jump};
}
