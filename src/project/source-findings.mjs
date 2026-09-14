// Keep assessment records intact: this index only associates findings with exact
// current source paths. Severity names remain those supplied by each assessment.
const severityRank={critical:3,high:3,warning:2,medium:2,low:1,info:0};

export function indexSourceFindings(data){
    const index=new Map((data?.files||[]).map(file=>[file.path,{entries:[],count:0,maxSeverity:null}]));
    function add(kind,issue,item,location,severity){
        const file=index.get(location?.path);
        if(!file)return;
        file.entries.push({kind,issue,item,sourceLocation:location,severity});
        file.count++;
        if(severity in severityRank&&(file.maxSeverity===null||severityRank[severity]>severityRank[file.maxSeverity]))file.maxSeverity=severity;
    }
    for(const issue of data?.issues||[]){
        // Providers already supply one precise finding and location; their item
        // is a display mirror, not a second finding.
        if(issue.sourceLocation){
            add('issue',issue,issue.items?.[0]||null,issue.sourceLocation,issue.type);
            continue;
        }
        for(const item of issue.items||[]){
            const locations=[];
            if(item.file)locations.push({path:item.file,line:item.line??null});
            if(item.toFile)locations.push({path:item.toFile,line:null});
            for(const reference of item.files||[]){
                locations.push(typeof reference==='string'?{path:reference,line:null}:{path:reference.file,line:reference.line??null});
            }
            const seen=new Set();
            for(const location of locations){
                const key=JSON.stringify([location.path,location.line]);
                if(seen.has(key))continue;
                seen.add(key);
                add('issue',issue,item,location,issue.type);
            }
        }
    }
    for(const issue of data?.securityIssues||[]){
        add('security',issue,null,{path:issue.path,line:issue.line??null},issue.severity);
    }
    return index;
}
