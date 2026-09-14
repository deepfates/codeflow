import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubAdapter} from '../src/project/github.mjs';

function treeAdapter(read){
    const requests=[];
    const adapter=createGitHubAdapter({fetch:async(url,options)=>{
        requests.push(url);
        return new Response(JSON.stringify(await read(new URL(url),options)),{headers:{'Content-Type':'application/json'}});
    }});
    return {adapter,requests};
}
const blob=path=>({path,type:'blob',size:20});
const dir=(path,sha)=>({path,type:'tree',sha});

test('a truncated tree is recovered from the same root SHA beyond ten directory levels',async()=>{
    const {adapter,requests}=treeAdapter(url=>{
        if(url.pathname==='/repos/owner/repo')return {default_branch:'main'};
        if(url.searchParams.has('recursive'))return {sha:'root-sha',truncated:true,tree:[blob('partial-only.ex')]};
        const sha=url.pathname.split('/').at(-1);
        if(sha==='root-sha')return {tree:[blob('mix.exs'),dir('deps','excluded'),dir('lib','level0')]};
        assert.match(sha,/^level\d+$/,'excluded directories must not be requested');
        const level=Number(sha.slice(5));
        return {tree:level<12?[dir('nested','level'+(level+1))]:[blob('worker.ex')]};
    });
    const files=await adapter.scan('owner','repo',null,[]);
    assert.deepEqual(files.map(f=>f.path).sort(),['lib/'+ 'nested/'.repeat(12)+'worker.ex','mix.exs']);
    assert.ok(requests.some(url=>url.endsWith('/root-sha')),'walk uses the immutable root, not a moving branch');
    assert.equal(requests.filter(url=>url.includes('recursive')).length,1);
});

test('a missing subtree fails the scan instead of publishing a partial inventory',async()=>{
    const {adapter}=treeAdapter(url=>{
        if(url.pathname==='/repos/owner/repo')return {default_branch:'main'};
        if(url.searchParams.has('recursive'))return {sha:'root',truncated:true,tree:[blob('incomplete.ex')]};
        if(url.pathname.endsWith('/root'))return {tree:[blob('mix.exs'),dir('lib','unreadable')]};
        throw new Error('subtree unavailable');
    });
    await assert.rejects(adapter.scan('owner','repo',null,[]),/subtree unavailable/);
});

test('a still-truncated nonrecursive tree is an explicit failure',async()=>{
    const {adapter}=treeAdapter(url=>url.pathname==='/repos/owner/repo'?{default_branch:'main'}:{sha:'root',truncated:true,tree:[blob('incomplete.ex')]});
    await assert.rejects(adapter.scan('owner','repo',null,[]),/Incomplete GitHub tree/);
});

test('project cancellation during subtree traversal stops further requests',async()=>{
    const controller=new AbortController();
    const {adapter,requests}=treeAdapter(url=>{
        if(url.pathname==='/repos/owner/repo')return {default_branch:'main'};
        if(url.searchParams.has('recursive'))return {sha:'root',truncated:true,tree:[]};
        controller.abort();
        return {tree:[dir('lib','never-read')]};
    });
    await assert.rejects(adapter.scan('owner','repo',null,[],controller.signal),{name:'AbortError'});
    assert.equal(requests.length,3);
});
