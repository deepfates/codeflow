import workerSource from 'codeflow:analysis-worker';

// Transport owns lifecycle only; both execution paths use the same analyzer.
export function createAnalysisClient({analyzeFiles,yieldFn,Worker=globalThis.Worker}){
    return function runAnalysisData(options){
        if(!Worker)return analyzeFiles({...options,yieldFn});
        return new Promise((resolve,reject)=>{
            const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
            let worker;
            const cleanup=()=>{worker?.terminate();URL.revokeObjectURL(url);};
            try{worker=new Worker(url);}catch(error){
                cleanup();
                // Browser policy can prohibit workers for a local-file page.
                // Analysis errors from a running worker are never retried here.
                resolve(analyzeFiles({...options,yieldFn}));
                return;
            }
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
