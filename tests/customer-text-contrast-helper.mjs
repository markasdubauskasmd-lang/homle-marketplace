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
      const enforced=el.matches('body.homle-workspace :is(.hw-feedback,.support-feedback), body.account-entry .account-feedback, body.landlord-dashboard-page:has([data-landlord-panel="home"][hidden]) :is(.account-menu-identity em,.ld-account-identity-copy > div span:first-child), body.active-job-page:has([data-workspace-link][href="/landlord/dashboard"]) :is(.brand span,.account-footer a,.active-job-stages .current span)');
      if(enforced)targeted++;
      if(ratio+0.000001<minimum)findings.push({enforced,tag:el.tagName.toLowerCase(),className:el.className,text:text.slice(0,120),foreground:style.color,background:bg.slice(0,3).map(n=>Math.round(n*255)),ratio,minimum,size,weight});
    }
    return {inspected,targeted,findings,excluded};
  `);
  console.log("Customer text contrast "+JSON.stringify({label,...result}));
  assert.deepEqual(result.findings.filter(item=>item.enforced), [], label+": customer status text must meet its contrast threshold");
  return result;
}
