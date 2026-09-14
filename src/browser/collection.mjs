// Acquisition failures remain inventory records. The engine derives syntax,
// layers and parser provenance when it receives all collected source records.
function makeOversizedAnalysisFile(file,size){
    return{path:file.path,name:file.name,folder:file.folder,size:size||0,analysisSkipped:'oversized'};
}
function makeFetchFailedAnalysisFile(file){
    return{path:file.path,name:file.name,folder:file.folder,size:file.size||0,analysisSkipped:'fetch-failed'};
}
export {makeOversizedAnalysisFile,makeFetchFailedAnalysisFile};
