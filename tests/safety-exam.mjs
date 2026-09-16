import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicSafetyExam,gradeSafetyExam,examVersion} from '../src/marketplace/safety-exam.mjs';
const exam=publicSafetyExam();
export const answers={unknown:1,mix:2,sheet:1,ppe:2,skin:1,avoid:0,weight:2,trolley:1,turn:1,pain:2,danger:1,contact:1,floor:2,secret:2,beauty:0,lift:1,split:1,team:2,sofa:0,repeat:2,scope:1,arrival:0,task:2,extra:1,evidence:0};
export const input=(a=answers)=>({version:examVersion,attemptId:randomUUID(),answers:a});
assert.equal(exam.questions.length,25);assert(exam.questions.every(q=>!('correct'in q)));
assert.equal(gradeSafetyExam({...input(),passed:false,scorePercent:0,userId:'someone-else'}).scorePercent,100);
assert.equal(gradeSafetyExam(input({...answers,sheet:0,skin:0,weight:0,turn:0,pain:0})).passed,true);
assert.equal(gradeSafetyExam(input({...answers,sheet:0,skin:0,weight:0,turn:0,pain:0,floor:0})).passed,false);
const critical=gradeSafetyExam(input({...answers,mix:0}));assert.equal(critical.scorePercent,96);assert.equal(critical.passed,false);
assert.throws(()=>gradeSafetyExam(input({})));assert.throws(()=>gradeSafetyExam({...input(),version:'old'}));
assert.throws(()=>gradeSafetyExam(input({...answers,mix:'2'})));
assert.equal(gradeSafetyExam(input()).practicalStatus,'not-assessed');
console.log('PASS: 80% boundary, critical override, strict answers/version, server grading and knowledge-only outcome.');

assert.equal(exam.questions.filter(q=>q.category==='Manual handling').length,10);
assert.equal(exam.requiredCorrect,20);
assert(exam.questions.every(q=>q.lesson.href&&q.lesson.version));
for(const q of exam.questions.filter(q=>q.critical)){assert.equal(gradeSafetyExam(input({...answers,[q.id]:(answers[q.id]+1)%q.options.length})).passed,false);}
