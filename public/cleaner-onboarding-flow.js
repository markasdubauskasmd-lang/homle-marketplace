import { onboardingNav } from './cleaner-onboarding-steps.js?v=20260816-restore-1';
const root=document.querySelector('.hc-main-inner');
const current=onboardingNav.findIndex(step=>step.href===location.pathname);
function el(tag,cls,text){const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;}
const logo=document.querySelector('.hc-brand-mark');if(logo){logo.href='/cleaner/onboarding';logo.setAttribute('aria-label','Onboarding home');}
if(root && current>=0){
 document.body.dataset.onboardingStep=String(current+1);
 const bar=el('header','of-topbar');const home=el('a','','← Onboarding home');home.href='/cleaner/onboarding';
 const progress=el('div','of-progress');const labels=el('div','of-progress-labels');labels.append(el('span','','COMPLETE REGISTRATION'),el('strong','',`STEP ${current+1} OF ${onboardingNav.length}`));
 const track=el('div','of-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label','Current onboarding step');track.setAttribute('aria-valuemin','1');track.setAttribute('aria-valuemax',String(onboardingNav.length));track.setAttribute('aria-valuenow',String(current+1));
 const fill=el('span','');fill.style.width=`${(current+1)/onboardingNav.length*100}%`;track.append(fill);progress.append(labels,track);
 const exit=el('a','','Back to dashboard');exit.href='/cleaner/dashboard';bar.append(home,progress,exit);root.prepend(bar);
}
// Enhance the existing form sections, retaining labels, validation and save handlers.
for(const form of document.querySelectorAll('form')){
 let index=0;
 for(const fieldset of form.querySelectorAll('fieldset')){
  if(fieldset.parentElement.closest('fieldset'))continue;
  const legend=fieldset.querySelector(':scope > legend');if(!legend)continue;
  fieldset.classList.add('of-card');index++;
  const heading=el('div','of-card-heading');heading.setAttribute('aria-hidden','true');heading.append(el('span','of-card-number',String(index).padStart(2,'0')),el('span','of-card-title',legend.textContent.trim()));legend.after(heading);
 }
}
// One consistent selected icon on every step, including the standalone tabs.
function selectCurrent(){
 for(const a of document.querySelectorAll('[data-onboarding-nav] a[href]')){
  if(a.getAttribute('href')===location.pathname)a.setAttribute('aria-current','page');
 }
}
selectCurrent();
const nav=document.querySelector('[data-onboarding-nav]');if(nav)new MutationObserver(selectCurrent).observe(nav,{childList:true});
