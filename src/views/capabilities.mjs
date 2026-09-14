
export function codeFileNavOpensCard(vizType){
    return vizType==='code';
}

export function graphSvgExportEnabled(vizType){
    return vizType!=='code'&&vizType!=='graph3d';
}

export function vizUsesLineThickness(vizType){
    return vizType==='graph'||vizType==='code'||vizType==='graph3d'||vizType==='dendro'||vizType==='sankey'||vizType==='disjoint'||vizType==='bundle';
}

export function vizHasGraphToolbar(vizType){
    return vizType==='graph'||vizType==='code'||vizType==='graph3d';
}

export function vizHasZoomColorBlocks(vizType){
    return vizType==='graph'||vizType==='code';
}

export function vizHasCanvasMinimap(vizType){
    return vizType==='graph'||vizType==='code';
}

export function vizUsesForceLinkParticles(vizType){
    return vizType==='code';
}
