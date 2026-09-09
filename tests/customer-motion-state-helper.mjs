import assert from "node:assert/strict";

// Inspect the current real document state; preserve the caller's preference.
export async function inspectCustomerMotion(browser, label) {
  const previous = await browser.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches');
  await browser.setReducedMotion(true);
  try {
    const result = await browser.evaluate(`
      await document.fonts.ready;
      const seconds = value => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? .001 : 1));
      const findings = [];
      let inspected = 0;
      for (const el of document.querySelectorAll("body,body *")) {
        const closed = el.closest("details:not([open])");
        if (closed && !closed.querySelector(":scope > summary")?.contains(el)) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
        for (const pseudo of [null,"::before","::after"]) {
          const style = getComputedStyle(el,pseudo);
          if (pseudo && ["none","normal"].includes(style.content)) continue;
          inspected++;
          const label = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + [...el.classList].join(".") + (pseudo || "");
          if (style.animationName !== "none" && seconds(style.animationDuration).some(n => n > .00001))
            findings.push({label,kind:"animation",name:style.animationName,duration:style.animationDuration});
          const properties = style.transitionProperty.split(",").map(p => p.trim());
          const durations = seconds(style.transitionDuration);
          if (properties.some((p,i) => /^(all|transform|translate|scale|rotate|width|height|top|left|right|bottom)$/.test(p) && durations[i % durations.length] > .00001))
            findings.push({label,kind:"movement transition",properties,duration:style.transitionDuration});
        }
      }
      return {inspected,findings,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches};
    `);
    assert(result.reduced && result.inspected > 10, label + ": original page not inspected");
    console.log("Customer state motion " + JSON.stringify({label,...result}));
    return {label,...result};
  } finally { await browser.setReducedMotion(previous); }
}
export function assertCustomerMotion(rows) {
  assert.deepEqual(rows.filter(row => row.findings.length), [], "Customer state descendants ignore reduced motion");
}
