import { describe, expect, test } from 'bun:test';
import { upgradeStructuredEdition } from './edition-style';

describe('structured edition presentation upgrade', () => {
 test('preserves every escaped source and existing story/image while folding citations', () => {
  const html='<html><head><style>article{display:flow-root;padding:28px 0;}</style></head><body><main><header>Edition</header><article><img src="/img/a.webp"><h2>Story</h2><p class="sources">Sources: <a href="https://github.com/a/b/issues/1">A &amp; B</a> · <a href="https://github.com/a/b/issues/2">&lt;script&gt;</a></p></article></main></body></html>';
  const result=upgradeStructuredEdition(html);
  expect(result).toContain('<main class="gitzette-edition">');
  expect(result).toContain('<summary>Sources (2)</summary>');
  expect(result).toContain('<li><a href="https://github.com/a/b/issues/1">A &amp; B</a></li>');
  expect(result).toContain('&lt;script&gt;');
  expect(result).toContain('<img src="/img/a.webp"><h2>Story</h2>');
  expect(result).not.toContain('<p class="sources">');
 });
 test('does not rewrite legacy broadsheets or quiet editions', () => {
  for (const html of ['<html><head></head><body><main><header>Legacy</header><div class="grid-2-1">Columns</div></main></body></html>', '<html><head></head><body><main><article>Quiet</article></main></body></html>']) expect(upgradeStructuredEdition(html)).toBe(html);
 });
});
