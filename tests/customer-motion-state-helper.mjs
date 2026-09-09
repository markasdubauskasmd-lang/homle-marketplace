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
      const targetFindings = [];
      let targetsInspected = 0;
      let inspected = 0;
      for (const el of document.querySelectorAll("body,body *")) {
        const closed = el.closest("details:not([open])");
        if (closed && !closed.querySelector(":scope > summary")?.contains(el)) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
        if (el.matches("button,input:not([type=hidden]),select,textarea,a[href],summary")
            && !el.matches(":disabled,[aria-disabled=true]") && !el.closest("[inert]")) {
          targetsInspected++;
          let effective = {width:rect.width,height:rect.height};
          let targetSource = "control";
          if (el.matches("input[type=checkbox],input[type=radio]")) {
            for (const label of el.labels || []) {
              const lr = label.getBoundingClientRect();
              if (lr.width >= effective.width && lr.height >= effective.height) {
                effective = {width:lr.width,height:lr.height}; targetSource = "associated label";
              }
            }
          }
          if (effective.width < 44 || effective.height < 44)
            targetFindings.push({tag:el.tagName.toLowerCase(),name:(el.getAttribute("aria-label") || el.textContent?.trim() || el.name || el.type || "").slice(0,100),
              className:el.className,source:targetSource,width:effective.width,height:effective.height});
        }
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
      return {inspected,findings,targetsInspected,targetFindings,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches};
    `);
    assert(result.reduced && result.inspected > 10, label + ": original page not inspected");
    console.log("Customer state motion " + JSON.stringify({label,...result}));
    return {label,...result};
  } finally { await browser.setReducedMotion(previous); }
}
export function assertCustomerMotion(rows) {
  assert.deepEqual(rows.filter(row => row.findings.length), [], "Customer state descendants ignore reduced motion");
  assert.deepEqual(rows.filter(row => row.targetFindings.length), [], "Customer controls below the brief target size");
}
