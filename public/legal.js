import { CONFIG } from "./config.js";
for (const node of document.querySelectorAll("[data-operator]")) node.textContent = CONFIG.operatorName || "運営者情報は公開準備中です";
for (const node of document.querySelectorAll("[data-contact]")) {
  if (/^https:\/\//.test(CONFIG.contactUrl)) {
    const a = document.createElement("a");
    a.href = CONFIG.contactUrl;
    a.rel = "noreferrer";
    a.textContent = "お問い合わせ窓口を開く";
    node.replaceChildren(a);
  } else node.textContent = "お問い合わせ窓口は公開準備中です。一般公開前に設定します。";
}
