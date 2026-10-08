import { chromium } from "playwright";
import { createServer } from "./serve.mjs";
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.address().port}/og-image.svg`);
  await page.screenshot({ path: "public/og-image.png" });
  console.log("OGP画像をpublic/og-image.pngに保存しました。");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
