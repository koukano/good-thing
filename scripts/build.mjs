import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../public/config.js";
import { publicConfigReady } from "../public/validation.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const siteUrl = process.env.SITE_URL || CONFIG.siteUrl;
const escape = x => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
if (!siteUrl) throw new Error("公開URLが未設定です。実URLをconfig.jsのsiteUrlまたはSITE_URLに設定してください。");
const url = new URL(siteUrl);
if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) throw new Error("公開URLは実際のHTTPS URLを指定してください。");
if (!publicConfigReady(CONFIG)) throw new Error("Supabase URL・公開キー・Turnstile site keyをconfig.jsに設定してください。");
if (!CONFIG.operatorName.trim() || !/^https:\/\//.test(CONFIG.contactUrl)) throw new Error("運営者の表示名とHTTPSのお問い合わせ窓口を設定してください。");
new URL(CONFIG.contactUrl);
const base = `${url.href.replace(/\/$/, "")}/`;
// このプロジェクトが生成した固定のdistディレクトリだけを作り直します。
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
// 配信するのはpublicだけ。SQL・関数・.env・テストは公開成果物に含めません。
await cp(`${root}public`, `${root}dist`, { recursive: true });
const files = ["index.html", "terms.html", "privacy.html"];
for (const file of files) {
  const canonical = file === "index.html" ? base : new URL(file, base).href;
  const html = await readFile(`${root}public/${file}`, "utf8");
  const meta = `<link rel="canonical" href="${escape(canonical)}">\n<meta property="og:url" content="${escape(canonical)}">\n<meta property="og:image" content="${escape(new URL("og-image.png", base).href)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">`;
  await writeFile(`${root}dist/${file}`, html.replace("</head>", `${meta}\n</head>`));
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map(file => `<url><loc>${escape(file === "index.html" ? base : new URL(file, base).href)}</loc></url>`).join("\n")}\n</urlset>\n`;
await writeFile(`${root}dist/sitemap.xml`, sitemap);
await writeFile(`${root}dist/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${new URL("sitemap.xml", base).href}\n`);
console.log("公開用ファイルをdistに作成しました。サイトURL:", base);
