import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubAdapter} from '../src/project/github.mjs';

function pendingAdapter(){
    const calls=[];
    const adapter=createGitHubAdapter({fetch:(url,{signal})=>new Promise((resolve,reject)=>{
        calls.push({url,signal,resolve});
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    })});
    return {adapter,calls};
}
test('cancelling a GitHub scan aborts its request without issuing further requests',async()=>{
    const {adapter,calls}=pendingAdapter(),controller=new AbortController();
    const scan=adapter.scan('owner','repo',()=>{},[],controller.signal);
    controller.abort();
    await assert.rejects(scan,{name:'AbortError'});
    assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,true);
});
test('source and history reads propagate cancellation instead of reporting empty results',async()=>{
    const {adapter,calls}=pendingAdapter(),controller=new AbortController();
    const source=adapter.getFile('owner','repo','lib/file.ex',controller.signal);
    const history=adapter.getCommits('owner','repo','lib/file.ex',10,controller.signal);
    controller.abort();
    await Promise.all([assert.rejects(source,{name:'AbortError'}),assert.rejects(history,{name:'AbortError'})]);
    assert.equal(calls.length,2);assert.ok(calls.every(call=>call.signal.aborted));
});
test('request timeout remains distinguishable from cancelling a project selection',async()=>{
    const {adapter}=pendingAdapter();adapter.requestTimeoutMs=5;
    await assert.rejects(adapter.request('https://api.github.com/test'),/GitHub request timed out/);
});
test('an obsolete response cannot publish when the transport ignores abort',async()=>{
    let finish;
    const adapter=createGitHubAdapter({fetch:()=>new Promise(resolve=>{finish=resolve;})});
    const controller=new AbortController();
    const request=adapter.request('https://api.github.com/test',{signal:controller.signal});
    controller.abort();
    finish({ok:true,headers:new Headers(),json:async()=>({value:'obsolete'})});
    await assert.rejects(request,{name:'AbortError'});
});
