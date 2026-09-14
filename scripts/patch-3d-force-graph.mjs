import {createHash} from 'node:crypto';

export const forceGraphUpstreamSha256='d96e738edcca580edd524730c1c6b05ed2efce028c23ca95db1bf43033a72e42';

// 3d-force-graph 1.80.0 dispatches a second, synthetic touch pointerup on node
// dragend without the real pointerId. OrbitControls keeps the mouse pointer in
// its registry, then reads nonexistent touch coordinates and throws. The native
// pointerup already follows dragend and releases the re-enabled controls.
// Remove only the redundant dispatch; preserve real click, drag and orbit input.
// No released fix existed when checked on 2026-09-13; remove this patch when a
// released version passes the native click/drag/orbit browser regression without it.
export function patch3dForceGraph(bytes){
    const sha=createHash('sha256').update(bytes).digest('hex');
    if(sha!==forceGraphUpstreamSha256)throw new Error('3d-force-graph changed: review whether its pointerup patch is still necessary');
    const source=bytes.toString('utf8');
    const redundant=/([a-zA-Z_$][\w$]*)\.domElement&&\1\.domElement\.ownerDocument&&\1\.domElement\.ownerDocument\.dispatchEvent\(new PointerEvent\("pointerup",\{pointerType:"touch"\}\)\)/g;
    if([...source.matchAll(redundant)].length!==1)throw new Error('Expected one redundant 3d-force-graph pointerup dispatch');
    return Buffer.from('/* Codeflow patch: scripts/patch-3d-force-graph.mjs removes redundant synthetic pointerup; native pointerup remains. */\n'+source.replace(redundant,'void 0'));
}
