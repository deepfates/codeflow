function escapeHtml(value){
    return String(value==null?'':value)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}
function renderTooltipHtml(title,stats){
    return '<div class="treemap-tooltip-title">'+escapeHtml(title)+'</div>'+stats.map(function(stat){
        return '<div class="treemap-tooltip-stat"><span>'+escapeHtml(stat.label)+':</span><span>'+escapeHtml(stat.value)+'</span></div>';
    }).join('');
}
export {escapeHtml,renderTooltipHtml};
