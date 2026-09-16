import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
// Drafts must be replaced by approved immutable versions before acceptance is enabled.
export const workerAgreements = [
 ['03-provider-agreement','Worker service agreement','agreement'],
 ['04-privacy-notices','Worker privacy notice','acknowledgement'],
 ['07-conduct-ranking','Code of conduct and rankings','agreement'],
 ['08-cleaning-safety','Cleaning health and safety','acknowledgement'],
 ['09-beauty-standards','Beauty service standards','acknowledgement'],
 ['10-safeguarding-lone-working','Safeguarding and lone working','acknowledgement'],
 ['16-platform-terms','Platform terms','agreement'],
 ['17-payment-invoice-schedule','Payment and invoicing schedule','agreement'],
 ['18-damage-insurance','Damage and insurance policy','acknowledgement']
].map(([id,title,type])=>Object.freeze({id,title,type,version:'draft-v02',approved:false,href:`/worker-documents/v02/${id}.pdf`,sha256:createHash('sha256').update(readFileSync(new URL(`../../public/worker-documents/v02/${id}.pdf`,import.meta.url))).digest('hex')}));
export function validateAcceptance(input,catalogue=workerAgreements){
 const doc=catalogue.find(d=>d.id===input?.documentId);
 if(!doc||!doc.approved)throw Object.assign(new Error('This document is a draft awaiting approval. It cannot be signed.'),{statusCode:409});
 if(doc.version!==input.version||doc.sha256!==input.sha256)throw Object.assign(new Error('The document version changed. Read the current document before signing.'),{statusCode:409});
 const name=typeof input.fullName==='string'?input.fullName.trim():'';
 if(name.length<2||name.length>120||/[\u0000-\u001f]/.test(name)||input.confirmed!==true)throw Object.assign(new Error('Enter your full name and confirm this specific document.'),{statusCode:422});
 return {documentId:doc.id,title:doc.title,version:doc.version,sha256:doc.sha256,type:doc.type,fullName:name,confirmed:true,acceptedAt:new Date().toISOString()};
}
