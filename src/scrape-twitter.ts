import { chromium } from "playwright";

export interface Tweet {
  text: string;
  date: string;
  url: string;
  likes?: number;
  retweets?: number;
  replies?: number;
}

export interface TwitterActivity {
  tweets: Tweet[];
  replies: Tweet[];
}

export async function scrapeTwitter(
  username: string,
  from: Date,
  to: Date,
  headless = true,
  cookiesFile?: string,
): Promise<TwitterActivity> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  // Load saved cookies if provided (avoids login every time)
  if (cookiesFile) {
    try {
      const { readFileSync } = await import("fs");
      const cookies = JSON.parse(readFileSync(cookiesFile, "utf8"));
      await context.addCookies(cookies);
    } catch { /* ignore */ }
  }

  const page = await context.newPage();
  console.log(`   Twitter/X: fetching @${username} tweets...`);

  await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const tweets: Tweet[] = [];
  const replies: Tweet[] = [];

  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1500);
  }

  const items = await page.$$eval("article[data-testid='tweet']", (els) =>
    els.map(el => ({
      text: el.querySelector("[data-testid='tweetText']")?.textContent?.trim() || "",
      date: el.querySelector("time")?.getAttribute("datetime") || "",
      url: "https://x.com" + (el.querySelector("a[href*='/status/']") as HTMLAnchorElement)?.getAttribute("href") || "",
      likes: parseInt(el.querySelector("[data-testid='like'] span")?.textContent?.replace(/[^0-9]/g, "") || "0"),
      retweets: parseInt(el.querySelector("[data-testid='retweet'] span")?.textContent?.replace(/[^0-9]/g, "") || "0"),
      replies: parseInt(el.querySelector("[data-testid='reply'] span")?.textContent?.replace(/[^0-9]/g, "") || "0"),
      isReply: el.querySelector("[data-testid='tweet'] [data-testid='User-Name']")?.textContent?.includes("Replying") || false,
    }))
  );

  for (const item of items) {
    if (!item.text) continue;
    const date = item.date ? new Date(item.date) : new Date();
    if (date >= from && date <= to) {
      const tweet = { text: item.text.slice(0, 500), date: item.date, url: item.url, likes: item.likes, retweets: item.retweets, replies: item.replies };
      if (item.isReply) replies.push(tweet);
      else tweets.push(tweet);
    }
  }

  // Save cookies for next run
  if (cookiesFile) {
    const { writeFileSync } = await import("fs");
    const cookies = await context.cookies();
    writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
  }

  await browser.close();
  return { tweets, replies };
}
