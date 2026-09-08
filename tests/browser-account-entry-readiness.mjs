import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (!resolveChromiumPath()) {
  console.log("Browser account-readiness check SKIPPED: no Chromium executable found.");
  process.exit(0);
}

const accountHtml = await readFile(new URL("../public/account.html", import.meta.url), "utf8");
const healthDelayMs = 4_000;
const accountRoutes = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email", "/verify-facebook"];
const reviewDocuments = Object.fromEntries(accountRoutes.map(route => [route, accountHtml]));
for (const name of ["privacy", "terms", "facebook-data-deletion"]) {
  reviewDocuments["/" + name] = await readFile(new URL("../public/" + name + ".html", import.meta.url), "utf8");
}
const server = await serveStatic({
  extraFiles: {
    ...reviewDocuments,
    "/login": accountHtml,
    "/forgot-password": accountHtml,
    "/api/auth/providers": () => ({
      body: { ok: true, providers: { emailPassword: false, google: true, apple: false, facebook: false } }
    }),
    // This intentionally behaves like a waking free service. Provider
    // capability is authoritative for the button; marketplace health is only
    // needed later when Homle chooses the signed-in workspace destination.
    "/api/health": async () => {
      await new Promise((resolve) => setTimeout(resolve, healthDelayMs));
      return { body: { ok: true, marketplace: { enabled: true, ready: true } } };
    }
  }
});
const browser = await launchBrowser();
let failure = null;

