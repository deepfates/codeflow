import workerSource from 'codeflow:analysis-worker';

// Transport owns lifecycle only; both execution paths use the same analyzer.
export function createAnalysisClient({analyzeFiles,yieldFn,Worker=globalThis.Worker}){
    return function runAnalysisData(options){
        const signal=options.signal;
        async function runLocally(){
            signal?.throwIfAborted();
            const result=await analyzeFiles({...options,yieldFn:async()=>{await yieldFn();signal?.throwIfAborted();}});
            signal?.throwIfAborted();return result;
        }
        if(!Worker)return runLocally();
        return new Promise((resolve,reject)=>{
            if(signal?.aborted){reject(signal.reason);return;}
            const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
            let worker;
            const cleanup=()=>{signal?.removeEventListener('abort',abort);worker?.terminate();URL.revokeObjectURL(url);};
            const abort=()=>{cleanup();reject(signal.reason);};
            try{worker=new Worker(url);}catch(error){
                cleanup();
                // Browser policy can prohibit workers for a local-file page.
                // Analysis errors from a running worker are never retried here.
                resolve(runLocally());
                return;
            }
            signal?.addEventListener('abort',abort,{once:true});
            worker.onmessage=({data:message})=>{
                if(message.type==='progress'){options.progress?.(message.message);return;}
                cleanup();
                if(message.type==='done')resolve(message.data);
                else reject(new Error(message.message||'Worker analysis failed'));
            };
            worker.onerror=error=>{cleanup();reject(new Error(error.message||'Worker analysis failed'));};
            try{worker.postMessage({files:options.files||[],excludePatterns:options.excludePatterns||[]});}
            catch(error){cleanup();reject(error);}
        });
    };
}
