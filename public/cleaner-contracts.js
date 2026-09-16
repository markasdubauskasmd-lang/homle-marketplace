import {createCleanerPage,element,requestJson} from './cleaner-page.js?v=20260816-restore-1';
createCleanerPage('contracts',async({showFeedback})=>{
 const list=document.querySelector('[data-contract-list]');
 const {documents,acceptances}=await requestJson('/api/marketplace/cleaner/agreements');
 const isSigned=doc=>doc.approved&&acceptances.some(a=>a.documentId===doc.id&&a.version===doc.version&&a.sha256===doc.sha256);
 const bulkHost=document.createElement('section');bulkHost.setAttribute('aria-label','Sign all documents');list.before(bulkHost);
 function renderBulk(){
  bulkHost.replaceChildren();
  const pending=documents.filter(doc=>!isSigned(doc));
  const form=document.createElement('form');form.className='agreement-sign-form';form.dataset.signAll='';
  form.append(element('h2','','Sign all documents'));
  form.append(element('p','','Use one name to accept the agreements and acknowledge receipt of the notices listed below. Each PDF is recorded separately on your profile.'));
  const label=element('label','','Full legal name');const name=document.createElement('input');name.required=true;name.minLength=2;name.maxLength=120;name.autocomplete='name';name.placeholder='Type your full legal name';label.append(name);
  const consent=element('label');const check=document.createElement('input');check.type='checkbox';check.required=true;consent.append(check,document.createTextNode(' I have read all the PDFs listed below. I agree to the contractual agreements and acknowledge receiving and reading the notices. This is not blanket consent to process my data.'));
  const button=element('button','','Sign all documents');button.type='submit';button.disabled=!pending.length||documents.some(doc=>!doc.approved);
  const status=element('p','','');status.setAttribute('role','status');
  form.append(label,consent,button,status);
  if(documents.some(doc=>!doc.approved))status.textContent='Available when all listed PDFs are final and approved. Drafts cannot be signed.';
  else if(!pending.length){status.textContent='All current documents have been recorded on your profile.';label.hidden=true;consent.hidden=true;}
  form.onsubmit=async e=>{
   e.preventDefault();if(button.disabled)return;button.disabled=true;let saved=0;
   try{
    for(const doc of documents.filter(d=>!isSigned(d))){
     status.textContent='Saving '+doc.title+'…';
     const {acceptance}=await requestJson('/api/marketplace/cleaner/agreements',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':sessionStorage.getItem('tideway_csrf')||''},body:JSON.stringify({documentId:doc.id,version:doc.version,sha256:doc.sha256,fullName:name.value,confirmed:check.checked})});
     acceptances.push(acceptance);saved++;
     const row=list.querySelector('[data-document-id="'+doc.id+'"]');if(row){row.querySelector('p').textContent='Saved to your profile · '+acceptance.fullName;row.querySelector('form')?.remove();}
    }
    status.textContent='All documents have been recorded on your profile.';button.textContent='All documents signed';
   }catch(error){status.textContent=saved+' document(s) saved during this attempt. The remaining documents are not confirmed: '+error.message+' Retry to save only those still outstanding.';button.textContent='Retry remaining documents';button.disabled=false;}
  };
  bulkHost.append(form);
 }
 renderBulk();
 list.replaceChildren();
 for(const doc of documents){
  const row=element('li','');row.dataset.documentId=doc.id;row.style.cssText='padding:20px 0;border-bottom:1px solid #ddd;list-style:none';
  const link=element('a','',doc.title+' — open PDF');link.href=doc.href;link.target='_blank';link.rel='noopener';
  const signed=doc.approved && acceptances.find(a=>a.documentId===doc.id&&a.version===doc.version&&a.sha256===doc.sha256);
  const state=element('p','',signed?`Recorded ${new Date(signed.acceptedAt).toLocaleString('en-GB')} · ${signed.fullName}`:doc.approved?'Ready to review and accept':'DRAFT — awaiting approval; signing disabled');
  row.append(link,state,element('small','',`Version: ${doc.version} · ${doc.type==='agreement'?'Contractual agreement':'Receipt acknowledgement'}`));
  if(!signed){
   const form=document.createElement('form');form.className='agreement-sign-form';const label=element('label','','Full legal name');const name=document.createElement('input');name.placeholder='Type your full legal name';name.required=true;name.minLength=2;name.maxLength=120;name.autocomplete='name';label.append(name);
   const consent=element('label');const check=document.createElement('input');check.type='checkbox';check.required=true;consent.append(check,document.createTextNode(doc.type==='agreement'?' I have read this version and agree to it.':' I acknowledge receiving and reading this notice.'));
   const submit=element('button','',doc.type==='agreement'?'Sign this agreement':'Record acknowledgement');submit.type='submit';submit.disabled=!doc.approved;form.append(label,consent,submit);if(!doc.approved){form.append(element('small','','Signing opens when Homlle publishes the final approved PDF. Your name will only be saved when you sign.'));}
   form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const csrf=sessionStorage.getItem('tideway_csrf')||'';const {acceptance}=await requestJson('/api/marketplace/cleaner/agreements',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({documentId:doc.id,version:doc.version,sha256:doc.sha256,fullName:name.value,confirmed:check.checked})});state.textContent=`Saved to your profile · ${acceptance.fullName} · ${new Date(acceptance.acceptedAt).toLocaleString('en-GB')}`;form.remove();acceptances.push(acceptance);renderBulk();}catch(error){showFeedback('No signature confirmed: '+error.message,'error');submit.disabled=false;}};row.append(form);
  }
  list.append(row);
 }
});
