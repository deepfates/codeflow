import test from 'node:test';
import assert from 'node:assert/strict';
import {projectGraph, initialExpanded, neighbors, groupId, fileId} from './graph.mjs';
const paths = ['lib/app/a.ex', 'lib/app/b.ex', 'lib/other/c.ex'];
const graph = {nodes: paths.map(path => ({id:path,path,label:path.split('/').pop()})),edges:[
  {id:'1',source:paths[0],target:paths[2],kind:'compile'},
  {id:'2',source:paths[1],target:paths[2],kind:'compile'},
  {id:'3',source:paths[2],target:paths[0],kind:'runtime'},
  {id:'4',source:paths[0],target:paths[1],kind:'export'}]};
test('initial frontier stops at the first branch', () => {
  assert.deepEqual([...initialExpanded(graph.nodes)], ['lib']);
});
test('collapse preserves direction, kind and multiplicity without manufacturing self loops', () => {
  const result = projectGraph(graph, new Set(['lib']));
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes.find(n=>n.path==='lib/app').internalCount, 1);
  assert.deepEqual(result.edges.map(e=>[e.source,e.target,e.kind,e.count]), [
    [groupId('lib/app'),groupId('lib/other'),'compile',2],
    [groupId('lib/other'),groupId('lib/app'),'runtime',1]]);
  assert.equal(result.edges.flatMap(e=>e.members).length, 3);
});
test('expansion reveals internal relationships and preserves unaffected ids', () => {
  const result = projectGraph(graph, new Set(['lib','lib/app']));
  assert.deepEqual(result.nodes.map(n=>n.id), [fileId(paths[0]),fileId(paths[1]),groupId('lib/other')]);
  assert.equal(result.edges.length,4);
  assert.ok(result.edges.some(e=>e.source===fileId(paths[0]) && e.target===fileId(paths[1]) && e.kind==='export'));
});
test('filter applies to internal counts and neighbors, not file visibility', () => {
  const kinds = new Set(['runtime']);
  const result = projectGraph(graph,new Set(['lib']),kinds);
  assert.equal(result.nodes.length,2);
  assert.equal(result.edges.length,1);
  assert.equal(result.nodes.find(n=>n.path==='lib/app').internalCount,0);
  assert.deepEqual(neighbors(graph,paths[0],kinds),{incoming:[graph.edges[2]],outgoing:[]});
});
test('root files and orphan edges do not become fake groups', () => {
  const result = projectGraph({nodes:[{id:'mix.exs',path:'mix.exs',label:'mix.exs'}],edges:[{source:'absent',target:'mix.exs',kind:'compile'}]});
  assert.equal(result.nodes[0].type,'file'); assert.equal(result.edges.length,0);
});
test('focus includes only incident matching edges, not connections among neighbors', async () => {
  const {focusGraph}=await import('./graph.mjs');
  const focused=focusGraph(graph,paths[0]);
  assert.deepEqual(focused.edges.map(e=>e.id),['1','3','4']);
  assert.equal(focused.nodes.length,3);
  const filtered=focusGraph(graph,paths[0],new Set(['runtime']));
  assert.deepEqual(filtered.edges.map(e=>e.id),['3']);
  assert.deepEqual(filtered.nodes.map(n=>n.id),[paths[0],paths[2]]);
});
test('focus keeps isolated focal files and handles an absent file', async () => {
  const {focusGraph}=await import('./graph.mjs');
  const isolated=focusGraph(graph,paths[1],new Set());
  assert.deepEqual(isolated.nodes.map(n=>n.id),[paths[1]]);
  assert.deepEqual(isolated.edges,[]);
  assert.deepEqual(focusGraph(graph,'absent').nodes,[]);
});
