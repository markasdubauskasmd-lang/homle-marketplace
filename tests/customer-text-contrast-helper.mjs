import assert from "node:assert/strict";

// Measure plain rendered text against its actual solid/composited background.
// Gradients, images, filters and translucent ancestors need visual sampling;
// report those exclusions rather than inventing a contrast result.
export async function inspectCustomerText(browser, label) {
  const result = await browser.evaluate(`
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(v=>v/255);};
    const over=(front,back)=>{const a=front[3]+back[3]*(1-front[3]);return [...[0,1,2].map(i=>a?(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/a:0),a];};
    const lum=c=>c.slice(0,3).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
    let inspected=0,targeted=0;const findings=[],excluded={};
    const modal=document.querySelector("dialog:modal");
    const omit=reason=>{excluded[reason]=(excluded[reason]||0)+1;};
    for(const el of document.querySelectorAll("body *")){
      const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join("").trim();
      if(!text||el.matches("script,style,option"))continue;
      if(modal&&!modal.contains(el)){omit("behind modal");continue;}
      if(el.closest(":disabled,[aria-disabled=true],[inert]")){omit("inactive control");continue;}
      const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
      if(!rect.width||!rect.height||style.visibility!=="visible")continue;
      const closed=el.closest("details:not([open])");if(closed&&!closed.querySelector(":scope > summary")?.contains(el))continue;
      let reason="",bg=[0,0,0,0],backgroundDone=false;
      for(let parent=el;parent;parent=parent.parentElement){
        const s=getComputedStyle(parent);
        if(Number(s.opacity)!==1||s.filter!=="none"||s.mixBlendMode!=="normal"){reason="opacity/filter/blend";break;}
        if(!backgroundDone){
          if(s.backgroundImage!=="none"){reason="image/gradient";break;}
          bg=over(bg,rgba(s.backgroundColor));backgroundDone=bg[3]>=1;
        }
      }
      if(style.textShadow!=="none")reason="text shadow";
      if(reason){omit(reason);continue;}
      bg=over(bg,[1,1,1,1]);const fg=over(rgba(style.color),bg);
      const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const size=parseFloat(style.fontSize),weight=parseFloat(style.fontWeight);
      const minimum=size>=24||(size>=18.6667&&weight>=700)?3:4.5;
      inspected++;
      const enforced=el.matches('body.ci-body :is(.ci-meter-end,.ci-hud-views,.ci-hud-views span,.ci-eyebrow-acc,.ci-beat-title,.ci-tel-price b,.ci-mstep-k,.ci-mstep-k span,.ci-mback,.ci-basket-hours span), body.homle-workspace :is(.hw-feedback,.support-feedback), body.account-entry .account-feedback, body.landlord-dashboard-page:has([data-landlord-panel="home"][hidden]) :is(.account-menu-identity em,.ld-account-identity-copy > div span:first-child), body.active-job-page:has([data-workspace-link][href="/landlord/dashboard"]) :is(.brand span,.account-footer a,.active-job-stages .current span)');
      if(enforced)targeted++;
      if(ratio+0.000001<minimum)findings.push({enforced,tag:el.tagName.toLowerCase(),className:el.className,text:text.slice(0,120),foreground:style.color,background:bg.slice(0,3).map(n=>Math.round(n*255)),ratio,minimum,size,weight});
    }
    // Diagnostic input boundaries: the strongest visible border/fill cue against
    // the surrounding solid surface. Shadows/native indicators need separate review.
    const controls=[];
    const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const surface=start=>{
      let bg=[0,0,0,0],done=false;
      for(let el=start;el;el=el.parentElement){
        const s=getComputedStyle(el);
        if(Number(s.opacity)!==1||s.filter!=="none"||s.mixBlendMode!=="normal")return null;
        if(!done){if(s.backgroundImage!=="none")return null;bg=over(bg,rgba(s.backgroundColor));done=bg[3]>=1;}
      }
      return over(bg,[1,1,1,1]);
    };
    for(const el of document.querySelectorAll("input,textarea,select")){
      if(el.matches('input[type="hidden"],input[type="checkbox"],input[type="radio"],input[type="range"],input[type="color"],input[type="file"],input[type="submit"],input[type="button"],input[type="reset"]'))continue;
      if(el.closest(":disabled,[aria-disabled=true],[inert]")||(modal&&!modal.contains(el)))continue;
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      if(!r.width||!r.height||s.visibility!=="visible"||el.closest("details:not([open])"))continue;
      const outside=surface(el.parentElement),inside=surface(el);
      if(!outside||!inside){controls.push({tag:el.tagName.toLowerCase(),id:el.id,className:el.className,excluded:"non-solid or composited effect"});continue;}
      const borders=["Top","Right","Bottom","Left"].filter(side=>parseFloat(s["border"+side+"Width"])>0&&!["none","hidden"].includes(s["border"+side+"Style"])).map(side=>contrast(over(rgba(s["border"+side+"Color"]),inside),outside));
      const fill=contrast(inside,outside);
      const boundary=Math.max(fill,...borders);
      const focusVisible=el.matches(":focus-visible");
      const outline=parseFloat(s.outlineWidth)>0&&!["none","hidden"].includes(s.outlineStyle)?contrast(over(rgba(s.outlineColor),outside),outside):null;
      controls.push({enforced:el.matches('body.landlord-dashboard-page .ld-account-section .landlord-profile-form :is(input,textarea), body.homle-workspace :is(input,select,textarea), body.journey-page .inp, body.journey-page .scan-overlay :is(.hub-other-input,.scan-item-editor-name,.voice-txt), body.active-job-page:has([data-workspace-link][href="/landlord/dashboard"]) :is(input,select,textarea)'),tag:el.tagName.toLowerCase(),type:el.type||"",id:el.id,className:el.className,empty:!el.value,readOnly:!!el.readOnly,boundary,fill,borders,focusVisible,outline,shadow:s.boxShadow!=="none",appearance:s.appearance});
    }
    return {inspected,targeted,findings,excluded,controls};
  `);
  const {controls,...textResult}=result;
  console.log("Customer text contrast "+JSON.stringify({label,...textResult}));
  console.log("Customer input contrast "+JSON.stringify({label,controls}));
  assert.deepEqual(result.findings.filter(item=>item.enforced), [], label+": customer status text must meet its contrast threshold");
  assert.deepEqual(controls.filter(item=>item.enforced&&item.boundary<3), [], label+": customer input boundaries must reach 3:1");
  assert.deepEqual(controls.filter(item=>item.enforced&&item.focusVisible&&!(item.outline>=3)), [], label+": focused customer inputs must have a visible 3:1 outline");
  return result;
}
