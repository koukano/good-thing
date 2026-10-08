import { readFile, writeFile } from "node:fs/promises";

const validation = await readFile(new URL("../public/validation.js", import.meta.url), "utf8");
const main = await readFile(new URL("../supabase/functions/good-things/index.ts", import.meta.url), "utf8");
const importLine = 'import { normalizeBody, validateBody } from "../../../public/validation.js";';
if (!main.includes(importLine)) throw new Error("関数の依存が変わっています。まとめ方を確認してください。");
const bundled = "// 自動生成ファイル。編集元はpublic/validation.jsとsupabase/functions/good-things/index.tsです。\n"
  + "// Supabase Dashboardのindex.tsに全文を貼り付けて公開できます。秘密値は含みません。\n\n"
  + validation.replace(/^export /gm, "") + "\n" + main.replace(importLine, "").trimStart();
const target = new URL("../supabase/dashboard-good-things.ts", import.meta.url);
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8");
  if (current.replace(/\r\n/g, "\n") !== bundled.replace(/\r\n/g, "\n")) throw new Error("画面貼り付け用ファイルが古いです。node scripts/bundle-function.mjsを実行してください。");
} else {
  await writeFile(target, bundled);
  console.log("Supabase画面に貼り付けるファイルをsupabase/dashboard-good-things.tsに生成しました。");
}
