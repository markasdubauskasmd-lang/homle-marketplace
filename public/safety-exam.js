import {element,requestJson} from './cleaner-page.js?v=20260816-restore-1';
export async function mountSafetyExam(host){
 const section=element('section','hc-academy-card');section.id='safety-exam';
 section.append(element('h2','','Job safety and working practices exam'),element('p','','Loading the current exam requirements…'));
 const status=element('p','','Loading your saved results…');status.setAttribute('role','status');status.tabIndex=-1;
 const history=element('details','exam-history');const form=document.createElement('form');section.append(status,form,history);host.append(section);
 let exam,attemptId,submitting=false,pending=null;
 function renderHistory(attempts){history.replaceChildren(element('summary','',`Saved attempts (${attempts.length})`));
   if(!attempts.length)history.append(element('p','','No attempts saved yet.'));
   for(const a of [...attempts].reverse())history.append(element('p','',`${a.passed?'PASS':'FAIL'} · ${a.scorePercent}% (${a.correctCount}/${a.total}) · ${new Date(a.completedAt).toLocaleString('en-GB')} · ${a.criticalMisses.length} safety-critical errors · ${a.version===exam?.version?'Current exam':'Previous exam version — retained record'} · Practical assessment still required`));
 }
 function renderForm(){section.children[1].textContent=`${exam.questions.length} questions · about ${exam.estimatedMinutes} minutes. Pass: at least ${exam.requiredCorrect} correct (${exam.passPercent}%) and every safety-critical question correct. Based on lessons 01–04: COSHH/PPE, manual handling, safe visits and the Homlle job process. This is Homlle’s knowledge standard, not an HSE qualification. Practical assessment is still required.`;form.replaceChildren();const coverage=element('a','','What this exam covers and HSE guidance');coverage.href='/training-working-guide-v01/exam-coverage.html';coverage.target='_blank';coverage.rel='noopener';form.append(coverage);section.children[0].hidden=false;section.children[1].hidden=false;status.hidden=false;pending=null;attemptId=crypto.randomUUID();
   for(const [i,q] of exam.questions.entries()){
     const field=document.createElement('fieldset');field.style.cssText='margin:18px 0;padding:16px;border:1px solid #c7c2c0;border-radius:12px';
     field.append(element('legend','',`${i+1}. ${q.prompt}${q.critical?' (Safety-critical)':''}`));
     field.append(element('small','',q.lesson.title+' · '+q.category));
     q.options.forEach((option,n)=>{const label=element('label');label.style.cssText='display:flex;gap:12px;align-items:center;padding:9px;cursor:pointer';const radio=document.createElement('input');radio.type='radio';radio.name=q.id;radio.value=String(n);radio.required=true;radio.style.width='auto';label.append(radio,document.createTextNode(option));field.append(label);});form.append(field);
   }
   const button=element('button','','Submit and save result');button.type='submit';form.append(button);
 }
 async function load(){const body=await requestJson('/api/marketplace/cleaner/training/exam');exam=body.exam;renderHistory(exam.attempts);status.textContent='Your submitted results are stored against your signed-in profile.';renderForm();}
 form.addEventListener('submit',async e=>{e.preventDefault();if(submitting)return;submitting=true;const button=form.querySelector('button');button.disabled=true;
   pending ||= {version:exam.version,attemptId,answers:Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,Number(v)]))};
   status.textContent='Saving your result…';
   try{
     const csrf=sessionStorage.getItem('tideway_csrf')||'';
     const body=await requestJson('/api/marketplace/cleaner/training/exam',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(pending)});
     const r=body.result;status.textContent=`${r.passed?'PASS — knowledge check passed':'FAIL — review the lesson and try again'}: ${r.scorePercent}% (${r.correctCount}/${r.total}). ${r.criticalMisses.length} safety-critical errors. Result saved to your profile. Practical competence is not yet assessed.`;
     form.replaceChildren();section.children[0].hidden=true;section.children[1].hidden=true;status.hidden=true;
     const result=element('div',`exam-result ${r.passed?'is-pass':'is-fail'}`);result.dataset.examResult=r.passed?'pass':'fail';
     const icon=element('span','exam-result-icon',r.passed?'✓':'↻');icon.setAttribute('aria-hidden','true');
     const title=element('h2','',r.passed?'Congratulations — you passed!':'Not passed yet — let’s review');title.tabIndex=-1;
     const explanation=r.passed?'You’ve passed the Homlle safety knowledge exam. Your result has been saved to your profile.':r.scorePercent>=80?'You reached 80%, but missed a safety-critical answer. Every safety-critical answer must be correct to pass.':'You need at least 80% and every safety-critical answer correct. Review the points below, then try again.';
     result.append(icon,title,element('p','exam-result-score',`${r.scorePercent}%`),element('p','',`${r.correctCount} of ${r.total} correct · ${r.criticalMisses.length} safety-critical errors`),element('p','',explanation));
     if(!r.passed)result.append(element('p','','This attempt is saved. You can review the lessons and retake the exam.'));
     const actions=element('div','exam-result-actions');
     if(r.passed){const next=element('a','','Continue to worker documents →');next.href='/cleaner/contracts';actions.append(next);}
     const review=element('button','','Review the lessons');review.type='button';review.onclick=()=>document.dispatchEvent(new Event('training-review-lessons'));actions.append(review);
     const retake=element('button','',r.passed?'Take the exam again':'Try the exam again');retake.type='button';retake.addEventListener('click',()=>{renderForm();status.textContent='New attempt. Previous results remain saved.';document.dispatchEvent(new Event('training-retake'));form.scrollIntoView({behavior:'auto'});form.querySelector('input')?.focus();});actions.append(retake);result.append(actions);
     if(r.feedback.length){const feedback=element('div','exam-result-feedback');feedback.append(element('h3','','What to review'));for(const f of r.feedback){const item=element('p','',`${f.question} ${f.explanation} `);if(f.lesson){const link=element('a','','Review '+f.lesson.title);link.href=f.lesson.href;link.target='_blank';link.rel='noopener';item.append(link);}feedback.append(item);}result.append(feedback);}
     result.append(element('small','','This result confirms knowledge only. Practical assessment is still required; passing does not award an accredited qualification.'));form.append(result);document.dispatchEvent(new Event('training-result'));result.scrollIntoView({behavior:'auto'});title.focus();
     try{const fresh=await requestJson('/api/marketplace/cleaner/training/exam');renderHistory(fresh.exam.attempts);}catch{history.append(element('p','','Result was saved, but history could not refresh. Reload to view it.'));}
   }catch(error){status.textContent=`No save confirmed: ${error.message} Retry sends the same attempt and will not create a duplicate.`;button.disabled=false;button.textContent='Retry saving this attempt';for(const radio of form.querySelectorAll('input'))radio.disabled=true;}
   finally{submitting=false;if(!status.hidden)status.focus();}
 });
 try{await load();}catch(error){status.textContent=`Could not load the exam: ${error.message}`;const retry=element('button','','Retry loading');retry.onclick=()=>{retry.remove();load().catch(e=>{status.textContent=e.message;section.append(retry);});};section.append(retry);}
}
