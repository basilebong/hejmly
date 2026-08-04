import { formatMinutes, type Recipe } from "../shared/index.ts";

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

const esc = (value: string): string => value.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c);

const STYLES = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1e293b; line-height: 1.5; }
  .wrap { max-width: 640px; margin: 0 auto; }
  .eyebrow { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #f97316; font-weight: 700; margin: 0 0 6px; }
  h1 { font-size: 34px; line-height: 1.08; margin: 0 0 10px; letter-spacing: -.01em; }
  .desc { font-size: 15px; color: #475569; margin: 0 0 18px; max-width: 52ch; }
  .meta { font-family: -apple-system, Helvetica, Arial, sans-serif; display: flex; gap: 22px; font-size: 12px; color: #475569; padding: 12px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; margin-bottom: 26px; }
  .meta b { display: block; font-size: 15px; color: #0f172a; font-weight: 700; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 40px; }
  h2 { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin: 0 0 12px; }
  ul.ings { list-style: none; padding: 0; margin: 0; }
  ul.ings li { display: flex; align-items: baseline; font-size: 14px; padding: 5px 0; }
  .ing-name { white-space: nowrap; }
  .ing-dots { flex: 1; border-bottom: 1px dotted #cbd5e1; margin: 0 6px; transform: translateY(-3px); }
  .ing-qty { font-family: -apple-system, Helvetica, Arial, sans-serif; font-variant-numeric: tabular-nums; color: #475569; white-space: nowrap; }
  ol.steps { list-style: none; padding: 0; margin: 0; }
  ol.steps li { display: flex; gap: 14px; margin-bottom: 18px; break-inside: avoid; }
  .step-n { font-family: -apple-system, Helvetica, Arial, sans-serif; flex: 0 0 26px; height: 26px; border-radius: 999px; background: #0f172a; color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
  .step-body h3 { font-size: 16px; margin: 2px 0 3px; }
  .step-body p { font-size: 14px; color: #475569; margin: 0; }
  .step-times { font-family: -apple-system, Helvetica, Arial, sans-serif; margin-top: 6px; }
  .time { display: inline-block; font-size: 11px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 999px; padding: 2px 9px; margin-right: 6px; }
  footer { font-family: -apple-system, Helvetica, Arial, sans-serif; margin-top: 34px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const renderHtml = (recipe: Recipe): string => {
  const ingredients = recipe.ingredients
    .map(
      (it) =>
        `<li><span class="ing-name">${esc(it.name)}</span><span class="ing-dots"></span><span class="ing-qty">${esc(it.quantity)}</span></li>`,
    )
    .join("");

  const steps = recipe.steps
    .map((s, i) => {
      const times = s.timers
        .map((tm) => `<span class="time">${esc(String(tm.minutes))} min · ${esc(tm.label)}</span>`)
        .join("");
      return `<li><div class="step-n">${i + 1}</div><div class="step-body"><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>${times ? `<div class="step-times">${times}</div>` : ""}</div></li>`;
    })
    .join("");

  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(recipe.title)}</title><style>${STYLES}</style></head><body><div class="wrap"><p class="eyebrow">Hejmly · Recipe</p><h1>${esc(recipe.title)}</h1>${recipe.description.length > 0 ? `<p class="desc">${esc(recipe.description)}</p>` : ""}<div class="meta"><span>Total time<b>${esc(formatMinutes(recipe.minutes))}</b></span><span>Serves<b>${esc(String(recipe.serves))}</b></span><span>Added by<b>${esc(recipe.cook.name)}</b></span></div><div class="grid"><section><h2>Ingredients · ${recipe.ingredients.length}</h2><ul class="ings">${ingredients}</ul></section><section><h2>Method</h2><ol class="steps">${steps}</ol></section></div><footer><span>Exported from Hejmly</span><span>${esc(date)}</span></footer></div></body></html>`;
};

export const exportRecipePdf = (recipe: Recipe, onError?: (message: string) => void): void => {
  const win = window.open("", "_blank");
  if (win === null) {
    onError?.("Allow pop-ups to export this recipe as a PDF.");
    return;
  }
  win.document.open();
  win.document.write(renderHtml(recipe));
  win.document.close();
  win.focus();
  win.setTimeout(() => win.print(), 350);
};
