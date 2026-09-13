import { connectActivityNavigation } from './homlle-activity.js?v=20260908-1';
const payout = location.pathname === '/cleaner/payouts';
if(payout) await import('./cleaner-sidebar.js?v=20260816-restore-1');
const pages = {
 '/cleaner/jobs-map':['Jobs near you','YOUR WORK AREAS','Explore available jobs by area, then review the full clean details before deciding.','map'],
 '/cleaner/messages':['Messages','PRIVATE BOOKING CONVERSATIONS','Chat with clients and the Homlle team. Numbers stay private — everything goes through the app.','messages'],
 '/cleaner/payouts':['Earnings','CLEANER PAYOUTS','Agreed Cleaner pay on completed jobs, and how payouts get set up.','payout'],
 '/cleaner/reviews':['Reviews & ratings','REVIEWS & RATINGS','Reviews from clients after completed jobs.','reviews'],
 '/cleaner/performance':['Performance','RATING & BADGES','Your work, customer feedback and ranking.','perf'],
 '/cleaner/profile/preview':['Your public profile','YOUR PUBLIC PROFILE','Your profile updates as you edit your registration.','profile']
};
const config=pages[location.pathname];
function el(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function link(text,url,cls='hw-link'){const a=el('a',cls,text);a.href=url;return a;}
if(config){
 const [title,eyebrow,description,key]=config;
 const main=document.querySelector('.hc-main-inner');
 const content=payout?document.querySelector('.cleaner-payout-main'):document.querySelector(`[data-${key}]`);
 if(content)content.classList.add('hw-content');
 // Move the page title into one shared header; keep the original controls and data hooks.
 const heading=content?.querySelector('h1');
 if(!payout&&heading){const old=heading.closest('.hc-page-head,.hc-messages-heading');if(old)old.classList.add('hw-legacy-heading');else{heading.hidden=true;const sub=heading.nextElementSibling;if(sub?.matches('p'))sub.hidden=true;}}
 const header=el('header','hw-header');const copy=el('div','hw-header-copy');copy.append(el('p','ha-eyebrow',eyebrow),el('h1','',title),el('p','hw-subtitle',description));
 const account=link('','/cleaner/profile/preview','hw-account');account.setAttribute('aria-label','Your account');const avatar=el('span','hc-avatar','H');avatar.dataset.accountAvatar='';avatar.setAttribute('aria-hidden','true');account.append(avatar,el('span','','Your account'));
 const actions=el('div','hw-header-actions');const bell=document.querySelector('.hc-bell')||link('','/cleaner/notifications','hc-bell');bell.setAttribute('aria-label','Notifications');
 if (!bell.querySelector('svg')) { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6 16v-5a6 6 0 1 1 12 0v5l2 3H4zM10 19a2 2 0 0 0 4 0');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.7');svg.append(path);bell.append(svg); }actions.append(bell,account);header.append(copy,actions);main.prepend(header);
 for(const duplicate of [...document.querySelectorAll('[data-account-group] .ha-account-icon')].slice(1))duplicate.remove();
 document.querySelector('[data-account-group] summary')?.setAttribute('aria-label','Account menu');connectActivityNavigation();
 const rail=document.querySelector('.hc-side .hc-nav');
 for(const a of rail?.querySelectorAll(':scope > a[href]') || []) {
   if(a.getAttribute('href') === location.pathname) a.setAttribute('aria-current','page');
   else a.removeAttribute('aria-current');
 }
 if(key==='reviews')rail?.querySelector('a[href="/cleaner/performance"]')?.setAttribute('aria-current','page');
 if(key==='reviews') content.prepend(link('View public profile ↗','/cleaner/profile/preview','hw-link hw-review-profile'));
 if(key==='reviews'||key==='perf'){
  const tabs=el('nav','hw-tabs');tabs.setAttribute('aria-label','Reviews and performance');for(const [label,url] of [['Reviews & ratings','/cleaner/reviews'],['Performance','/cleaner/performance']]){const a=link(label,url);if(url===location.pathname)a.setAttribute('aria-current','page');tabs.append(a);}content.prepend(tabs);
 }
 if(key==='profile'){
  const photo=content.querySelector('[data-profile-avatar]');if(photo)content.querySelector('.hc-pp-banner')?.append(photo);
  const rail=content.querySelector('.hc-profile-preview-rail');const workspace=el('section','hw-card hw-menu');workspace.append(el('h2','','Workspace'),link('Reviews & ratings','/cleaner/reviews'),link('Performance','/cleaner/performance'));rail.prepend(workspace);
  const menu=el('section','hw-card hw-menu');menu.append(el('h2','','Account'));for(const a of document.querySelectorAll('[data-account-nav] a'))menu.append(link(a.textContent.trim(),a.getAttribute('href')));workspace.after(menu);
  const reviews=link('Reviews & ratings ↗','/cleaner/reviews','hw-profile-reviews');content.querySelector('.hc-pp-badges')?.after(reviews);
 }
 if(key==='map'){
  const back=link('← Back to Activity schedule','/cleaner/dashboard');content.prepend(back);
  const travel=el('section','hw-card hw-travel');const distance=el('p','');distance.dataset.workspaceTravel='';travel.append(distance);travel.append(el('h2','','Travel'),el('p','','Your saved work areas and travel distance control which offers can reach you.'),link('Edit work areas ↗','/cleaner/work-areas'));const results=content.querySelector('.hc-jobs-map-results');const column=el('div','hw-map-column');results.before(column);column.append(results,travel);
 }
}
if(payout){
 const [{readSignedInAccount},{renderAccountAvatar}]=await Promise.all([import('./account-menu.js?v=20260718-3'),import('./account-avatar.js?v=20260718-1')]);
 readSignedInAccount().then(result=>renderAccountAvatar(result.account)).catch(()=>{});
}
