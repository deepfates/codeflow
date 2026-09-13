// A directory frontier over compiler facts. No inferred module or runtime relationships.
export const directory = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const groupId = path => `group:${path}`;
export const fileId = path => `file:${path}`;
export function ancestors(path) {
  const parts = path.split('/'); parts.pop();
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
export function initialExpanded(nodes) {
  const expanded = new Set();
  let prefix = '';
  // Open a single trunk automatically; stop as soon as there is a choice.
  for (;;) {
    const entries = new Set(nodes.map(n => n.path.slice(prefix.length).split('/')[0]));
    if (entries.size !== 1) break;
    const next = prefix + [...entries][0];
    if (nodes.some(n => n.path === next)) break;
    expanded.add(next); prefix = next + '/';
  }
  return expanded;
}
export function projectGraph(graph, expanded = new Set(), kinds = new Set(['compile', 'export', 'runtime'])) {
  const visible = new Map(), owner = new Map();
  for (const node of [...graph.nodes].sort((a, b) => a.path.localeCompare(b.path))) {
    const collapsed = ancestors(node.path).find(path => !expanded.has(path));
    const id = collapsed === undefined ? fileId(node.id) : groupId(collapsed);
    owner.set(node.id, id);
    if (!visible.has(id)) visible.set(id, { id, path: collapsed ?? node.path,
      label: collapsed === undefined ? node.label : collapsed.split('/').pop(),
      type: collapsed === undefined ? 'file' : 'group', members: [], internalCount: 0 });
    visible.get(id).members.push(node.id);
  }
  const edges = new Map();
  for (const edge of graph.edges) {
    if (!kinds.has(edge.kind)) continue;
    const source = owner.get(edge.source), target = owner.get(edge.target);
    if (!source || !target) continue;
    if (source === target) { visible.get(source).internalCount++; continue; }
    const id = JSON.stringify([source, target, edge.kind]);
    if (!edges.has(id)) edges.set(id, { id, source, target, kind: edge.kind, count: 0, members: [] });
    const item = edges.get(id); item.count++; item.members.push(edge);
  }
  return { nodes: [...visible.values()], edges: [...edges.values()], owner };
}
export function neighbors(graph, id, kinds = new Set(['compile', 'export', 'runtime'])) {
  return { incoming: graph.edges.filter(e => kinds.has(e.kind) && e.target === id),
    outgoing: graph.edges.filter(e => kinds.has(e.kind) && e.source === id) };
}
// A focused view includes only relationships touching the chosen file. Connections
// among its neighbors belong to the whole-project view, not this explanation.
export function focusGraph(graph, id, kinds = new Set(['compile', 'export', 'runtime'])) {
  const focal = graph.nodes.find(node => node.id === id);
  if (!focal) return { ...graph, nodes: [], edges: [] };
  const edges = graph.edges.filter(edge => kinds.has(edge.kind) && (edge.source === id || edge.target === id));
  const ids = new Set([id, ...edges.flatMap(edge => [edge.source, edge.target])]);
  return { ...graph, nodes: graph.nodes.filter(node => ids.has(node.id)), edges };
}
