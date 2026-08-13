const LEGACY_EMPTY_DISPATCHES = new Set([
  "<p>no activity this week.</p>",
  "<p>no public repos found.</p>",
]);

export function isLegacyEmptyDispatch(html: string): boolean {
  return LEGACY_EMPTY_DISPATCHES.has(html.trim().toLowerCase());
}

export function addArticleMarkers(html: string): string {
  return html.replace(
    /<div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var\(--rule\);">/g,
    `<div class="article" style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--rule);">`,
  );
}

export function slowNewsCopy(username: string) {
  return {
    masthead: "the dispatch",
    tagline: "A quiet week on the commit front.",
    editionNote: "Zero commits, zero emergencies, and no release notes requiring archaeological work.",
    articles: [{
      repo: "__slow_news__",
      headline: "The Repositories Observe a Moment of Silence",
      deck: `No public commits, pull requests, or releases from @${username} made this edition.`,
      body: `<svg viewBox="0 0 360 150" role="img" aria-label="A quiet desk with a closed laptop" style="float:right;width:min(42%,180px);height:auto;margin:0 0 12px 18px" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="currentColor" stroke-width="3"><path d="M50 115h260M105 98h150l22 17H83zM120 35h120v63H120zM130 45h100v43H130zM45 72h42v43H45zM54 62h24M62 52h8"/><path d="M145 66h70M180 45v43" stroke-width="1"/></g></svg>The public record shows a slow news week. That is not an error and, by software standards, may even qualify as good news. The presses remain ready for the next push.`,
      tag: "QUIET WEEK",
      illustrationPrompt: "",
    }],
    closingNote: "No diffs were harmed in the making of this edition.",
  };
}

export function slowNewsFragment(username: string): string {
  const copy = slowNewsCopy(username);
  const article = copy.articles[0];
  return `<section class="article" style="max-width:760px;margin:0 auto;padding:48px 24px 64px;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px;">${article.tag}</div>
    <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:clamp(32px,8vw,64px);line-height:1.02;margin-bottom:14px;">${article.headline}</h1>
    <p style="font-family:Georgia,serif;font-size:18px;font-style:italic;color:#666;margin-bottom:28px;">${article.deck}</p>
    <div style="font-family:Georgia,serif;font-size:17px;line-height:1.7;">${article.body}</div>
    <div style="clear:both;border-top:1px solid #c8c2b4;margin-top:32px;padding-top:12px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#666;">${copy.closingNote}</div>
  </section>`;
}
