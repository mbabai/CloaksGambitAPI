const path = require('path');
const { pathToFileURL } = require('url');

const markdownUrl = pathToFileURL(
  path.resolve(__dirname, '../public/js/modules/ui/markdown.js')
).href;

describe('announcement markdown parser', () => {
  let markdown;

  beforeAll(async () => {
    markdown = await import(markdownUrl);
  });

  test('parses headings, paragraphs, lists, and inline emphasis', () => {
    const blocks = markdown.parseMarkdownBlocks([
      '# Notice',
      '',
      'Players should read **today**.',
      '- First item',
      '- _Second_ item',
    ].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1, text: 'Notice' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', text: 'Players should read **today**.' });
    expect(blocks[1].tokens.some((token) => token.type === 'strong')).toBe(true);
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[2].items[1].tokens.some((token) => token.type === 'em')).toBe(true);
  });

  test('accepts heading markers without a space after the hash', () => {
    const blocks = markdown.parseMarkdownBlocks('#Cash Prize Tournament');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'heading',
      level: 1,
      text: 'Cash Prize Tournament',
    });
  });

  test('keeps single newlines inside paragraph blocks for banner line breaks', () => {
    const blocks = markdown.parseMarkdownBlocks('Line one\nLine two\nLine three');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'paragraph',
      text: 'Line one\nLine two\nLine three',
    });
  });

  test('renders two leading spaces as an indentation level', () => {
    const indent = '\u00a0\u00a0\u00a0\u00a0';
    const blocks = markdown.parseMarkdownBlocks([
      '#Title',
      '  Indented line',
      '    Double indented line',
      '  - Indented list item',
    ].join('\n'));

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Title' });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      text: `${indent}Indented line\n${indent}${indent}Double indented line`,
    });
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[2].items[0]).toMatchObject({
      indent: 1,
      text: 'Indented list item',
    });
  });

  test('allows normal links and leaves scriptable links as text', () => {
    const tokens = markdown.parseInlineMarkdown(
      '[bad](javascript:alert(1)) [ok](https://example.com)'
    );

    const links = tokens.filter((token) => token.type === 'link');
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://example.com');
    expect(markdown.normalizeMarkdownLinkHref('javascript:alert(1)')).toBe('');
  });

  test('normalizes source line endings and preserves line indentation', () => {
    expect(markdown.normalizeMarkdownSource('  Hello\r\nworld  ')).toBe('  Hello\nworld  ');
    expect(markdown.parseMarkdownBlocks('   ')).toEqual([]);
  });
});
