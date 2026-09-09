import { inspectCustomerMotion, assertCustomerMotion } from "./customer-motion-state-helper.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// A real responsive-browser proof for the public account entry.
//
// Source assertions can confirm that Log in and Sign up exist. They cannot prove
// that responsive CSS leaves either control visible and tappable, that the
// cinematic landing design does not overflow a phone sideways once its acts
// start moving, or that its clip and photography actually load.
//
// This is desktop Chromium using a 390 x 844 emulated viewport. It is not a
// physical-phone or touch trial and does not claim to be one.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser mobile-entry checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const server = await serveStatic();
const browser = await launchBrowser();
let failure = null;
const targetRows = [];

try {
  await browser.setViewport({ width: 390, height: 844 });
  await browser.goto(`${server.origin}/home.html`);

  // home.js unhides Log in once it has decided the entry mode. It does that
  // synchronously on import, before its /api/health call resolves.
  const entry = await browser.evaluate(`
    const login = document.querySelector("[data-account-entry]");
    const signupMenu = document.querySelector("[data-signup-menu]");
    const signup = signupMenu.querySelector("summary");
    signupMenu.open = true;
    const bookAccount = signupMenu.querySelector("[data-book-entry]");
    const cleanerAccount = signupMenu.querySelector("[data-cleaner-entry]");
    const heroImages = [...document.querySelectorAll(".ci-hero-img")];
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      login: { hidden: login.hidden, href: login.getAttribute("href"), display: getComputedStyle(login).display, ...rect(login) },
      signup: { text: signup.textContent.trim(), display: getComputedStyle(signup).display, ...rect(signup) },
      bookAccount: { href: bookAccount.getAttribute("href"), text: bookAccount.querySelector("strong").textContent.trim(), ...rect(bookAccount) },
      cleanerAccount: { href: cleanerAccount.getAttribute("href"), text: cleanerAccount.querySelector("strong").textContent.trim(), ...rect(cleanerAccount) },
      heroSources: heroImages.map((image) => image.currentSrc),
      detailVideo: (() => {
        const video = document.querySelector("[data-detail-video]");
        return {
          src: video.getAttribute("src"),
          deferredSrc: video.dataset.videoSrc,
          poster: video.getAttribute("poster"),
          deferredPoster: video.dataset.videoPoster,
          readyState: video.readyState
        };
      })()
    };
  `);
  assert(entry.width === 390, `The responsive proof did not receive the requested viewport: ${entry.width}.`);
  assert(entry.scrollWidth === entry.documentWidth, "The landing page overflows horizontally at 390px.");
  assert(entry.login.hidden === false && entry.login.display !== "none" && entry.login.href === "/login",
    `The mobile Log in control is hidden or misrouted: ${JSON.stringify(entry.login)}.`);
  assert(entry.signup.display !== "none" && entry.signup.text === "Sign up",
    `The mobile Sign up control is hidden or mislabelled: ${JSON.stringify(entry.signup)}.`);
  // The header pair is the only account entry above the fold, so both have to be
  // comfortably tappable and fully inside the viewport.
  for (const [name, control] of [["Log in", entry.login], ["Sign up", entry.signup]]) {
    assert(control.height >= 44 && control.left >= 0 && control.right <= entry.documentWidth,
      `The ${name} control is clipped or too small to tap: ${JSON.stringify(control)}.`);
  }
  assert(entry.bookAccount.href === "/signup?intent=book" && entry.bookAccount.text === "Book cleaning" && entry.bookAccount.height >= 48,
    `The mobile customer role is missing, misrouted or too small: ${JSON.stringify(entry.bookAccount)}.`);
  assert(entry.cleanerAccount.href === "/cleaner/onboarding" && entry.cleanerAccount.text === "Work as a cleaner" && entry.cleanerAccount.height >= 48,
    `The mobile Cleaner role is missing, misrouted or too small: ${JSON.stringify(entry.cleanerAccount)}.`);
  assert(entry.heroSources.length === 2 && entry.heroSources.every((source) => source.endsWith(".webp") && source.includes("-480-")),
    `The 390px landing view downloaded a fallback or oversized hero instead of its 480px WebP pair: ${JSON.stringify(entry.heroSources)}.`);
  assert(entry.detailVideo.src === null && entry.detailVideo.deferredSrc === "/landing/cleaning-720-e8b1a7ce.mp4" && entry.detailVideo.readyState === 0,
    `The below-the-fold detail clip joined the initial mobile load: ${JSON.stringify(entry.detailVideo)}.`);
  assert(entry.detailVideo.poster === null && entry.detailVideo.deferredPoster === "/landing/dark-kitchen-1600-f930f4ce.webp",
    `The below-the-fold detail poster joined the initial mobile load: ${JSON.stringify(entry.detailVideo)}.`);

  // The public page can recover an existing session after first paint. Every
  // conversion prompt must then acknowledge that account instead of sending a
  // signed-in Landlord back through sign-up or Log in again.
  const recoveredAccount = await browser.evaluate(`
    window.dispatchEvent(new CustomEvent("homle:account-ready", {
      detail: { workspace: { role: "landlord", label: "Landlord", href: "/landlord/dashboard" } }
    }));
    const manual = document.querySelector("[data-home-manual-entry]");
    const closing = document.querySelector("[data-home-workspace-entry]");
    const signedOutOnly = [...document.querySelectorAll("[data-home-signed-out-only]")];
    const result = {
      manualHref: manual?.getAttribute("href"),
      manualText: manual?.textContent.trim(),
      closingHref: closing?.getAttribute("href"),
      closingText: closing?.textContent.trim(),
      signedOutPromptsHidden: signedOutOnly.every((element) => element.hidden)
    };
    window.dispatchEvent(new CustomEvent("homle:account-ready", { detail: { workspace: null } }));
    return result;
  `);
  assert(recoveredAccount.manualHref === "/landlord/dashboard#landlord-requests" && recoveredAccount.manualText === "Continue to manual request",
    `A recovered Landlord session still loops through account creation: ${JSON.stringify(recoveredAccount)}.`);
  assert(recoveredAccount.closingHref === "/landlord/dashboard" && recoveredAccount.closingText === "Open Landlord dashboard" && recoveredAccount.signedOutPromptsHidden,
    `The closing conversion prompt does not acknowledge a recovered Landlord session: ${JSON.stringify(recoveredAccount)}.`);

  // Walk the whole page the way a visitor would. Every act pins and unpins, and
  // none of them may push the document sideways while it moves — the design is
  // built from vw-sized transforms, which is exactly how that happens.
  const scrolled = await browser.evaluate(`
    const height = document.documentElement.scrollHeight;
    const documentWidth = document.documentElement.clientWidth;
    let worstScrollWidth = 0;
    for (let i = 0; i <= 24; i++) {
      window.scrollTo(0, Math.round((height - window.innerHeight) * (i / 24)));
      worstScrollWidth = Math.max(worstScrollWidth, document.documentElement.scrollWidth);
    }
    window.scrollTo(0, 0);
    return { documentWidth, worstScrollWidth, height };
  `);
  assert(scrolled.worstScrollWidth === scrolled.documentWidth,
    `Scrolling the landing page creates horizontal overflow: ${scrolled.worstScrollWidth} vs ${scrolled.documentWidth}.`);
  assert(scrolled.height > 844 * 8, `The scroll-driven design collapsed to ${scrolled.height}px, so its acts cannot play.`);

  // The media the design is built on has to actually arrive. A wrong MIME type
  // or a missing file is invisible in source review and fatal on the page.
  // Move each lazy supporting image through the viewport with a paint between
  // positions. A tight synchronous scroll loop proves layout but deliberately
  // does not give Chromium a chance to schedule lazy image requests.
  await browser.evaluate(`
    return await (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (const selector of ["[data-phone-view]", ".ci-manual-bg", "[data-detail-video]"]) {
        const media = document.querySelector(selector);
        media.scrollIntoView({ block: "center" });
        await wait(180);
        if (media instanceof HTMLImageElement && !media.complete) {
          await Promise.race([new Promise((resolve) => media.addEventListener("load", resolve, { once: true })), wait(1500)]);
        }
      }
    })();
  `);
  const media = await browser.evaluate(`
    const images = [...document.images];
    const video = document.querySelector("[data-detail-video]");
    return new Promise((resolve) => {
      const done = () => resolve({
        total: images.length,
        broken: images.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")),
        pending: images.filter((img) => !img.complete).length,
        supportingSources: {
          phone: document.querySelector("[data-phone-view]")?.currentSrc || "",
          manual: document.querySelector(".ci-manual-bg")?.currentSrc || ""
        },
        videoSrc: video ? video.getAttribute("src") : null,
        videoDeferredSrc: video ? video.dataset.videoSrc : null,
        videoPoster: video ? video.getAttribute("poster") : null,
        videoError: video && video.error ? video.error.code : null,
        videoReady: video ? video.readyState : null,
        // Whether this browser can decode the clip's format at all. A Chromium
        // built without proprietary codecs answers "" here, and then reports
        // MEDIA_ERR_SRC_NOT_SUPPORTED for a file every real customer's browser
        // plays. That is a property of the test runner, not of the page.
        h264Support: document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"')
      });
      if (video) video.addEventListener("loadedmetadata", done, { once: true });
      setTimeout(done, 4000);
    });
  `);
  assert(media.total >= 5, `The landing page lost its photography: only ${media.total} images.`);
  assert(media.broken.length === 0, `Landing images failed to load: ${media.broken.join(", ")}.`);
  assert(media.videoSrc === "/landing/cleaning-720-e8b1a7ce.mp4", `The detail act lost its reviewed content-addressed clip: ${media.videoSrc}.`);
  assert(media.videoDeferredSrc === media.videoSrc, `The activated detail clip no longer matches its reviewed deferred source: ${media.videoDeferredSrc}.`);
  assert(/\/landing\/angle-[1-5]-[0-9a-f]{8}\.webp$/.test(media.supportingSources.phone), `The mobile scanner-phone image did not follow the active room angle with its optimized WebP: ${media.supportingSources.phone}.`);
  assert(/\/landing\/sage-living-(?:480|960)-[0-9a-f]{8}\.webp$/.test(media.supportingSources.manual), `The mobile manual-booking background used an oversized JPEG fallback: ${media.supportingSources.manual}.`);
  assert(media.videoPoster === "/landing/dark-kitchen-1600-f930f4ce.webp", `The detail clip retained its full JPEG poster: ${media.videoPoster}.`);
  // Decoding is only meaningful where the runner can decode H.264. Every source,
  // poster and deferred-activation assertion above still runs everywhere; only
  // these two need a codec the browser may not ship. Chrome, Edge, Safari and
  // any CI image with a proprietary-codec build still prove them.
  if (media.h264Support) {
    assert(media.videoError === null, `The landing clip failed to decode, error code ${media.videoError}.`);
    assert(media.videoReady >= 1, "The landing clip never reported metadata, so it will never play.");
  } else {
    console.log("Landing clip decode checks SKIPPED: this Chromium has no H.264 decoder, so it cannot play the reviewed MP4 that customer browsers do.");
  }

  // Reaching the closing act must leave a real sign-up link, not an anchor that
  // scrolls back into the page the way the design prototype did.
  const closing = await browser.evaluate(`
    const join = document.querySelector("[data-stage='join'] a[data-book-entry]");
    const cleaner = document.querySelector("[data-cleaner-entry]");
    const login = document.querySelector(".ci-join-foot a[href='/login']");
    const footerLinks = [...document.querySelectorAll(".ci-footer-links a")];
    const rect = (element) => element ? (() => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; })() : null;
    return {
      joinHref: join ? join.getAttribute("href") : null,
      joinText: join ? join.textContent.trim() : null,
      cleanerHref: cleaner ? cleaner.getAttribute("href") : null,
      login: { href: login ? login.getAttribute("href") : null, ...rect(login) },
      footerLinks: footerLinks.map((link) => ({ href: link.getAttribute("href"), ...rect(link) }))
    };
  `);
  assert(closing.joinHref === "/signup?intent=book", `The closing call to action does not sign anyone up: ${closing.joinHref}.`);
  assert(closing.joinText === "Create your Homle account", `The closing label was overwritten: "${closing.joinText}".`);
  assert(closing.cleanerHref === "/cleaner/onboarding", `Cleaners cannot open dedicated onboarding from the landing page: ${closing.cleanerHref}.`);
  assert(closing.login.href === "/login" && closing.login.height >= 44,
    `The closing Log in link is missing or too small to tap: ${JSON.stringify(closing.login)}.`);
  assert(closing.footerLinks.length === 6 && closing.footerLinks.some((link) => link.href === "/landlord/help") && closing.footerLinks.every((link) => link.height >= 44),
    `The mobile footer links are missing or too small to tap: ${JSON.stringify(closing.footerLinks)}.`);


  // Review original landing sections at all requested sizes in both motion modes.
  const captureRoot=new URL("../test-artifacts/customer-responsive/",import.meta.url);
  await mkdir(captureRoot,{recursive:true});
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]) {
    await browser.setViewport({...viewport,mobile:viewport.width===390});
    for(const reduce of [false,true]) {
      await browser.setReducedMotion(reduce);
      await browser.goto(server.origin+"/home.html");
      await browser.evaluate(`await document.fonts.ready; await new Promise(resolve=>setTimeout(resolve,250)); return true;`);

      // Text may clip inside overflow:hidden even when the document fits.
      if(!reduce) {
        for(const fraction of [0,0.25,0.5,0.75,1]) {
          const bounds=await browser.evaluate(`
            const section=document.querySelector('[data-stage="open"]');
            const top=scrollY+section.getBoundingClientRect().top;
            window.scrollTo({top:top+Math.max(0,section.offsetHeight-innerHeight)*${fraction},behavior:"instant"});
            await new Promise(resolve=>setTimeout(resolve,300));
            return [...section.querySelectorAll(".ci-eyebrow,.ci-hero-l1,.ci-hero-l2,.ci-hero-l3")].map(el=>{
              const range=document.createRange();range.selectNodeContents(el);
              const rect=range.getBoundingClientRect();
              return {text:el.textContent.trim(),left:rect.left,right:rect.right,width:rect.width,viewport:document.documentElement.clientWidth};
            });
          `);
          assert(bounds.length===4, "Hero text measurement missed an element");
          assert(bounds.every(b=>b.width>0&&b.left>=15&&b.right<=b.viewport+1),
            "Hero text clips at "+viewport.width+" scroll="+fraction+": "+JSON.stringify(bounds));
        }
      }
      if(!reduce && viewport.width<=1080) {
        const transforms=new Set();
        for(const fraction of [0,.125,.25,.375,.5,.625,.75,.875,1]) {
          const state=await browser.evaluate(`
            const section=document.querySelector('[data-stage="scan"]');
            const top=scrollY+section.getBoundingClientRect().top;
            window.scrollTo({top:top+Math.max(0,section.offsetHeight-innerHeight)*${fraction},behavior:"instant"});
            await new Promise(resolve=>setTimeout(resolve,650));
            const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
            return {copy:rect(".ci-scan-copy"),phone:rect(".ci-phone"),readout:rect(".ci-readout"),transform:document.querySelector(".ci-phone").style.transform};
          `);
          transforms.add(state.transform);
          assert(state.phone.top>=state.copy.bottom+12&&state.readout.top>=state.phone.bottom+12,
            "Animated scanner panels overlap at "+viewport.width+" progress="+fraction+": "+JSON.stringify(state));
          assert(state.phone.left>=0&&state.phone.right<=viewport.width,"Animated phone clips horizontally at "+viewport.width);
        }
        assert(transforms.size>3,"The mobile scanner animation stopped moving");
      }
      const stages=await browser.evaluate(`return [...document.querySelectorAll("[data-stage]")].map(el=>el.dataset.stage);`);
      assert(JSON.stringify(stages)===JSON.stringify(["open","scan","manual","detail","join"]),"Landing sections changed: "+JSON.stringify(stages));
      for(const stage of stages) {
        const state=await browser.evaluate(`
          const section=document.querySelector('[data-stage="${stage}"]');
          const rect=section.getBoundingClientRect();
          const y=scrollY+rect.top+(${reduce}?0:Math.max(0,rect.height-innerHeight)*0.65);
          window.scrollTo({top:y,behavior:"instant"});
          await new Promise(resolve=>setTimeout(resolve,300));
          return {width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
            reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
            text:section.innerText.trim(),
            animations:document.getAnimations().filter(a=>a.playState==="running"||a.pending).length};
        `);
        if(reduce && stage==="scan" && viewport.width<=1080) {
          const layout=await browser.evaluate(`
            const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
            return {copy:rect(".ci-scan-copy"),phone:rect(".ci-phone-stage"),readout:rect(".ci-readout"),nav:rect(".ci-nav")};
          `);
          assert(layout.copy.top>=layout.nav.bottom, "Still scanner heading is behind the navigation at "+viewport.width);
          assert(layout.phone.top>=layout.copy.bottom+20 && layout.readout.top>=layout.phone.bottom+20,
            "Still scanner panels overlap at "+viewport.width+": "+JSON.stringify(layout));
          assert([layout.copy,layout.phone,layout.readout].every(r=>r.left>=0&&r.right<=viewport.width),
            "Still scanner panel clips horizontally");
        }
        if(stage==="manual" && viewport.width<=1080) {
          const manual=await browser.evaluate(`
            const grid=document.querySelector(".ci-manual-grid");grid.scrollTop=0;
            const title=document.querySelector(".ci-manual-h2").getBoundingClientRect();
            const nav=document.querySelector(".ci-nav").getBoundingClientRect();
            const area=grid.getBoundingClientRect();
            grid.scrollTop=grid.scrollHeight;
            const card=document.querySelector(".ci-mcard").getBoundingClientRect();
            const scroll=grid.scrollTop;grid.scrollTop=0;
            return {titleTop:title.top,navBottom:nav.bottom,bottom:area.bottom,cardBottom:card.bottom,cardWidth:card.width,scroll};
          `);
          assert(manual.titleTop>=manual.navBottom,"Manual heading hidden behind navigation at "+viewport.width+": "+JSON.stringify(manual));
          if(viewport.width>720) assert(manual.cardWidth>0&&manual.cardBottom<=manual.bottom+1,
            "Manual illustration bottom cannot be reached at "+viewport.width+": "+JSON.stringify(manual));
        }
        const label=stage+" "+viewport.width+" reduce="+reduce;
        if(reduce) targetRows.push(await inspectCustomerMotion(browser,"public-home-"+stage+" "+viewport.width));
        assert(state.width===viewport.width&&state.overflow<=1,label+": horizontal overflow "+JSON.stringify(state));
        assert(state.reduced===reduce,label+": motion preference not applied");
        assert(state.text.length>10,label+": missing section content");
        if(reduce) assert(state.animations===0,label+": CSS animations still running");
        if(reduce && stage==="detail") {
          const still=await browser.evaluate(`
            const video=document.querySelector("[data-detail-video]");
            const poster=video.getAttribute("poster");
            if(!poster) return {poster,decoded:false};
            const image=new Image(); image.src=poster; await image.decode();
            return {poster,decoded:image.naturalWidth>0,src:video.getAttribute("src"),paused:video.paused,
              videoRequests:performance.getEntriesByType("resource").filter(r=>/\\.mp4(?:$|\\?)/.test(r.name)).length};
          `);
          assert(still.poster==="/landing/dark-kitchen-1600-f930f4ce.webp" && still.decoded &&
            still.src===null && still.paused && still.videoRequests===0,
            label+": static poster missing or reduced-motion video loaded: "+JSON.stringify(still));
        }
        await writeFile(new URL("home-"+stage+"-"+viewport.width+"-"+(reduce?"reduced":"normal")+".png",captureRoot),await browser.screenshot());
        if(stage==="scan" && viewport.width<=1080) {
          if(!reduce) {
            const endState=await browser.evaluate(`
              const section=document.querySelector('[data-stage="scan"]');
              window.scrollTo({top:scrollY+section.getBoundingClientRect().top+section.offsetHeight-innerHeight,behavior:"instant"});
              await new Promise(resolve=>setTimeout(resolve,900));
              return [...document.querySelectorAll(".ci-readout > div")].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,opacity:Number(getComputedStyle(el).opacity),height:innerHeight};});
            `);
            assert(endState.length===5&&endState.every(r=>r.top>=72&&r.bottom<=r.height+1&&r.opacity>.95),
              "Completed mobile scanner results are not visible: "+JSON.stringify(endState));
          }
          await browser.evaluate(`const r=document.querySelector(".ci-readout").getBoundingClientRect();window.scrollTo({top:scrollY+r.bottom-innerHeight+24,behavior:"instant"});await new Promise(resolve=>setTimeout(resolve,100));return true;`);
          await writeFile(new URL("home-scan-results-"+viewport.width+"-"+(reduce?"reduced":"normal")+".png",captureRoot),await browser.screenshot());
        }
      }
      const footerState=await browser.evaluate(`
        window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"});
        await new Promise(resolve=>setTimeout(resolve,300));
        const number=document.querySelector("[data-mhours]");
        const box=number.getBoundingClientRect();
        const style=getComputedStyle(number);
        return {footerLinks:[...document.querySelectorAll(".ci-footer-links a")].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),
          width:innerWidth,height:innerHeight,number:{text:number.textContent,width:box.width,background:style.backgroundColor}};
      `);
      assert(footerState.footerLinks.length===6,"Homepage footer links missing");
      assert(footerState.footerLinks.every(r=>r.left>=0&&r.right<=footerState.width&&r.top>=0&&r.bottom<=footerState.height),"Homepage footer links clipped at "+viewport.width);
      if(viewport.width>720) assert(footerState.number.width>5&&footerState.number.background==="rgba(0, 0, 0, 0)","Illustrative hour count inherited the decorative dot style");
      await writeFile(new URL("home-footer-"+viewport.width+"-"+(reduce?"reduced":"normal")+".png",captureRoot),await browser.screenshot());
    }
  }

  assertCustomerMotion(targetRows);
  assert(browser.pageErrors.length === 0,
    `The mobile account entry threw in Chromium: ${browser.pageErrors.join(" | ")}`);
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;
console.log("Browser mobile-entry checks passed: 390px account and footer touch targets, no overflow across all six acts, photography and clip load, real sign-up routes.");
