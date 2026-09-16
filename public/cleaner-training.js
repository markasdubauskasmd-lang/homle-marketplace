import {createCleanerPage} from './cleaner-page.js?v=20260816-restore-1';
import {mountSafetyExam} from './safety-exam.js?v=20260916-aligned-2';
createCleanerPage('training',async()=>{
 const lessons=document.querySelector('[data-training-lessons]');
 const panel=document.querySelector('[data-exam-panel]');
 lessons.querySelectorAll('video').forEach(video=>video.addEventListener('play',()=>{lessons.querySelectorAll('video').forEach(other=>{if(other!==video)other.pause();});}));
 function step(value){document.querySelectorAll('[data-journey]').forEach(el=>{if(el.dataset.journey===value)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});}
 function review(){panel.hidden=true;lessons.hidden=false;step('lessons');document.querySelector('[data-start-exam]').focus();lessons.scrollIntoView({behavior:'auto'});}
 document.querySelector('[data-review-lessons]').addEventListener('click',review);
 document.addEventListener('training-review-lessons',review);
 document.addEventListener('training-result',()=>step('result'));
 document.addEventListener('training-retake',()=>step('exam'));
 await mountSafetyExam(document.querySelector('[data-exam-host]'));
 document.querySelector('[data-start-exam]').addEventListener('click',()=>{lessons.querySelectorAll('video').forEach(v=>v.pause());lessons.hidden=true;panel.hidden=false;step(document.querySelector('[data-exam-result]')?'result':'exam');panel.scrollIntoView({behavior:'auto'});const heading=panel.querySelector('[data-exam-result] h2')||panel.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus();}});
});
