// Exact PR74 stylesheet: remove only these known rules from stored structured HTML.
const PREVIOUS_PRESENTATION_STYLE = `
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

// The April broadsheet: stacked stories, a narrow sidebar, and cutout text flow.
export const EDITION_STYLE = `
main.gitzette-edition{box-sizing:border-box;display:block;max-width:960px;margin:24px auto;padding:0;background:#f7f4ee;border:1px solid #c8c2b4;box-shadow:0 2px 12px #0002;color:#0f0f0f;font:15px/1.6 Georgia,serif}
.gitzette-edition *{box-sizing:border-box}
.gitzette-edition>header{text-align:left;padding:20px 24px 14px;border-bottom:3px solid #0f0f0f}
.gitzette-edition .dispatch-kicker{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #c8c2b4;padding-bottom:8px;margin-bottom:10px;font:600 11px/1.4 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase}
.gitzette-edition .dispatch-masthead{font:700 clamp(32px,7vw,64px)/1 'IBM Plex Mono',monospace;letter-spacing:-.03em}
.gitzette-edition .dispatch-masthead span{font-weight:400;color:#666}
.gitzette-edition .dispatch-identity{overflow-wrap:anywhere;min-width:0;font:700 20px/1.4 'IBM Plex Mono',monospace;margin:4px 0 0}
.gitzette-edition>header h1{font:italic 14px/1.5 Georgia,serif;color:#666;margin:6px 0 0}
.gitzette-edition>header .deck{font:italic 14px/1.5 Georgia,serif;color:#666;margin:4px 0 0}
.gitzette-edition>header .notice{font:10px/1.5 'IBM Plex Mono',monospace;color:#666;margin:8px 0 0}
.gitzette-edition .dispatch-bar{display:flex;flex-wrap:wrap;gap:6px 20px;background:#0f0f0f;color:#f7f4ee;padding:8px 24px;font:11px/1.5 'IBM Plex Mono',monospace}
.gitzette-edition .dispatch-body{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:32px;padding:24px 24px 32px}
.gitzette-edition .dispatch-stories,.gitzette-edition .dispatch-sidebar{min-width:0}
.gitzette-edition article{display:flow-root;padding:0 0 28px;margin:0 0 28px;border-bottom:1px solid #c8c2b4;overflow-wrap:anywhere}
.gitzette-edition article:last-child{margin-bottom:0}
.gitzette-edition article .tag{display:table;background:#0f0f0f;color:#f7f4ee;font:10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.04em;padding:2px 5px;margin:0 0 8px}
.gitzette-edition article h2{font:700 25px/1.12 Georgia,serif;margin:0 0 8px}
.gitzette-edition article h2+p{font-style:italic;color:#666;font-size:14px;margin:0 0 12px}
.gitzette-edition .dispatch-prose{display:flow-root}
.gitzette-edition .dispatch-prose p{margin:0 0 12px}
.gitzette-edition .dispatch-cutout{float:left;width:140px;height:140px;max-width:44%;margin:0 12px 6px 0;shape-outside:circle(50% at 50% 50%);shape-margin:6px}
.gitzette-edition article .dispatch-cutout img{float:none;display:block;width:100%;height:100%;max-height:140px;object-fit:contain;margin:0}
.gitzette-edition .dispatch-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #c8c2b4;margin:0 0 20px}
.gitzette-edition .dispatch-metric{text-align:center;padding:8px 3px;border-right:1px solid #c8c2b4}
.gitzette-edition .dispatch-metric:last-child{border:0}
.gitzette-edition .dispatch-metric strong{display:block;font:700 36px/1.2 'IBM Plex Mono',monospace}
.gitzette-edition .dispatch-metric span{font:9px/1.4 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.04em}
.gitzette-edition .dispatch-sidebar h2{font:600 10px/1.5 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.1em;margin:0 0 14px}
.gitzette-edition .dispatch-repo{padding:10px 0;border-bottom:1px solid #c8c2b4;font:11px/1.5 'IBM Plex Mono',monospace;overflow-wrap:anywhere}
.gitzette-edition .dispatch-repo-label{display:flex;justify-content:space-between;gap:8px}
.gitzette-edition .dispatch-repo-track{height:6px;background:#e6e1d6;margin-top:7px}
.gitzette-edition .dispatch-repo-fill{height:100%;background:#666}
.gitzette-edition .dispatch-sidebar-note{color:#666;font:10px/1.6 'IBM Plex Mono',monospace;margin:14px 0 0}
.gitzette-edition>footer{border-top:1px solid #c8c2b4;padding:12px 24px;font:11px/1.5 'IBM Plex Mono',monospace;color:#666}
.gitzette-edition a,.gitzette-edition a:visited{color:#292720;text-decoration-color:#aaa393;text-underline-offset:3px}
.gitzette-edition a:hover{color:#000;text-decoration-color:currentColor}
.gitzette-edition a:focus-visible,.gitzette-edition summary:focus-visible{outline:2px solid #514b3f;outline-offset:3px}
.gitzette-edition .sources{clear:both;font:11px/1.5 'IBM Plex Mono',monospace;color:#625c50;margin:14px 0 0}
.gitzette-edition .sources summary{cursor:pointer}
.gitzette-edition .sources ol{margin:12px 0 0;padding-left:20px}
.gitzette-edition .sources li{margin:0 0 9px;padding-left:3px}
@media(max-width:700px){main.gitzette-edition{margin:0}.gitzette-edition .dispatch-body{grid-template-columns:minmax(0,1fr);padding:20px;gap:24px}.gitzette-edition>header{padding:18px 20px 14px}.gitzette-edition .dispatch-kicker{font-size:9px;flex-direction:column;gap:4px}.gitzette-edition .dispatch-sidebar{border-top:3px solid #0f0f0f;padding-top:20px}.gitzette-edition article h2{font-size:24px}}
@media print{.gitzette-edition details.sources{display:block}.gitzette-edition details.sources>*{display:block}.gitzette-edition details.sources::details-content{display:block;content-visibility:visible;height:auto}}
`;

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

/** Upgrade only our known structured renderer; leave original April HTML alone. */
export function upgradeStructuredEdition(html: string): string {
  const current = html.includes('<main class="gitzette-edition">');
  const original = html.includes('article{display:flow-root;padding:28px 0;') && html.includes('<main><header>');
  if (!current && !original) return html;
  let result = original ? html.replace('<main><header>', '<main class="gitzette-edition"><header>') : html;
  result = result.replace(/<p class="sources">Sources: ([\s\S]*?)<\/p>/g, (block, content: string) => {
    const anchors = content.match(/<a\b[^>]*>[\s\S]*?<\/a>/g);
    if (!anchors?.length) return block;
    return `<details class="sources"><summary>Sources (${anchors.length})</summary><ol>${anchors.map(a => `<li>${a}</li>`).join('')}</ol></details>`;
  });
  if (!result.includes('class="dispatch-body"')) {
    result = result.replace(/<main class="gitzette-edition"><header>([\s\S]*?)<\/header>([\s\S]*?)(<footer>[\s\S]*?<\/footer>)<\/main>/, (block, header: string, body: string, footer: string) => {
      const stories = body.match(/<article\b[^>]*>[\s\S]*?<\/article>/g);
      if (!stories?.length) return block;
      const sources = new Set<string>();
      const repos = new Map<string, number>();
      for (const citation of body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)) {
        try {
          const u = new URL(citation[1].replace(/&amp;/g, '&'));
          let parts = u.pathname.split('/').filter(Boolean);
          if (u.hostname === 'api.github.com' && parts[0] === 'repos') parts = parts.slice(1);
          else if (u.hostname !== 'github.com') continue;
          if (parts.length < 2 || sources.has(u.href)) continue;
          sources.add(u.href);
          const repo = `${parts[0]}/${parts[1]}`.toLowerCase();
          repos.set(repo, (repos.get(repo) ?? 0) + 1);
        } catch { /* Only count recognizable source destinations. */ }
      }
      const ranked = [...repos].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
      const max = Math.max(1,...ranked.map(r=>r[1]));
      const identity = /<p>@([\s\S]*?) · ([^<]+)<\/p>/.exec(header);
      let date = identity?.[2] ?? '';
      if (/^\d{4}-W\d{2}$/.test(date)) {
        const [year,week] = date.split('-W').map(Number);
        const start = new Date(Date.UTC(year,0,4));
        start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7)+(week-1)*7);
        const end = new Date(start); end.setUTCDate(end.getUTCDate()+6);
        const format = (d: Date) => d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
        const startYear = start.getUTCFullYear();
        const endYear = end.getUTCFullYear();
        date = startYear === endYear ? `${format(start)} – ${format(end)}, ${endYear}` : `${format(start)}, ${startYear} – ${format(end)}, ${endYear}`;
      }
      header = header.replace(/<p>@([\s\S]*?) · ([^<]+)<\/p>/,'');
      header = `<div class="dispatch-kicker"><span>Gitzette.online — open-source digest</span><span>${escapeText(date)}</span></div><div class="dispatch-masthead">the <span>dispatch</span></div>${identity ? `<p class="dispatch-identity">@${identity[1]}</p>` : ''}${header}`;
      const wrapped = stories.map(story => {
        // Our renderer puts the image first. Move it after heading/deck, into prose.
        const image = /<img\b[^>]*>/.exec(story)?.[0] ?? '';
        const without = image ? story.replace(image,'') : story;
        const transformed = without.replace(/(<h2>[\s\S]*?<\/h2><p>[\s\S]*?<\/p>)([\s\S]*?)(<details class="sources">)/, (_m, lead, prose, sourcesStart) => `${lead}<div class="dispatch-prose">${image ? `<div class="dispatch-cutout">${image}</div>` : ''}${prose}</div>${sourcesStart}`);
        return transformed === without ? story : transformed;
      }).join('');
      const metrics = [[stories.length,'stories'],[sources.size,'sources'],[repos.size,'repos']].map(([n,label])=>`<div class="dispatch-metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
      const bars = ranked.map(([repo,count])=>`<div class="dispatch-repo"><div class="dispatch-repo-label"><span>${escapeText(repo)}</span><strong>${count}</strong></div><div class="dispatch-repo-track"><div class="dispatch-repo-fill" style="width:${Math.round(count/max*100)}%"></div></div></div>`).join('');
      const sidebar = `<aside class="dispatch-sidebar" aria-label="Edition at a glance"><h2>In this edition</h2><div class="dispatch-metrics">${metrics}</div><h2>Cited sources by repository</h2>${bars}<p class="dispatch-sidebar-note">Counts describe the sources cited in this edition, not total GitHub activity or repository stars.</p></aside>`;
      return `<main class="gitzette-edition"><header>${header}</header><div class="dispatch-bar"><span>${stories.length} stories</span><span>${sources.size} cited sources</span><span>${repos.size} repositories</span></div><div class="dispatch-body"><section class="dispatch-stories" aria-label="Stories">${wrapped}</section>${sidebar}</div>${footer}</main>`;
    });
  }
  // PR74 stored this exact CSS in anonymous style blocks, sometimes alongside base CSS.
  result = result.replace(/<style>([\s\S]*?)<\/style>/g, (_block, css: string) => {
    const retained = css.split(PREVIOUS_PRESENTATION_STYLE).join('');
    return retained.trim() ? `<style>${retained}</style>` : '';
  });
  // Refresh a prior version of the serving stylesheet instead of accumulating it.
  result = result.replace(/<style id="gitzette-edition-style">[\s\S]*?<\/style>/g,'');
  return result.replace('</head>', `<style id="gitzette-edition-style">${EDITION_STYLE}</style></head>`);
}