try {
  await browser.setViewport({ width: 390, height: 844 });
  const startedAt = Date.now();
  await browser.goto(`${server.origin}/login`);
  const state = await browser.evaluate(`
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      const inspect = () => {
        const google = document.querySelector('[data-social-provider="google"]');
        const readiness = document.querySelector('[data-account-state-title]');
        const state = {
          googleHidden: google?.hidden,
          googleHref: google?.getAttribute('href'),
          readiness: readiness?.textContent.trim(),
          runtimeHidden: document.querySelector('[data-account-runtime]')?.hidden
        };
        if (state.googleHidden === false || performance.now() - startedAt >= 2_500) return resolve(state);
        setTimeout(inspect, 25);
      };
      inspect();
    });
  `);
  const elapsedMs = Date.now() - startedAt;

  assert(elapsedMs < healthDelayMs - 1_000,
    `Account entry waited ${elapsedMs}ms for a ${healthDelayMs}ms advisory health response before rendering providers.`);
  assert(state.googleHidden === false && state.googleHref === "/api/marketplace/auth/google/start",
    `Google did not become usable from the provider response: ${JSON.stringify(state)}.`);
  assert(state.runtimeHidden === false && state.readiness === "Secure account access is ready.",
    `Account entry did not reach its provider-ready state independently of health: ${JSON.stringify(state)}.`);

  // A visitor can legitimately abandon a booking or Cleaner application and
  // later use the site's generic Log in action. That fresh entry must not
  // inherit the old role intent and silently steer a dual-role account into
  // the wrong workspace.
  await browser.evaluate(`
    const now = Date.now();
    sessionStorage.setItem("tidewayAccountIntentV1", JSON.stringify({
      version: 1,
      intent: "book",
      savedAt: now,
      expiresAt: now + 30 * 60 * 1000
    }));
    return null;
  `);
  await browser.goto(`${server.origin}/login`);
  const neutralEntry = await browser.evaluate(`
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      const inspect = () => {
        const state = {
          title: document.querySelector('[data-account-title]')?.textContent.trim(),
          googleHref: document.querySelector('[data-social-provider="google"]')?.getAttribute('href'),
          storedIntent: sessionStorage.getItem("tidewayAccountIntentV1")
        };
        if (state.title === "Sign in to Homle" || performance.now() - startedAt >= 2_500) return resolve(state);
        setTimeout(inspect, 25);
      };
      inspect();
    });
  `);
  assert(neutralEntry.title === "Sign in to Homle"
      && neutralEntry.googleHref === "/api/marketplace/auth/google/start"
      && neutralEntry.storedIntent === null,
  `Bare login inherited a stale booking intent: ${JSON.stringify(neutralEntry)}.`);

  await browser.goto(`${server.origin}/forgot-password`);
  const recoveryEntry = await browser.evaluate(`
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      const inspect = () => {
        const state = {
          title: document.querySelector('[data-account-title]')?.textContent.trim(),
          action: document.querySelector('[data-account-unavailable-action]')?.getAttribute('href'),
          unavailableHidden: document.querySelector('[data-account-unavailable]')?.hidden,
          resetFormHidden: document.querySelector('[data-account-form="reset-request"]')?.hidden
        };
        if (state.title === "Password reset is unavailable" || performance.now() - startedAt >= 2_500) return resolve(state);
        setTimeout(inspect, 25);
      };
      inspect();
    });
  `);
  assert(recoveryEntry.title === "Password reset is unavailable"
      && recoveryEntry.action === "/login"
      && recoveryEntry.unavailableHidden === false
      && recoveryEntry.resetFormHidden === true,
  `Conventional recovery entry advertised an email that cannot be sent or failed to offer Google sign-in: ${JSON.stringify(recoveryEntry)}.`);

  await browser.goto(`${server.origin}/login?intent=work`);
  const explicitEntry = await browser.evaluate(`return ({
    title: document.querySelector('[data-account-title]')?.textContent.trim(),
    googleHref: document.querySelector('[data-social-provider="google"]')?.getAttribute('href')
  });`);
  assert(explicitEntry.title === "Sign in to work as a Cleaner"
      && explicitEntry.googleHref === "/api/marketplace/auth/google/start?intent=work",
  `Explicit Cleaner intent was not preserved: ${JSON.stringify(explicitEntry)}.`);

  // Original full documents, with synthetic provider availability and no writes.
  // Missing-token pages exercise recovery presentation, not provider completion.
  const captureRoot = new URL("../test-artifacts/customer-responsive/", import.meta.url);
  await mkdir(captureRoot, { recursive: true });
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]) {
    await browser.setViewport({...viewport,mobile:viewport.width===390});
    for (const route of Object.keys(reviewDocuments)) {
      await browser.goto(server.origin + route);
      const layout = await browser.evaluate(`
        await document.fonts.ready;
        const deadline=Date.now()+6000;
        for (;;) {
          const state=document.querySelector("[data-account-state]");
          const animations=document.getAnimations().filter(a=>(a.playState==="running"||a.pending)&&Number.isFinite(a.effect?.getComputedTiming().endTime));
          if ((!state || state.dataset.state!=="checking") && !animations.length) break;
          if(Date.now()>deadline) throw new Error("Public page did not settle");
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        const main=document.querySelector("main");
        const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=="hidden";};
        const headings=[...document.querySelectorAll("h1,h2")].filter(visible);
        return {width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          text:main?.innerText.trim(),headings:headings.map(el=>el.textContent.trim()),
          clippedControls:[...document.querySelectorAll("main input,main button,main select")].filter(visible).filter(el=>{
            const r=el.getBoundingClientRect();return r.left < -1 || r.right > document.documentElement.clientWidth+1;
          }).map(el=>el.getAttribute("aria-label")||el.textContent.trim()||el.type)};
      `);
      const label=route+" "+viewport.width;
      assert(layout.width===viewport.width && layout.overflow<=1,label+": horizontal overflow "+JSON.stringify(layout));
      assert(layout.text?.length>40 && layout.headings.length>0,label+": missing main content");
      assert(layout.clippedControls.length===0,label+": clipped controls "+JSON.stringify(layout.clippedControls));
      assert(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(layout.text),label+": invalid values reached the page");
      await writeFile(new URL("public-"+route.slice(1)+"-"+viewport.width+".png",captureRoot),await browser.screenshot());
      console.log("Public responsive document "+label+" "+JSON.stringify(layout.headings));
    }
  }

  // Inspect original document descendants, including pseudo-elements and
  // controls below the fold. This complements root-transition checks.
  await browser.setReducedMotion(true);
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]) {
    await browser.setViewport({...viewport,mobile:viewport.width===390});
    for (const route of Object.keys(reviewDocuments)) {
      await browser.goto(server.origin + route);
      const motion = await browser.evaluate(`
        await document.fonts.ready;
        const deadline = Date.now() + 6000;
        while (document.querySelector("[data-account-state]")?.dataset.state === "checking") {
          if (Date.now() > deadline) throw new Error("Account motion state did not settle");
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const seconds = value => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? .001 : 1));
        const findings = [];
        let inspected = 0;
        for (const el of document.querySelectorAll("body,body *")) {
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
        return {reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
          scroll:getComputedStyle(document.documentElement).scrollBehavior, inspected, findings};
      `);
      assert(motion.reduced && motion.scroll === "auto", route + ": reduced scroll preference not applied");
      assert(motion.inspected > 10, route + ": original document not inspected");
      assert(motion.findings.length === 0, route + " " + viewport.width + ": descendant motion " + JSON.stringify(motion.findings));
      console.log("Public descendant motion " + route + " " + viewport.width + ": " + motion.inspected + " elements/pseudo-elements");
    }
  }
  await browser.setReducedMotion(false);

  // Measure exact foreground/background colors in original rendered states.
  // Pointer hover is exercised through input, not by rewriting styles.
  const contrastRows = [];
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]) {
    await browser.setViewport({...viewport,mobile:false});
    for (const route of Object.keys(reviewDocuments)) {
      await browser.goto(server.origin + route);
      const selector = accountRoutes.includes(route) ? ".ae-crumbs li[aria-current]" : ".back-link, .button-secondary";
      const hover = !accountRoutes.includes(route);
      if (hover) await browser.hover(selector);
      const contrast = await browser.evaluate(`
        await document.fonts.ready;
        const el=document.querySelector(${JSON.stringify(selector)});
        if(!el) throw new Error("Contrast target missing");
        el.scrollIntoView({block:"center",behavior:"instant"});
        await new Promise(resolve=>setTimeout(resolve,250));
        const style=getComputedStyle(el),rect=el.getBoundingClientRect();
        const rgb=value=>{
          const match=value.match(/^rgba?\\(([^)]+)\\)$/);
          if(!match) throw new Error("Unsupported color "+value);
          const parts=match[1].split(",").map(Number);
          if(parts.length===4&&parts[3]!==1) throw new Error("Nonopaque color "+value);
          return parts.slice(0,3).map(n=>n/255);
        };
        const lum=value=>rgb(value).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        if(Number(style.opacity)!==1||!rect.width||!rect.height) throw new Error("Contrast target not fully displayed");
        const a=lum(style.color),b=lum(style.backgroundColor),size=parseFloat(style.fontSize),weight=parseFloat(style.fontWeight);
        return {text:el.textContent.trim(),foreground:style.color,background:style.backgroundColor,size,weight,
          ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum:size>=24||(size>=18.6667&&weight>=700)?3:4.5,hover:el.matches(":hover")};
      `);
      assert(!hover || contrast.hover,route+": real pointer hover not active");
      contrastRows.push({route,width:viewport.width,state:hover?"hover":"current step",...contrast});
      await writeFile(new URL("contrast-"+route.slice(1)+"-"+viewport.width+".png",captureRoot),await browser.screenshot());
    }
  }
  console.log("Customer control contrast "+JSON.stringify(contrastRows));
  assert(contrastRows.every(row=>row.ratio>=row.minimum),"Customer control contrast failures: "+JSON.stringify(contrastRows.filter(row=>row.ratio<row.minimum)));

  assert(browser.pageErrors.length === 0,
    `The fast account-entry path threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser account-readiness check passed: Google becomes usable before advisory health, bare login clears stale role intent, conventional password recovery fails safely and explicit intent remains authoritative.");
