import { projectGraph, initialExpanded, ancestors, neighbors, fileId } from './graph.mjs';
const $ = id => document.getElementById(id);
let graph, expanded = new Set(), cy, projection, selected = null, sourceRequest = 0, layoutRun = 0;
const kinds = () => new Set([...document.querySelectorAll('[name=kind]:checked')].map(n => n.value));
const description = {
  compile: 'The caller has a compile-time dependency on the target. Changes to the dependency can require recompiling the caller.',
  export: 'The caller depends on the target’s exported interface. Changes to that interface can require recompiling the caller.',
  runtime: 'The compiler recorded a runtime reference from caller to dependency. This does not prove that the call executed, or that processes exchanged messages.'
};
function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if(className) node.className=className; return node; }
function button(text, action, className='item') { const b=el('button',text,className); b.addEventListener('click', action); return b; }
function message(text) { $('empty').hidden = !text; $('empty').textContent = text; }
function save() { try { sessionStorage.setItem(`beam:${graph.project.root}`, JSON.stringify([...expanded])); } catch {} }
function openFile(id) {
  const node = graph.nodes.find(n=>n.id===id); if(!node) return;
  for(const path of ancestors(node.path)) expanded.add(path);
  render(false); selectFile(id);
  // ELK is async: reveal the node after its layout settles.
  const run = layoutRun;
  cy.one('layoutstop',()=> { if(run===layoutRun) cy.animate({center:{eles:cy.getElementById(fileId(id))},duration:200}); });
}
function render(fit=false) {
  if(!graph || !cy) return;
  projection=projectGraph(graph,expanded,kinds()); save();
  const positions = new Map(cy.nodes().map(n=>[n.id(),n.position()]));
  cy.elements().remove();
  cy.add([
    ...projection.nodes.map(n=>({data:{...n,display:n.type==='group'?`${n.label}\n${n.members.length} files`:n.label},position:positions.get(n.id)})),
    ...projection.edges.map(e=>({data:{...e,label:e.count>1?String(e.count):''}}))
  ]);
  const currentRun=++layoutRun;
  const layout=cy.layout({name:'elk',fit:false,animate:false,nodeDimensionsIncludeLabels:true,elk:{algorithm:'layered','elk.direction':'RIGHT','elk.spacing.nodeNode':35,'elk.layered.spacing.nodeNodeBetweenLayers':65,'elk.layered.crossingMinimization.semiInteractive':true}});
  layout.one('layoutstop',()=>{if(currentRun===layoutRun && fit) cy.fit(undefined,45);}); layout.run();
  $('view-count').textContent=`${projection.nodes.length} places · ${projection.edges.length} connections`;
  $('expanded').replaceChildren(...[...expanded].sort().map(path=>button(`− ${path}`,()=>{
    for(const p of [...expanded]) if(p===path || p.startsWith(path+'/')) expanded.delete(p);
    render(true); $('selection').replaceChildren(el('h2','Directory folded'),el('p',path,'path'));
  })));
  if(!expanded.size) $('expanded').append(el('p','All directories are folded.','muted small'));
  $('visible-items').replaceChildren(...projection.nodes.map(n=>button(`${n.path}${n.type==='group'?` (${n.members.length} files)`:''}`,()=>selectNode(n))));
  if(selected) cy.getElementById(selected).select();
}
function selectNode(node) {
  selected=node.id; cy.elements().unselect(); cy.getElementById(selected).select();
  if(node.type==='file') { selectFile(node.members[0]); return; }
  sourceRequest++;
  const pane=$('selection'); pane.replaceChildren(el('h2',node.label),el('p',node.path,'path'),el('p',`${node.members.length} compiled source files · ${node.internalCount} internal relationships under the current filters.`));
  pane.append(el('p','This group follows a directory in the project. Open it to inspect its structure.','muted'));
  pane.append(button('Open directory',()=>{expanded.add(node.path);render(true);selectGroupContents(node);},'primary'));
  appendGroupRelations(pane,node);
}
function selectGroupContents(node) {
  const pane=$('selection'); pane.replaceChildren(el('h2',node.label),el('p',node.path,'path'),el('p','Directory opened. Select a smaller group or a source file.'));
  pane.append(button('Fold directory',()=>{for(const p of [...expanded]) if(p===node.path||p.startsWith(node.path+'/'))expanded.delete(p);render(true);selectNode(projection.nodes.find(n=>n.id===node.id));}));
}
function appendGroupRelations(pane,node) {
  for(const [title,items] of [['Depends on',projection.edges.filter(e=>e.source===node.id)],['Used by',projection.edges.filter(e=>e.target===node.id)]]) {
    pane.append(el('h3',title));
    if(!items.length) pane.append(el('p','No visible relationships.','muted small'));
    for(const edge of items) {
      const other=projection.nodes.find(n=>n.id===(edge.source===node.id?edge.target:edge.source));
      pane.append(button(`${other.path} · ${edge.kind} (${edge.count})`,()=>selectEdge(edge)));
    }
  }
}
function selectEdge(edge) {
  sourceRequest++; selected=edge.id; cy.elements().unselect(); cy.getElementById(edge.id).select();
  const pane=$('selection'); const source=projection.nodes.find(n=>n.id===edge.source),target=projection.nodes.find(n=>n.id===edge.target);
  pane.replaceChildren(el('h2',`${edge.kind[0].toUpperCase()+edge.kind.slice(1)} dependency`),el('p',`${source.path} → ${target.path}`,'path'),el('p',description[edge.kind]),el('p',`${edge.count} compiler relationship${edge.count===1?'':'s'}. Grouped arrows aggregate file dependencies; opposite arrows do not by themselves establish a file-level cycle.`,'muted small'));
  for(const fact of edge.members) {
    const block=el('div');block.append(el('h3','Caller → dependency'),button(fact.source,()=>openFile(fact.source)),el('span','↓','muted'),button(fact.target,()=>openFile(fact.target)));pane.append(block);
  }
}
async function selectFile(id) {
  const node=graph.nodes.find(n=>n.id===id); if(!node)return;
  const request=++sourceRequest;selected=fileId(id);cy.elements().unselect();cy.getElementById(selected).select();
  const pane=$('selection');pane.replaceChildren(el('h2',node.label),el('p',node.path,'path'));
  const related=neighbors(graph,id,kinds());
  for(const [title,edges,field] of [['Depends on',related.outgoing,'target'],['Used by',related.incoming,'source']]) {
    const detail=el('details');detail.open=true;detail.append(el('summary',`${title} · ${edges.length}`));
    for(const edge of edges) detail.append(button(`${edge[field]} · ${edge.kind}`,()=>openFile(edge[field])));
    pane.append(detail);
  }
  pane.append(el('h3','Current source on disk'),el('p','Compiler evidence reflects the last successful compilation. Refresh after recompiling to update relationships.','muted small'));
  const pre=el('pre','Loading source…');pane.append(pre);
  try { const response=await fetch(`/__codeflow/file?path=${encodeURIComponent(node.path)}`);if(!response.ok)throw new Error(`Source unavailable (${response.status})`);const source=await response.text();if(request===sourceRequest)pre.textContent=source; }
  catch(error){if(request===sourceRequest)pre.textContent=error.message;}
}
function search() {
  const query=$('search').value.trim().toLowerCase();$('search-results').replaceChildren();if(!query||!graph)return;
  const matches=graph.nodes.filter(n=>n.path.toLowerCase().includes(query));
  $('search-results').append(el('p',`${matches.length} matching files${matches.length>50?' · first 50 shown':''}`,'muted small'),...matches.slice(0,50).map(n=>button(n.path,()=>openFile(n.id))));
}
async function load() {
  $('refresh').disabled=true; message('Reading Mix compiler evidence…');
  try {
    const response=await fetch('/__codeflow/beam');if(!response.ok)throw new Error(`BEAM evidence unavailable (HTTP ${response.status}). Start Codeflow’s local CLI with BEAM support for a compiled Mix project.`);
    const data=await response.json();
    $('warnings').replaceChildren(...(data.warnings||[]).map(w=>el('div',typeof w==='string'?w:JSON.stringify(w))));
    $('project-name').textContent=data.project?.name || 'BEAM project';$('project-context').textContent=`${data.project?.root||''}${data.project?.environment?` · ${data.project.environment}`:''}`;
    if(data.status!=='ready')throw new Error(data.message || data.error?.message || 'Compiler evidence is unavailable. See the warnings for the required setup.');
    if(data.schemaVersion!==1 || !Array.isArray(data.nodes)||!Array.isArray(data.edges))throw new Error('Unsupported compiler graph response.');
    const sameProject=graph?.project?.root===data.project.root;graph=data;
    if(!sameProject){expanded=initialExpanded(graph.nodes);try{const saved=JSON.parse(sessionStorage.getItem(`beam:${graph.project.root}`));if(Array.isArray(saved))expanded=new Set(saved.filter(p=>typeof p==='string'));}catch{}}
    $('totals').textContent=`${graph.nodes.length} source files · ${graph.edges.length} relationships`;
    $('producer').textContent=`Producer: ${graph.producer?.name||'Mix xref'}. ${graph.producer?.version||''}`;
    if(!window.cytoscape)throw new Error('The bundled graph library could not load. Check that vendor assets are installed.');
    if(!cy) {
      cy=window.cytoscape({container:$('graph'),elements:[],minZoom:0.12,maxZoom:3,wheelSensitivity:0.25,style:[
        {selector:'node',style:{'background-color':'#23444b','border-color':'#508a90','border-width':1.5,'shape':'round-rectangle','width':125,'height':45,'label':'data(display)','color':'#e2efed','font-size':11,'text-wrap':'wrap','text-valign':'center','text-halign':'center'}},
        {selector:'node[type="group"]',style:{'background-color':'#1a3a30','border-color':'#55ae88','width':150,'height':64,'font-weight':600}},
        {selector:'edge',style:{'curve-style':'bezier','target-arrow-shape':'triangle','width':1.4,'line-color':'#49616a','target-arrow-color':'#49616a','opacity':0.65,'label':'data(label)','font-size':10,'color':'#c5d2d5','text-background-color':'#101719','text-background-opacity':1,'text-background-padding':3}},
        {selector:'edge[kind="compile"]',style:{'line-color':'#ce9a59','target-arrow-color':'#ce9a59'}},
        {selector:'edge[kind="export"]',style:{'line-color':'#a28bcf','target-arrow-color':'#a28bcf'}},
        {selector:'edge[kind="runtime"]',style:{'line-color':'#5496ae','target-arrow-color':'#5496ae'}},
        {selector:':selected',style:{'border-width':3,'border-color':'#9fffd9','line-color':'#d4ffec','target-arrow-color':'#d4ffec','opacity':1,'z-index':10}}
      ]});
      cy.on('tap','node',event=>selectNode(event.target.data()));cy.on('tap','edge',event=>selectEdge(event.target.data()));
    }
    message(graph.nodes.length?'':'No compiled source files were reported. Check the Mix environment and compile the project.');render(true);search();
  } catch(error) { message(error.message); if(cy)cy.elements().remove();$('view-count').textContent='Evidence unavailable'; }
  finally{$('refresh').disabled=false;}
}
$('fit').onclick=()=>cy?.fit(undefined,45);
$('reset').onclick=()=>{if(!graph)return;expanded=initialExpanded(graph.nodes);selected=null;render(true);};
$('refresh').onclick=load;$('search').addEventListener('input',search);
for(const input of document.querySelectorAll('[name=kind]'))input.addEventListener('change',()=>{render(true);$('selection').replaceChildren(el('h2','Relationship filters updated'),el('p','Select a place or connection to inspect the filtered evidence.'));});
load();
