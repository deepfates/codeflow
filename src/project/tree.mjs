function buildTree(files){
    var root={name:'root',path:'',children:{},files:[]};
    files.forEach(function(f){
        var parts=f.folder&&f.folder!=='root'?f.folder.split('/'):[];
        var cur=root;
        parts.forEach(function(p,i){
            var path=parts.slice(0,i+1).join('/');
            if(!cur.children[p])cur.children[p]={name:p,path:path,children:{},files:[]};
            cur=cur.children[p];
        });
        cur.files.push(f);
    });
    return root;
}
function countFiles(n){return n.files.length+Object.values(n.children).reduce(function(s,c){return s+countFiles(c);},0);}
export {buildTree,countFiles};
