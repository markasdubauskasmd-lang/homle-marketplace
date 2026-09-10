import { onboardingNav } from './cleaner-onboarding-steps.js?v=20260816-restore-1';
const root=document.querySelector('.hc-main-inner');
const current=onboardingNav.findIndex(step=>step.href===location.pathname);
function el(tag,cls,text){const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;}
const logo=document.querySelector('.hc-brand-mark');if(logo){logo.href='/cleaner/onboarding';logo.setAttribute('aria-label','Onboarding home');}
if(root && current>=0){
 document.body.dataset.onboardingStep=String(current+1);
 const bar=el('header','of-topbar');const home=el('a','','← Onboarding home');home.href='/cleaner/onboarding';
 const progress=el('div','of-progress');const labels=el('div','of-progress-labels');
 const titleIds={personal:'cleaner-personal-title',business:'cleaner-business-title',banking:'cleaner-banking-title',identity:'cleaner-identity-title',rtw:'cleaner-rtw-title',dbs:'cleaner-background-title',areas:'cleaner-work-title',experience:'cleaner-experience-title',insurance:'cleaner-insurance-title',equipment:'cleaner-equipment-title',training:'academy-title',compliance:'contracts-title',review:'cleaner-review-title'};
 const titleId=location.pathname==='/cleaner/documents' ? 'documents-title' : titleIds[onboardingNav[current].step];
 const stepTitle=document.getElementById(titleId);
 if(stepTitle){const oldHeader=stepTitle.parentElement;stepTitle.classList.add('of-step-title');labels.append(stepTitle);if(!oldHeader.textContent.trim())oldHeader.remove();}
 else labels.append(el('span','',onboardingNav[current].label.toUpperCase()));
 labels.append(el('strong','',`STEP ${current+1} OF ${onboardingNav.length}`));
 const track=el('div','of-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label','Current onboarding step');track.setAttribute('aria-valuemin','1');track.setAttribute('aria-valuemax',String(onboardingNav.length));track.setAttribute('aria-valuenow',String(current+1));
 const fill=el('span','');fill.style.width=`${(current+1)/onboardingNav.length*100}%`;track.append(fill);progress.append(labels,track);
 const exit=el('a','','Back to Homlle.com');exit.href='https://homlle.com/';bar.append(home,progress,exit);root.prepend(bar);
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
