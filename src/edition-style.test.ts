import { describe, expect, test } from 'bun:test';
import { EDITION_STYLE, upgradeStructuredEdition } from './edition-style';

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
 test('uses two actual story columns beside a compact statistics rail on desktop', () => {
  expect(EDITION_STYLE).toContain('.dispatch-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(238px,260px)');
  expect(EDITION_STYLE).toContain('.dispatch-stories{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
  expect(EDITION_STYLE).toContain('.dispatch-cutout{float:left;width:132px;height:auto;aspect-ratio:1');
  expect(EDITION_STYLE).toContain('.dispatch-cutout-lead{width:190px;max-width:55%');
  expect(EDITION_STYLE).toContain('.dispatch-cutout-small{width:112px;max-width:40%');
  expect(EDITION_STYLE).toContain('@media(max-width:1040px){main.gitzette-edition{max-width:920px}.gitzette-edition .dispatch-body{grid-template-columns:minmax(0,1fr);gap:26px}.gitzette-edition .dispatch-sidebar{display:block');
  expect(EDITION_STYLE).toContain('@media(max-width:699px)');
  expect(EDITION_STYLE).toContain('.dispatch-stories{grid-template-columns:minmax(0,1fr)');
 });
 test('sizes illustrations by image order when the first story is text-only', () => {
  const html='<html><head></head><body><main class="gitzette-edition"><header><p>@octocat · 2026-W36</p></header><article><h2>Text lead</h2><p>Deck</p><p>Prose</p><details class="sources"><summary>Sources</summary></details></article><article><img src="/img/a.webp"><h2>First illustrated</h2><p>Deck</p><p>Prose</p><details class="sources"><summary>Sources</summary></details></article><article><img src="/img/b.webp"><h2>Supporting</h2><p>Deck</p><p>Prose</p><details class="sources"><summary>Sources</summary></details></article><footer>End</footer></main></body></html>';
  const result=upgradeStructuredEdition(html);
  expect(result).toContain('class="dispatch-cutout dispatch-cutout-lead"><img src="/img/a.webp">');
  expect(result).toContain('class="dispatch-cutout dispatch-cutout-supporting"><img src="/img/b.webp">');
  expect(upgradeStructuredEdition(result)).toBe(result);
 });
});
