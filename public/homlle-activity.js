import { bookingSummaryBuckets, bookingSummaryStatusLabels, bookingSummaryPrimaryAction, bookingSummaryMoneyBoundary, formatBookingMoney } from './booking-summary-model.js?v=20260723-3';

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateKey = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});
const dayLabel = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',weekday:'short',day:'numeric'});
const momentLabel = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
export function activityDateKey(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? dateKey.format(date) : '';
}
export function activityRecords(records) {
  return records.filter(b=>b?.participantRole==='cleaner' && !b.preview && validId.test(String(b.bookingId)));
}
export function activityFeatureBooking(records, dayKeys, selectedDay='') {
  const buckets=bookingSummaryBuckets(activityRecords(records),'cleaner');
  const inRange=b=>selectedDay ? activityDateKey(b.scheduledStartAt)===selectedDay : dayKeys.includes(activityDateKey(b.scheduledStartAt));
  const sort=(a,b)=>Date.parse(a.scheduledStartAt)-Date.parse(b.scheduledStartAt);
  return [...buckets.active.filter(inRange).sort(sort),...buckets.upcoming.filter(inRange).sort(sort)][0] || null;
}
export function activityPhotoUrl(booking, origin) {
  const candidate=[booking?.images,booking?.photos,booking?.propertyPhotos].flatMap(v=>Array.isArray(v)?v:[]).map(v=>typeof v==='string'?v:v?.url);
  for(const value of candidate){
    if(typeof value!=='string'||!value.trim())continue;
    try {const url=new URL(value,origin); if(url.origin===origin && !url.username && !url.password && /^https?:$/.test(url.protocol))return url.href;}catch{}
  }
  return '';
}
function node(tag, cls, text){const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;}
export function renderActivityFeature(records, days, selectedDay='') {
  const host=document.querySelector('[data-activity-feature]');
  if(!host)return;
  const booking=activityFeatureBooking(records,days.map(d=>activityDateKey(d)),selectedDay);
  host.replaceChildren();
  if(!booking){
    const copy=node('div','ha-feature-empty');
    copy.append(node('p','ha-eyebrow',selectedDay?'SELECTED DAY':'YOUR WEEK'),node('h3','',selectedDay?'No confirmed cleans on this day.':'Room for your next clean.'),node('p','','Your confirmed work will appear here. Review available jobs in your areas.'));
    const link=node('a','ha-feature-action','View available jobs ↗');link.href='/cleaner/jobs-map';copy.append(link);host.append(copy);return;
  }
  const visual=node('div','ha-feature-visual');
  const photo=activityPhotoUrl(booking,location.origin);
  if(photo){
    const img=node('img','');img.src=photo;img.alt='Property for this clean';img.decoding='async';
    img.addEventListener('error',()=>{img.remove();visual.prepend(node('p','ha-photo-note','Property photo unavailable'));},{once:true});visual.append(img);
  }else visual.append(node('p','ha-photo-note','No property photo supplied'));
  visual.append(node('span','ha-feature-status',bookingSummaryStatusLabels[booking.status] || 'Scheduled clean'),node('h3','',booking.cleaningType || 'Cleaning'));
  const footer=node('div','ha-feature-footer');
  const details=node('dl','ha-feature-details');
  const duration=(Date.parse(booking.scheduledEndAt)-Date.parse(booking.scheduledStartAt))/3600000;
  for(const [label,value] of [['Area',booking.propertyArea || booking.locationLabel || 'See job details'],['Hours',Number.isFinite(duration)&&duration>0?String(Math.round(duration*10)/10):'To confirm'],['Your agreed pay',formatBookingMoney(booking.pricePence)]]){
    const part=node('div','');part.append(node('dt','',label),node('dd','',value));details.append(part);
  }
  const action=bookingSummaryPrimaryAction(booking,'cleaner');
  const link=node('a','ha-feature-action',action.kind==='active-job'?action.label+' ↗':'View job ↗');
  link.href=action.kind==='active-job'?`/bookings/${booking.bookingId}`:`/cleaner/jobs/${booking.bookingId}`;
  footer.append(details,link);
  host.append(visual,node('p','ha-feature-date',momentLabel.format(new Date(booking.scheduledStartAt))),footer,node('p','ha-feature-boundary',bookingSummaryMoneyBoundary(booking,'cleaner')));
}
export function renderActivityWeek({records, days, selectedDay, onSelect}) {
  const host=document.querySelector('[data-week-grid]');
  const buckets=bookingSummaryBuckets(activityRecords(records),'cleaner');
  const accepted=[...buckets.active,...buckets.upcoming];
  const today=activityDateKey(new Date());
  host.replaceChildren(...days.map(day=>{
    const key=activityDateKey(day);
    const count=accepted.filter(b=>activityDateKey(b.scheduledStartAt)===key).length;
    const pending=buckets.pending.filter(b=>activityDateKey(b.scheduledStartAt)===key).length;
    const button=node('button','ha-day');button.type='button';button.dataset.day=key;
    button.dataset.booked=String(count>0);button.dataset.today=String(key===today);
    button.setAttribute('aria-pressed',String(key===selectedDay));
    button.setAttribute('aria-label',`${dayLabel.format(day)}${key===today?', today':''}: ${count} confirmed ${count===1?'clean':'cleans'}${pending?`, ${pending} awaiting reply`:''}`);
    button.append(node('span','ha-day-block',count?String(count):'—'),node('span','ha-day-label',dayLabel.format(day)),node('span','ha-day-today',key===today?'Today':pending?'Offer':''));
    button.addEventListener('click',()=>onSelect(key));return button;
  }));
  const note=document.querySelector('[data-activity-week-note]');
  const total=accepted.filter(b=>days.some(d=>activityDateKey(d)===activityDateKey(b.scheduledStartAt))).length;
  if(note)note.textContent=`${total} confirmed ${total===1?'clean':'cleans'} this week. Select a day to see its work.`;
  const all=document.querySelector('[data-activity-show-all]');if(all)all.hidden=!selectedDay;
}

export function connectActivityNavigation(){
  for(const link of document.querySelectorAll('.hc-side .hc-nav > .hc-nav-item')){
    const label=link.querySelector('.hc-nav-label')?.textContent?.trim();if(label){link.setAttribute('aria-label',label);link.title=label;}
  }
  const menu=document.querySelector('[data-account-group]');
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary')?.focus();}});
  document.addEventListener('click',event=>{if(menu?.open&&!menu.contains(event.target))menu.open=false;});
}
