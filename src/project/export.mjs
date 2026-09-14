// Raw export preserves source evidence and findings, independent of view state.
// Normalize D3's endpoint objects back to stable project identities.
export function exportAnalysis(data){
    return {...data,schemaVersion:1,
        files:data.files.map(file=>({...file,fns:file.functions.length})),
        connections:data.connections.map(edge=>({...edge,
            source:typeof edge.source==='object'?edge.source.id:edge.source,
            target:typeof edge.target==='object'?edge.target.id:edge.target})),
        security:data.securityIssues};
}
