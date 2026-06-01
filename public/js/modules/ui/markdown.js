const MAX_INLINE_DEPTH = 6;

function normalizeSource(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '');
}

export function normalizeMarkdownSource(value) {
  return normalizeSource(value);
}

function isAllowedHref(href) {
  const value = typeof href === 'string' ? href.trim() : '';
  if (!value) return false;
  if (value.startsWith('#') || value.startsWith('/')) return true;
  return /^(https?:|mailto:)/i.test(value);
}

export function normalizeMarkdownLinkHref(href) {
  const value = typeof href === 'string' ? href.trim() : '';
  return isAllowedHref(value) ? value : '';
}

function pushText(tokens, text) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === 'text') {
    last.text += text;
    return;
  }
  tokens.push({ type: 'text', text });
}

function findClosingMarker(source, marker, startIndex) {
  if (!marker) return -1;
  let idx = startIndex;
  while (idx < source.length) {
    idx = source.indexOf(marker, idx);
    if (idx === -1) return -1;
    if (idx > startIndex) return idx;
    idx += marker.length;
  }
  return -1;
}

function findLinkClose(source, startIndex) {
  const closeLabel = source.indexOf('](', startIndex);
  if (closeLabel === -1) return null;
  const closeHref = source.indexOf(')', closeLabel + 2);
  if (closeHref === -1) return null;
  return {
    label: source.slice(startIndex + 1, closeLabel),
    href: source.slice(closeLabel + 2, closeHref),
    end: closeHref + 1,
  };
}

export function parseInlineMarkdown(source, depth = 0) {
  const text = typeof source === 'string' ? source : '';
  if (!text || depth > MAX_INLINE_DEPTH) {
    return text ? [{ type: 'text', text }] : [];
  }

  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const pair = text.slice(index, index + 2);

    if (char === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        tokens.push({ type: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === '[') {
      const link = findLinkClose(text, index);
      const href = normalizeMarkdownLinkHref(link?.href);
      if (link && href) {
        tokens.push({
          type: 'link',
          href,
          children: parseInlineMarkdown(link.label, depth + 1),
        });
        index = link.end;
        continue;
      }
    }

    if (pair === '**' || pair === '__') {
      const end = findClosingMarker(text, pair, index + 2);
      if (end !== -1) {
        tokens.push({
          type: 'strong',
          children: parseInlineMarkdown(text.slice(index + 2, end), depth + 1),
        });
        index = end + 2;
        continue;
      }
    }

    if ((char === '*' || char === '_') && text[index + 1] !== char) {
      const end = findClosingMarker(text, char, index + 1);
      if (end !== -1) {
        tokens.push({
          type: 'em',
          children: parseInlineMarkdown(text.slice(index + 1, end), depth + 1),
        });
        index = end + 1;
        continue;
      }
    }

    let next = index + 1;
    while (next < text.length && !'`[*_'.includes(text[next])) {
      next += 1;
    }
    pushText(tokens, text.slice(index, next));
    index = next;
  }

  return tokens;
}

function createTextBlock(type, text, extra = {}) {
  return {
    type,
    text,
    tokens: parseInlineMarkdown(text),
    ...extra,
  };
}

function splitLineIndent(rawLine) {
  const line = typeof rawLine === 'string' ? rawLine : '';
  const leadingSpaces = line.match(/^ */)?.[0].length || 0;
  const indent = Math.floor(leadingSpaces / 2);
  return {
    indent,
    content: line.slice(indent * 2),
  };
}

function applyTextIndent(text, indent = 0) {
  if (!indent || typeof text !== 'string') return text;
  const prefix = '\u00a0\u00a0\u00a0\u00a0'.repeat(indent);
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function applyElementIndent(element, indent = 0) {
  if (!element || !indent) return;
  element.style.setProperty('--announcement-line-indent', `${indent * 1.5}em`);
  element.classList.add('announcement-line--indented');
}

export function parseMarkdownBlocks(source) {
  const markdown = normalizeSource(source);
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push(createTextBlock('paragraph', paragraphLines.join('\n')));
    paragraphLines = [];
  }

  function flushList() {
    if (!listBlock) return;
    blocks.push(listBlock);
    listBlock = null;
  }

  lines.forEach((rawLine) => {
    const { indent, content } = splitLineIndent(rawLine);
    const line = content.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = line.match(/^(#{1,3})\s*(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const text = applyTextIndent(heading[2].trim(), indent);
      blocks.push(createTextBlock('heading', text, { level: heading[1].length, indent }));
      return;
    }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      return;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(createTextBlock('quote', applyTextIndent(quote[1].trim(), indent), { indent }));
      return;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    const listMatch = unordered || ordered;
    if (listMatch) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (!listBlock || listBlock.ordered !== orderedList) {
        flushList();
        listBlock = { type: 'list', ordered: orderedList, items: [] };
      }
      const text = listMatch[1].trim();
      listBlock.items.push({
        text,
        indent,
        tokens: parseInlineMarkdown(text),
      });
      return;
    }

    flushList();
    paragraphLines.push(applyTextIndent(line, indent));
  });

  flushParagraph();
  flushList();
  return blocks;
}

function appendInlineTokens(parent, tokens, doc) {
  tokens.forEach((token) => {
    if (!token || token.type === 'text') {
      const parts = String(token?.text || '').split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          parent.appendChild(doc.createElement('br'));
        }
        if (part) {
          parent.appendChild(doc.createTextNode(part));
        }
      });
      return;
    }

    if (token.type === 'code') {
      const code = doc.createElement('code');
      code.textContent = token.text || '';
      parent.appendChild(code);
      return;
    }

    if (token.type === 'link') {
      const anchor = doc.createElement('a');
      anchor.href = token.href;
      anchor.rel = 'noopener noreferrer';
      if (/^https?:/i.test(token.href)) {
        anchor.target = '_blank';
      }
      appendInlineTokens(anchor, token.children || [], doc);
      parent.appendChild(anchor);
      return;
    }

    const tagName = token.type === 'strong' ? 'strong' : 'em';
    const inline = doc.createElement(tagName);
    appendInlineTokens(inline, token.children || [], doc);
    parent.appendChild(inline);
  });
}

export function renderMarkdownInto(container, source) {
  if (!container) return;
  const doc = container.ownerDocument || document;
  container.replaceChildren();

  parseMarkdownBlocks(source).forEach((block) => {
    if (block.type === 'rule') {
      container.appendChild(doc.createElement('hr'));
      return;
    }

    if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      block.items.forEach((item) => {
        const li = doc.createElement('li');
        applyElementIndent(li, item.indent || 0);
        appendInlineTokens(li, item.tokens || [], doc);
        list.appendChild(li);
      });
      container.appendChild(list);
      return;
    }

    const tagName = block.type === 'heading'
      ? `h${Math.min(6, Math.max(3, (block.level || 1) + 2))}`
      : block.type === 'quote'
        ? 'blockquote'
        : 'p';
    const node = doc.createElement(tagName);
    appendInlineTokens(node, block.tokens || [], doc);
    container.appendChild(node);
  });
}
