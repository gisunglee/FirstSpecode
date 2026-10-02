/** Real QA route regression checks with isolated in-memory Prisma and auth boundaries. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = 'src/app/api/projects/[id]/test-specs';
const ctx = { params: Promise.resolve({id: 'p1', specId: 's1', roundId: 'r1'}) };
const request = body => ({ json: async () => body });
const input = { testCaseId: 'c1', ctgryCode: 'FUNCTIONAL', scenarioCn: 'action', expectedCn: 'expected' };

function fixture() {
  const state = {
    cases: [{test_case_id:'c1', prjct_id:'p1', test_spec_id:'s1', case_no:1, ctgry_code:'FUNCTIONAL',
      scenario_cn:'action', expected_cn:'expected', grp_nm:'group', precondition_cn:'setup',
      test_data_cn:'fixture', test_account_cn:'OWNER', priort_code:'HIGH', applicable_yn:'Y', ai_gen_yn:'Y', remark_cn:null}],
    results: [],
    round: {round_id:'r1', prjct_id:'p1', test_spec_id:'s1', round_no:1, sttus_code:'IN_PROGRESS'},
    spec: {test_spec_id:'s1', prjct_id:'p1', test_spec_display_id:'TS-1', test_spec_nm:'original', sttus_code:'DRAFT'},
    uwLinks: [{unit_work_id:'uw1'}], screenLinks: [{scrn_id:'screen1'}], query: null,
  };
  const assign = (row, data) => Object.assign(row, Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)));
  const db = {
    tbQaTestSpec: {
      findUnique: async () => state.spec,
      findFirst: async () => ({...state.spec, uwLinks:state.uwLinks, screenLinks:state.screenLinks}),
      findMany: async ({where}) => { state.query=where; return []; },
      update: async ({data}) => assign(state.spec,data),
    },
    tbQaTestCase: {
      findMany: async ({where={}}={}) => state.cases.filter(c =>
        (!where.test_spec_id || c.test_spec_id===where.test_spec_id) &&
        (!where.test_case_id || where.test_case_id.in.includes(c.test_case_id)))
        .map(c => ({...c, _count:{results:state.results.filter(r=>r.test_case_id===c.test_case_id).length}})),
      count: async () => state.cases.length,
      update: async ({where,data}) => assign(state.cases.find(c=>c.test_case_id===where.test_case_id),data),
      create: async ({data}) => { const c={test_case_id:`c${state.cases.length+1}`, ...data}; state.cases.push(c); return c; },
      deleteMany: async ({where}) => {state.cases=state.cases.filter(c=>!where.test_case_id.in.includes(c.test_case_id));},
    },
    tbQaTestResult: {
      findMany: async ({where={}}={}) => state.results.filter(r => !where.round_id ||
        (typeof where.round_id==='string' ? r.round_id===where.round_id : where.round_id.in.includes(r.round_id)))
        .map(r=>({...r, testCase:state.cases.find(c=>c.test_case_id===r.test_case_id)})),
      createMany: async ({data}) => {state.results.push(...data.map((r,i)=>({result_id:`new${i}`,test_dt:null,defects:[],...r})));},
      update: async ({where,data}) => assign(state.results.find(r=>r.result_id===where.result_id),data),
      groupBy: async () => [...new Set(state.results.map(r=>r.result_code))].map(code=>({
        result_code:code, _count:{result_code:state.results.filter(r=>r.result_code===code).length}})),
    },
    tbQaTestRound: {
      findUnique: async () => ({...state.round, results:state.results.map(r=>({...r,testCase:state.cases.find(c=>c.test_case_id===r.test_case_id)}))}),
      findMany: async () => state.round.sttus_code==='IN_PROGRESS' ? [state.round] : [],
      findFirst: async () => null,
      update: async ({data}) => assign(state.round,data),
      create: async ({data}) => {state.round={round_id:'r1',...data};return state.round;},
    },
    tbQaDefect: {findMany:async()=>[],deleteMany:async()=>{},create:async()=>{}},
    tbDsUnitWork: {
      count:async({where})=>where.unit_work_id.in.filter(id=>['uw1','uw2'].includes(id)).length,
      findMany:async()=>[{unit_work_id:'uw1'}],
    },
    tbDsScreen: {count:async({where})=>where.scrn_id.in.filter(id=>id==='screen1').length,findMany:async()=>[]},
    tbQaTestSpecUw: {deleteMany:async()=>{state.uwLinks=[];},createMany:async({data})=>{state.uwLinks=data;}},
    tbQaTestSpecScreen: {deleteMany:async()=>{state.screenLinks=[];},createMany:async({data})=>{state.screenLinks=data;}},
  };
  // Rollback is essential: unsuccessful close/write must leave prior state untouched.
  db.$transaction=async fn=>{const before=structuredClone(state);try{return await fn(db);}catch(e){Object.assign(state,before);throw e;}};
  const mocks={
    'next/server':{}, '@/lib/prisma':{prisma:db},
    '@/lib/requirePermission':{requirePermission:async()=>({})},
    '@/lib/apiResponse':{apiSuccess:(data,status=200)=>({data,status}),apiError:(code,message,status)=>({code,message,status})},
    '@/lib/constants/textLimits':{apiTextLimitGuard:()=>null},
    '@/lib/idPrefix':{getIdPrefix:async()=> 'DF'},
    '@/lib/nextDisplayId':{maxDisplayIdSeq:()=>0},
  };
  const cache=new Map();
  function load(file) {
    file=path.resolve(file);
    if(cache.has(file)) return cache.get(file);
    const exports={}; cache.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,Response,URL,console,require:name=> {
      if(name in mocks) return mocks[name];
      if(name.startsWith('@/lib/qa/')) return load(`src/${name.slice(2)}.ts`);
      if(name==='zod') return require('zod');
      throw Error(`Unexpected dependency: ${name}`);
    }});
    return exports;
  }
  function result(code='PASS') {state.results.push({result_id:'result1',round_id:'r1',test_case_id:'c1',result_code:code,test_dt:code==='PASS'?new Date():null,defects:[]});}
  return {state,load,result};
}

test('MCP partial update preserves context; explicit null clears text',async()=>{
  const f=fixture(), route=f.load(`${root}/[specId]/cases/route.ts`);
  f.state.round.sttus_code='DONE'; // No open round: this case has never been executed.
  assert.equal((await route.POST(request({cases:[{...input,expectedCn:'new'}]}),ctx)).status,200);
  for(const [key,value] of Object.entries({precondition_cn:'setup',test_data_cn:'fixture',test_account_cn:'OWNER',priort_code:'HIGH',ai_gen_yn:'Y'})) assert.equal(f.state.cases[0][key],value);
  assert.equal((await route.POST(request({cases:[{...input,preconditionCn:null}]}),ctx)).status,200);
  assert.equal(f.state.cases[0].precondition_cn,null);
});
test('MCP rejects changing a case used in completed round; old PASS remains',async()=>{
  const f=fixture();f.result();f.state.round.sttus_code='DONE';
  assert.equal((await f.load(`${root}/[specId]/cases/route.ts`).POST(request({cases:[{...input,expectedCn:'new'}]}),ctx)).status,409);
  const r=await f.load(`${root}/[specId]/rounds/[roundId]/route.ts`).GET({},ctx);
  assert.equal(r.data.results[0].expectedCn,'expected');assert.equal(r.data.results[0].resultCode,'PASS');
});
test('unchanged used case may be saved without damaging results',async()=>{
  const f=fixture();f.result();
  assert.equal((await f.load(`${root}/[specId]/cases/route.ts`).POST(request({cases:[input]}),ctx)).status,200);
  assert.equal(f.state.results[0].result_code,'PASS');
});
test('web cannot update another spec case or delete used cases',async()=>{
  const f=fixture();f.result();const route=f.load(`${root}/[specId]/route.ts`);
  const body={testSpecNm:'changed',unitWorkIds:['uw1'],screenIds:[],cases:[]};
  assert.equal((await route.PUT(request(body),ctx)).status,409);
  assert.equal(f.state.spec.test_spec_nm,'original');
  assert.equal((await route.PUT(request({...body,cases:[{...input,caseNo:1,testCaseId:'foreign'}]}),ctx)).status,404);
});
test('metadata PATCH preserves cases and omitted links; rejects foreign/empty targets',async()=>{
  const f=fixture(), route=f.load(`${root}/[specId]/route.ts`);
  assert.equal((await route.PATCH(request({testSpecNm:'new',unitWorkIds:['uw1','uw2']}),ctx)).status,200);
  assert.equal(f.state.cases.length,1);assert.equal(f.state.screenLinks[0].scrn_id,'screen1');
  assert.equal(f.state.uwLinks.length,2);
  assert.equal((await route.PATCH(request({screenIds:['foreign']}),ctx)).status,404);
  assert.equal((await route.PATCH(request({screenIds:[],unitWorkIds:[]}),ctx)).status,400);
  assert.equal((await route.PATCH(request({cases:[]}),ctx)).status,400);
});
test('PENDING blocks close and transaction rolls back; explicit PASS closes',async()=>{
  const f=fixture();f.result('PENDING');const route=f.load(`${root}/[specId]/rounds/[roundId]/route.ts`);
  assert.equal((await route.PUT(request({sttusCode:'DONE',results:[]}),ctx)).status,409);
  assert.equal(f.state.round.sttus_code,'IN_PROGRESS');assert.equal(f.state.spec.sttus_code,'DRAFT');
  assert.equal((await route.PUT(request({sttusCode:'DONE',results:[{resultId:'result1',resultCode:'PASS'}]}),ctx)).status,200);
  assert.equal(f.state.spec.sttus_code,'PASSED');
});
test('legacy unjudged NA becomes PENDING only on open round, explicit NA can close',async()=>{
  const f=fixture();f.result('NA');const route=f.load(`${root}/[specId]/rounds/[roundId]/route.ts`);
  assert.equal((await route.GET({},ctx)).data.results[0].resultCode,'PENDING');
  assert.equal((await route.PUT(request({sttusCode:'DONE'}),ctx)).status,409);
  assert.equal((await route.PUT(request({sttusCode:'DONE',results:[{resultId:'result1',resultCode:'NA',testDt:new Date().toISOString()}]}),ctx)).status,200);
  f.state.results[0].test_dt=null;
  assert.equal((await route.GET({},ctx)).data.results[0].resultCode,'NA');
});
test('round result ownership and closed-round modification are enforced',async()=>{
  const f=fixture();f.result();const route=f.load(`${root}/[specId]/rounds/[roundId]/route.ts`);
  assert.equal((await route.PUT(request({results:[{resultId:'foreign',resultCode:'FAIL'}]}),ctx)).status,404);
  f.state.round.sttus_code='DONE';
  assert.equal((await route.PUT(request({results:[{resultId:'result1',resultCode:'FAIL'}]}),ctx)).status,409);
  assert.equal((await route.PUT(request({sttusCode:'IN_PROGRESS',results:[]}),ctx)).status,200);
});
test('new round and MCP-added case create PENDING; excluded cases create NA',async()=>{
  const f=fixture();
  assert.equal((await f.load(`${root}/[specId]/rounds/route.ts`).POST(request({envirCode:'DEV'}),ctx)).status,201);
  assert.equal(f.state.results[0].result_code,'PENDING');
  const route=f.load(`${root}/[specId]/cases/route.ts`);
  const {testCaseId,...newCase}=input;
  assert.equal((await route.POST(request({cases:[{...newCase,scenarioCn:'extra',applicableYn:'N'}]}),ctx)).status,200);
  assert.equal(f.state.results.find(r=>r.test_case_id==='c2').result_code,'NA');
});
test('UW filter includes both direct UW links and screens owned by UW',async()=>{
  const f=fixture();await f.load(`${root}/route.ts`).GET({url:'https://example.invalid?unitWorkId=uw1'},ctx);
  assert.equal(f.state.query.OR[0].uwLinks.some.unit_work_id,'uw1');
  assert.equal(f.state.query.OR[1].screenLinks.some.screen.unit_work_id,'uw1');
});
