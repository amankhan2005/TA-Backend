const path=require('path'), assert=require('assert'); const B=require('path').resolve(__dirname,'..');
const { requireChild } = require(path.join(B,'middleware/parentAuth'));
function mock(parent, studentId, extra={}){ const req={ parent, params:{studentId}, query:{}, body:extra.body||{} }; let code=null,body=null,nexted=false;
  const res={ status(c){code=c;return this;}, json(b){body=b;return this;} }; const next=()=>{nexted=true;};
  requireChild(req,res,next); return { req, code, body, nexted }; }

const parent = { linkedStudents: [ { student:'stuA', schoolId:'S1', relation:'father' }, { student:'stuB', schoolId:'S2', relation:'guardian' } ] };
let pass=0,fail=0; const t=(n,fn)=>{try{fn();pass++;console.log('  ✅',n)}catch(e){fail++;console.log('  ❌',n,'->',e.message)}};

t('own child (stuA) → allowed, school from link (S1)', ()=>{ const r=mock(parent,'stuA'); assert.ok(r.nexted); assert.strictEqual(r.req.child.schoolId,'S1'); assert.strictEqual(r.req.child.studentId,'stuA'); });
t('second child different school (stuB) → allowed, school S2', ()=>{ const r=mock(parent,'stuB'); assert.ok(r.nexted); assert.strictEqual(r.req.child.schoolId,'S2'); });
t('UNLINKED student → 403, next NOT called', ()=>{ const r=mock(parent,'stuX'); assert.strictEqual(r.nexted,false); assert.strictEqual(r.code,403); });
t('cross-school forgery: client sends schoolId, ignored — link governs', ()=>{ const r=mock(parent,'stuA',{ body:{ schoolId:'S2' } }); assert.strictEqual(r.req.child.schoolId,'S1','schoolId comes from ownership link, never client'); });
t('empty linkedStudents → any student 403', ()=>{ const r=mock({linkedStudents:[]},'stuA'); assert.strictEqual(r.code,403); });
t('no studentId → 400', ()=>{ const req={parent,params:{},query:{},body:{}}; let code; const res={status(c){code=c;return this},json(){return this}}; requireChild(req,res,()=>{}); assert.strictEqual(code,400); });

console.log(`\n══ ownership: ${pass} passed, ${fail} failed ══`);
process.exit(fail?1:0);
