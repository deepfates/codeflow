import {detectLayer} from '../analysis/file-types.mjs';
function makeOversizedAnalysisFile(file,size,isCode){
    return{
        path:file.path,
        name:file.name,
        folder:file.folder,
        content:'',
        functions:[],
        lines:0,
        layer:detectLayer(file.path),
        churn:0,
        isCode:isCode,
        size:size||0,
        analysisSkipped:'oversized',
        parserProvenance:'skipped:size-limit'
    };
}
function makeFetchFailedAnalysisFile(file){
    return{
        path:file.path,
        name:file.name,
        folder:file.folder,
        content:'',
        functions:[],
        lines:0,
        layer:detectLayer(file.path),
        churn:0,
        isCode:false,
        size:file.size||0,
        analysisSkipped:'fetch-failed',
        parserProvenance:'skipped:fetch-failed'
    };
}
export {makeOversizedAnalysisFile,makeFetchFailedAnalysisFile};
