import type { Config } from "./config.ts";
import type { GitHubData } from "./github.ts";
import type { GeneratedContent } from "./llm.ts";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function badgeClass(state: string): string {
  if (state === "MERGED") return "badge-merged";
  if (state === "OPEN") return "badge-open";
  return "badge-closed";
}

export function renderHTML(config: Config, data: GitHubData, content: GeneratedContent): string {
  const weekLabel = `${config.weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${config.weekEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const prsByRepo: Record<string, typeof data.pullRequests> = {};
  for (const pr of data.pullRequests) {
    if (!prsByRepo[pr.repo]) prsByRepo[pr.repo] = [];
    prsByRepo[pr.repo].push(pr);
  }

  const prListHTML = data.pullRequests
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(pr => `
      <li>
        <span class="badge ${badgeClass(pr.state)}">${pr.state.toLowerCase()}</span>
        <span class="pr-date">${fmtDate(pr.createdAt)}</span>
        <a href="${pr.url}">${pr.title} (#${pr.number})</a>
      </li>`).join("");

  const commitTableHTML = data.repos
    .sort((a, b) => b.commits - a.commits)
    .map(r => `<tr><td><a href="${r.url}">${r.nameWithOwner}</a></td><td>${r.commits}</td></tr>`)
    .join("");

  const newReposHTML = data.newRepos.map(r => `
    <div class="repo-box">
      <h4><a href="${r.url}">${r.nameWithOwner}</a></h4>
      ${r.description ? `<p>${r.description}</p>` : ""}
      <p class="repo-date">Created ${fmtDate(r.createdAt)}</p>
    </div>`).join("");

  const sectionStoriesHTML = content.sectionStories.map(s => `
    <div class="col">
      <span class="tag">${s.tag}</span>
      <div class="article">
        <h2>${s.headline}</h2>
        <p>${s.body}</p>
      </div>
    </div>`).join('<div class="col-divider"></div>');

  const editionBarHTML = content.editionBarItems
    .map(item => `<span>${item}</span>`)
    .join("");

  const openIssues = data.issues.filter(i => i.state === "OPEN");
  const openIssuesHTML = openIssues.length > 0
    ? `<span class="tag">pending work</span>
       <ul class="pr-list">
         ${openIssues.map(i => `<li><span class="badge badge-open">open</span> <span class="pr-date">${fmtDate(i.createdAt)}</span> <a href="${i.url}">${i.title} (#${i.number})</a> <span class="repo-label">${i.repo.split("/")[1]}</span></li>`).join("")}
       </ul>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${config.title} — ${weekLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4;
    --muted: #666; --merged: #2d6a4f; --open: #1d4e89; --closed: #888;
  }
  body { background: #e8e4dc; font-family: 'IBM Plex Sans', sans-serif; color: var(--ink); }
  .paper { max-width: 960px; margin: 24px auto; background: var(--paper); border: 1px solid var(--rule); box-shadow: 0 2px 12px rgba(0,0,0,0.15); }

  /* HEADER */
  .header { padding: 20px 24px 14px; border-bottom: 3px solid var(--ink); }
  .header-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
  .masthead { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: clamp(28px, 6vw, 60px); letter-spacing: -0.03em; line-height: 1; }
  .masthead span { color: var(--muted); font-weight: 400; }
  .tagline { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); margin-top: 6px; }
  .edition-bar { margin-top: 12px; padding: 6px 0; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.05em; display: flex; flex-wrap: wrap; gap: 8px 24px; }
  .edition-bar span::before { content: "▸ "; color: var(--muted); }

  /* LAYOUT */
  .body { padding: 0 24px 32px; }
  .spacer { height: 20px; }
  .grid-main { display: grid; grid-template-columns: 1fr; gap: 0; }
  .grid-sections { display: grid; grid-template-columns: 1fr; gap: 0; }
  .grid-log { display: grid; grid-template-columns: 1fr; gap: 0; }
  @media (min-width: 640px) {
    .grid-main { grid-template-columns: 3fr 1fr; }
    .grid-sections { grid-template-columns: 1fr 1fr 1fr; }
    .grid-log { grid-template-columns: 2fr 1fr; }
  }
  .col { padding: 20px 20px 0 0; }
  .col:last-child { padding-right: 0; }
  @media (min-width: 640px) {
    .col { border-right: 1px solid var(--rule); }
    .col:last-child { border-right: none; padding-left: 20px; }
    .grid-sections .col { padding: 20px 16px 0; }
    .grid-sections .col:first-child { padding-left: 0; }
    .grid-sections .col:last-child { padding-right: 0; }
    .col-divider { display: none; }
  }
  .col-divider { height: 1px; background: var(--rule); margin: 16px 0; }
  .rule-heavy { border: none; border-top: 2px solid var(--ink); margin: 0; }

  /* ELEMENTS */
  .tag { display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; background: var(--ink); color: var(--paper); padding: 2px 7px; margin-bottom: 8px; }
  h1 { font-family: 'IBM Plex Serif', serif; font-size: clamp(20px, 4vw, 34px); font-weight: 700; line-height: 1.1; margin-bottom: 8px; }
  h2 { font-family: 'IBM Plex Serif', serif; font-size: clamp(15px, 3vw, 20px); font-weight: 700; line-height: 1.15; margin-bottom: 6px; }
  .deck { font-family: 'IBM Plex Serif', serif; font-style: italic; font-size: 14px; line-height: 1.55; color: #333; border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 8px; }
  .byline { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
  p { font-size: 13.5px; line-height: 1.7; margin-bottom: 10px; color: #222; }
  a { color: var(--ink); }
  code { font-family: 'IBM Plex Mono', monospace; font-size: 12px; background: #e8e4dc; padding: 1px 4px; }
  .pull-quote { border-left: 3px solid var(--ink); padding: 8px 12px; margin: 12px 0; font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-style: italic; background: #efece4; }

  /* STATS */
  .stats-box { border: 1px solid var(--ink); padding: 14px; margin-bottom: 16px; }
  .stats-box-title { font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid var(--ink); margin-bottom: 10px; padding-bottom: 5px; }
  .stat-row { display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 3px 0; border-bottom: 1px dotted var(--rule); }
  .stat-row:last-child { border-bottom: none; }
  .stat-num { font-size: 18px; font-weight: 700; }

  /* REPO BOXES */
  .repo-box { background: var(--ink); color: var(--paper); padding: 12px 14px; margin-bottom: 12px; }
  .repo-box h4 { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .repo-box p { font-size: 12px; color: #bbb; margin: 0; line-height: 1.5; }
  .repo-box .repo-date { font-size: 10px; color: #888; margin-top: 4px; }
  .repo-box a { color: #7dd3fc; }

  /* PR LIST */
  .pr-list { list-style: none; }
  .pr-list li { font-family: 'IBM Plex Mono', monospace; font-size: 11px; line-height: 1.5; padding: 4px 0; border-bottom: 1px dotted var(--rule); }
  .pr-list li:last-child { border-bottom: none; }
  .badge { display: inline-block; font-size: 8px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 1px 5px; margin-right: 4px; vertical-align: middle; }
  .badge-merged { background: var(--merged); color: white; }
  .badge-open { background: var(--open); color: white; }
  .badge-closed { background: var(--closed); color: white; }
  .pr-date { color: var(--muted); margin-right: 4px; font-size: 10px; }
  .repo-label { color: var(--muted); font-size: 10px; margin-left: 4px; }

  /* COMMIT TABLE */
  .commit-table { width: 100%; border-collapse: collapse; }
  .commit-table td { font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 4px 0; border-bottom: 1px dotted var(--rule); }
  .commit-table td:last-child { text-align: right; font-weight: 700; }

  /* FOOTER */
  .footer { border-top: 2px solid var(--ink); padding: 10px 24px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-align: center; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
</style>
</head>
<body>
<div class="paper">
  <div class="header">
    <div class="header-meta">
      <span>github.com/${config.githubUser}</span>
      <span>${weekLabel}</span>
      <span>generated by gitzette</span>
    </div>
    <div class="masthead">${config.title.replace(/\.([\w]+)/, '.<span>$1</span>')}</div>
    <div class="tagline">// what changed in ${config.githubUser}'s GitHub this week</div>
    <div class="edition-bar">${editionBarHTML}</div>
  </div>

  <div class="body">
    <div class="spacer"></div>

    <div class="grid-main">
      <div class="col">
        <span class="tag">top story</span>
        <div class="article">
          <h1>${content.heroHeadline}</h1>
          <div class="deck">${content.heroDeck}</div>
          <div class="byline">The ${config.title} · ${weekLabel}</div>
          ${content.heroBody.split("\n\n").map(p => `<p>${p}</p>`).join("")}
          <div class="pull-quote">${content.pullQuote}</div>
        </div>
      </div>
      <div class="col">
        <div class="stats-box">
          <div class="stats-box-title">week in numbers</div>
          <div class="stat-row"><span>total commits</span><span class="stat-num">${data.totalCommits}</span></div>
          <div class="stat-row"><span>PRs merged</span><span class="stat-num">${data.pullRequests.filter(p => p.state === "MERGED").length}</span></div>
          <div class="stat-row"><span>PRs open</span><span class="stat-num">${data.pullRequests.filter(p => p.state === "OPEN").length}</span></div>
          <div class="stat-row"><span>issues closed</span><span class="stat-num">${data.issues.filter(i => i.state === "CLOSED").length}</span></div>
          <div class="stat-row"><span>new repos</span><span class="stat-num">${data.newRepos.length}</span></div>
          <div class="stat-row"><span>active repos</span><span class="stat-num">${data.repos.length}</span></div>
        </div>
        ${newReposHTML ? `<span class="tag">new this week</span>${newReposHTML}` : ""}
      </div>
    </div>

    <div class="spacer"></div>
    <hr class="rule-heavy">
    <div class="spacer"></div>

    <div class="grid-sections">
      ${sectionStoriesHTML}
    </div>

    <div class="spacer"></div>
    <hr class="rule-heavy">
    <div class="spacer"></div>

    <div class="grid-log">
      <div class="col">
        <span class="tag">full PR log</span>
        <ul class="pr-list">${prListHTML}</ul>
        ${openIssuesHTML ? `<div class="spacer"></div>${openIssuesHTML}` : ""}
      </div>
      <div class="col">
        <span class="tag">commits by repo</span>
        <table class="commit-table">${commitTableHTML}</table>
      </div>
    </div>
  </div>

  <div class="footer">
    ${config.title} · ${weekLabel} · github.com/${config.githubUser} · powered by <a href="https://github.com/NikolayS/gitzette">gitzette</a>
  </div>
</div>
</body>
</html>`;
}
