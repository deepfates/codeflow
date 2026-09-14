import test from 'node:test';
import assert from 'node:assert/strict';
import {calcPRRisk,findReviewAreas,findTestImpact,findDependencyChains} from '../src/analysis/pull-request.mjs';

test('review areas count folder members without inventing owners or including sibling prefixes',()=>{
 const data={files:[
  {path:'lib-extra/a.js',folder:'lib-extra',layer:'services'},
  {path:'lib-extra/b.js',folder:'lib-extra',layer:'services'},
  {path:'lib/c.js',folder:'lib',layer:'utils'},
 ]};
 assert.deepEqual(findReviewAreas({files:[{filename:'lib-extra/a.js'}]},data),[
  {layer:'services',count:2,files:['lib-extra/a.js','lib-extra/b.js']},
 ]);
});

test('PR risk, test filename matching, fallback suggestions and dependency chains retain established behavior',()=>{
 const data={files:[{path:'src/lib/a.js',name:'a.js',folder:'src/lib'},
  {path:'test/a.test.js',name:'a.test.js'},
  {path:'test/b.test.js',name:'b.test.js'}],connections:[{source:'src/lib/a.js',target:'test/a.test.js',fn:'a'}]};
 const pr={files:[{filename:'src/lib/a.js'}],additions:600,deletions:0};
 const risk=calcPRRisk(pr,data);
 assert.equal(risk.score,40);assert.equal(risk.level,'high');assert.equal(risk.totalBlast,1);
 assert.deepEqual(findTestImpact(pr,data),[{file:'a.test.js',path:'test/a.test.js'}]);
 assert.deepEqual(findTestImpact({files:[{filename:'unknown.js'}]},data),[
  {file:'a.test.js',path:'test/a.test.js',suggested:true},
  {file:'b.test.js',path:'test/b.test.js',suggested:true},
 ]);
 assert.deepEqual(findDependencyChains({files:[{filename:'test/a.test.js'}]},data),[['a.test.js','a.js']]);
});
