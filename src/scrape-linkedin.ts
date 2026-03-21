import { chromium } from "playwright";

export interface LinkedInPost {
  text: string;
  date: string;
  url: string;
  likes?: number;
  comments?: number;
}

export interface LinkedInActivity {
  posts: LinkedInPost[];
  comments: LinkedInPost[];
}

export async function scrapeLinkedIn(
  email: string,
  password: string,
  from: Date,
  to: Date,
  headless = true,
): Promise<LinkedInActivity> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  console.log("   LinkedIn: logging in...");
  await page.goto("https://www.linkedin.com/login");
  await page.fill("#username", email);
  await page.fill("#password", password);
  await page.click('[type="submit"]');
  await page.waitForURL(/feed|checkpoint|home/, { timeout: 15000 });

  if (page.url().includes("checkpoint")) {
    await browser.close();
    throw new Error("LinkedIn requires 2FA verification — run with --no-headless and complete manually");
  }

  console.log("   LinkedIn: fetching posts...");
  // Navigate to own profile activity
  await page.goto("https://www.linkedin.com/in/samokhvalov/recent-activity/all/");
  await page.waitForTimeout(3000);

  const posts: LinkedInPost[] = [];
  const comments: LinkedInPost[] = [];

  // Scroll to load content
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1500);
  }

  const items = await page.$$eval(".profile-creator-shared-feed-update__container, .occludable-update", (els) =>
    els.map(el => ({
      text: el.querySelector(".update-components-text")?.textContent?.trim() || "",
      date: el.querySelector("time")?.getAttribute("datetime") || "",
      url: (el.querySelector("a[href*='/posts/'], a[href*='/activity/']") as HTMLAnchorElement)?.href || "",
      likes: parseInt(el.querySelector(".social-details-social-counts__reactions-count")?.textContent?.trim() || "0"),
      comments: parseInt(el.querySelector(".social-details-social-counts__comments")?.textContent?.trim() || "0"),
    }))
  );

  for (const item of items) {
    if (!item.text) continue;
    const date = item.date ? new Date(item.date) : new Date();
    if (date >= from && date <= to) {
      posts.push({ text: item.text.slice(0, 500), date: item.date, url: item.url, likes: item.likes, comments: item.comments });
    }
  }

  await browser.close();
  return { posts, comments };
}
