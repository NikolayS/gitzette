// Shared by newly rendered editions and existing structured editions at read time.
export const EDITION_STYLE = `
main.gitzette-edition{box-sizing:border-box;max-width:1180px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px}
.gitzette-edition>header,.gitzette-edition>footer{grid-column:1/-1}
.gitzette-edition>header{text-align:center;padding-bottom:20px}
.gitzette-edition>header h1{font-size:clamp(30px,4vw,48px);line-height:1.1;margin:12px 0}
.gitzette-edition>article{min-width:0;overflow-wrap:anywhere}
.gitzette-edition>article h2{font-size:25px;line-height:1.15;margin:12px 0}
.gitzette-edition>article img{float:none;display:block;width:100%;height:auto;max-height:230px;object-fit:contain;margin:0 auto 20px}
.gitzette-edition>footer{padding-top:20px}
.gitzette-edition a,.gitzette-edition a:visited{color:#292720;text-decoration-color:#aaa393;text-underline-offset:3px}
.gitzette-edition a:hover{color:#000;text-decoration-color:currentColor}
.gitzette-edition a:focus-visible,.gitzette-edition summary:focus-visible{outline:2px solid #514b3f;outline-offset:3px}
.gitzette-edition .sources{font:12px/1.5 Georgia,serif;color:#625c50;margin:20px 0 0;border-top:1px solid #d8d1c3;padding-top:10px}
.gitzette-edition .sources summary{cursor:pointer;letter-spacing:.04em}
.gitzette-edition .sources ol{margin:12px 0 0;padding-left:20px}
.gitzette-edition .sources li{margin:0 0 9px;padding-left:3px}
@media(max-width:999px){main.gitzette-edition{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:699px){main.gitzette-edition{display:block;margin:0;padding:20px}.gitzette-edition>article img{width:100%;max-height:230px}.gitzette-edition>header h1{font-size:32px}}
`;

/** Only upgrade our known structured renderer, never arbitrary legacy layouts. */
export function upgradeStructuredEdition(html: string): string {
  const current = html.includes('<main class="gitzette-edition">');
  const original = html.includes('article{display:flow-root;padding:28px 0;') && html.includes('<main><header>');
  if (!current && !original) return html;
  let result = original ? html.replace('<main><header>', '<main class="gitzette-edition"><header>') : html;
  // Preserve the original escaped anchors; never parse their titles as markup.
  result = result.replace(/<p class="sources">Sources: ([\s\S]*?)<\/p>/g, (block, content: string) => {
    const anchors = content.match(/<a\b[^>]*>[\s\S]*?<\/a>/g);
    if (!anchors?.length) return block;
    return `<details class="sources"><summary>Sources (${anchors.length})</summary><ol>${anchors.map(a => `<li>${a}</li>`).join('')}</ol></details>`;
  });
  return result.replace('</head>', `<style>${EDITION_STYLE}</style></head>`);
}
