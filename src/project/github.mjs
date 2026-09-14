import {isCode} from '../analysis/file-types.mjs';
import {shouldExcludeFile,shouldIgnoreDirectory} from './exclusions.mjs';
function buildGitHubApiUrl(segments,query){
    var path=segments.filter(function(segment){return segment!==undefined&&segment!==null&&segment!=='';}).map(function(segment){
        return encodeURIComponent(String(segment));
    }).join('/');
    var url='https://api.github.com/'+path;
    if(!query)return url;
    var params=new URLSearchParams();
    Object.keys(query).forEach(function(key){
        var value=query[key];
        if(value===undefined||value===null||value==='')return;
        params.set(key,String(value));
    });
    var queryString=params.toString();
    return queryString?url+'?'+queryString:url;
}

function buildRepoApiUrl(owner,repo,segments,query){
    return buildGitHubApiUrl(['repos',owner,repo].concat(segments||[]),query);
}

function splitRepoPath(path){
    return (path||'').split('/').filter(Boolean);
}

function decodeBase64Utf8(content){
    if(content==null)return null;
    var normalized=String(content||'').replace(/\s+/g,'');
    if(!normalized)return '';
    var binary=atob(normalized);
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    try{
        return new TextDecoder('utf-8').decode(bytes);
    }catch(e){
        var text='';
        for(var j=0;j<bytes.length;j++)text+=String.fromCharCode(bytes[j]);
        return text;
    }
}

export function createGitHubAdapter({fetch=globalThis.fetch,KJUR}={}){
var GitHub={
    token:'',
    appId:null,
    privateKey:null,
    installationToken:null,
    installationTokenExpiry:null,
    rateLimit:{remaining:60,limit:60,reset:0},
    requestTimeoutMs:15000,

    // Generate JWT for GitHub App authentication
    generateJWT:function(){
        if(!this.appId||!this.privateKey)return null;
        try{
            var now=Math.floor(Date.now()/1000);
            var payload={
                iat:now-60,// Issued at (60 seconds in past to account for clock drift)
                exp:now+600,// Expires in 10 minutes (max allowed)
                iss:this.appId
            };
            var header={alg:'RS256',typ:'JWT'};
            var sHeader=JSON.stringify(header);
            var sPayload=JSON.stringify(payload);
            var jwt=KJUR.jws.JWS.sign('RS256',sHeader,sPayload,this.privateKey);
            return jwt;
        }catch(e){
            console.error('JWT generation failed:',e);
            return null;
        }
    },

    getRepoInstallation:function(owner,repo){
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['repos',owner,repo,'installation']),{
            headers:{
                'Accept':'application/vnd.github.v3+json',
                'Authorization':'Bearer '+jwt
            }
        },{401:'Invalid App credentials',404:'This GitHub App is not installed on the selected repository'});
    },

    // Get installation access token
    getInstallationToken:function(installationId){
        var self=this;
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['app','installations',String(installationId),'access_tokens']),{
            method:'POST',
            headers:{
                'Accept':'application/vnd.github.v3+json',
                'Authorization':'Bearer '+jwt
            }
        },{401:'Invalid App credentials',404:'Installation not found'}).then(function(data){
            self.installationToken=data.token;
            self.installationTokenExpiry=new Date(data.expires_at).getTime();
            self.token=data.token;// Use installation token for API calls
            return data.token;
        });
    },

    // Authenticate with GitHub App for a specific repo
    authenticateApp:function(owner,repo){
        var self=this;
        // Check if we have a valid installation token
        if(this.installationToken&&this.installationTokenExpiry&&Date.now()<this.installationTokenExpiry-60000){
            this.token=this.installationToken;
            return Promise.resolve(this.installationToken);
        }
        return this.getRepoInstallation(owner,repo).then(function(installation){
            if(!installation||!installation.id){
                throw new Error('No installation found for this repository');
            }
            return self.getInstallationToken(installation.id);
        });
    },

    request:function(url,options,errorMap){
        var self=this;
        var h=Object.assign({'Accept':'application/vnd.github.v3+json'},options&&options.headers?options.headers:{});
        if(this.token&&!h.Authorization)h.Authorization='Bearer '+this.token;
        var controller=new AbortController();
        var timeoutId=setTimeout(function(){controller.abort();},this.requestTimeoutMs);
        var requestOptions=Object.assign({},options||{},{headers:h,signal:controller.signal});
        return fetch(url,requestOptions).then(function(r){
            // Track rate limit from headers
            var rem=r.headers.get('x-ratelimit-remaining');
            var lim=r.headers.get('x-ratelimit-limit');
            var rst=r.headers.get('x-ratelimit-reset');
            if(rem!==null)self.rateLimit.remaining=parseInt(rem,10);
            if(lim!==null)self.rateLimit.limit=parseInt(lim,10);
            if(rst!==null)self.rateLimit.reset=parseInt(rst,10);
            if(!r.ok){
                throw new Error(
                    errorMap&&errorMap[r.status]
                        ? errorMap[r.status]
                        : r.status===401
                            ? 'Invalid token'
                            : r.status===403
                                ? 'Rate limited - add a GitHub token for 5000 req/hour'
                                : r.status===404
                                    ? 'Repository not found'
                                    : r.status===429
                                        ? 'Rate limited (429) - add a GitHub token'
                                        : 'Error '+r.status
                );
            }
            return r.json();
        }).catch(function(err){
            if(err&&err.name==='AbortError'){
                throw new Error('GitHub request timed out. Please try again.');
            }
            throw err;
        }).finally(function(){
            clearTimeout(timeoutId);
        });
    },
    fetch:function(url,options,errorMap){
        return this.request(url,options,errorMap);
    },
    getRateLimit:function(){
        var self=this;
        return this.request(buildGitHubApiUrl(['rate_limit'])).then(function(d){
            if(d.resources&&d.resources.core){
                self.rateLimit.remaining=d.resources.core.remaining;
                self.rateLimit.limit=d.resources.core.limit;
                self.rateLimit.reset=d.resources.core.reset;
            }
            return self.rateLimit;
        }).catch(function(){return self.rateLimit;});
    },
    getFile:function(o,r,p){
        return this.fetch(buildRepoApiUrl(o,r,['contents'].concat(splitRepoPath(p)))).then(function(d){return typeof d.content==='string'?decodeBase64Utf8(d.content):null;}).catch(function(){return null;});
    },
    getCommits:function(o,r,path,limit){
        if(this.rateLimit.remaining<20&&!this.token)return Promise.resolve([]);// Skip when rate limited
        return this.fetch(buildRepoApiUrl(o,r,['commits'],{per_page:limit||30,path:path||undefined})).catch(function(){return[];});
    },
    getBlame:function(o,r,path){
        return this.getCommits(o,r,path,50).then(function(commits){
            var authors={};
            commits.forEach(function(c){var name=c.commit.author.name;authors[name]=(authors[name]||0)+1;});
            return Object.entries(authors).map(function(e){return{name:e[0],commits:e[1],percent:Math.round(e[1]/commits.length*100)};}).sort(function(a,b){return b.commits-a.commits;});
        }).catch(function(){return[];});
    },
    getPR:function(o,r,prNum){
        var self=this;
        return this.fetch(buildRepoApiUrl(o,r,['pulls',String(prNum)])).then(function(pr){
            return self.fetch(buildRepoApiUrl(o,r,['pulls',String(prNum),'files'])).then(function(files){
                pr.files=files;return pr;
            });
        }).catch(function(){return null;});
    },
    // Fast scan using Git Trees API (single request for all files!)
    scanTree:function(o,r,cb,compiledPatterns){
        var self=this;
        if(cb)cb('Fetching repository tree...');
        // First get repo info to find default branch
        return this.fetch(buildRepoApiUrl(o,r)).then(function(repo){
            var branch=repo.default_branch||'main';
            if(cb)cb('Loading file tree ('+branch+')...');
            // Get full tree in one request with recursive flag
            return self.fetch(buildRepoApiUrl(o,r,['git','trees',branch],{recursive:1}));
        }).then(function(tree){
            if(!tree.tree)throw new Error('Invalid tree response');
            var f=[];
            tree.tree.forEach(function(i){
                if(i.type!=='blob')return;
                var name=i.path.includes('/')?i.path.substring(i.path.lastIndexOf('/')+1):i.path;
                if(shouldExcludeFile(i.path,name,compiledPatterns))return;
                var pathParts=i.path.split('/');
                var ignored=pathParts.slice(0,-1).some(function(part,idx){
                    var dirPath=pathParts.slice(0,idx+1).join('/');
                    return shouldIgnoreDirectory(dirPath,part,compiledPatterns);
                });
                if(ignored)return;
                var folder=i.path.includes('/')?i.path.substring(0,i.path.lastIndexOf('/')):'root';
                f.push({path:i.path,name:name,folder:folder,size:i.size||0,isCode:isCode(name)});
            });
            if(cb)cb('Found '+f.length+' files');
            return f;
        });
    },
    // Fallback: recursive scan using Contents API (many requests)
    scanRecursive:function(o,r,cb,p,d,compiledPatterns){
        var self=this;p=p||'';d=d||0;
        if(d>10)return Promise.resolve([]);
        return this.fetch(buildRepoApiUrl(o,r,['contents'].concat(splitRepoPath(p)))).then(function(c){
            var f=[];
            var promises=[];
            c.forEach(function(i){
                if(i.type==='file'&&!shouldExcludeFile(i.path,i.name,compiledPatterns)){
                    f.push({path:i.path,name:i.name,folder:i.path.includes('/')?i.path.substring(0,i.path.lastIndexOf('/')):'root',size:i.size,isCode:isCode(i.name)});
                }else if(i.type==='dir'&&!shouldIgnoreDirectory(i.path,i.name,compiledPatterns)){
                    if(cb)cb('/'+i.path);
                    promises.push(self.scanRecursive(o,r,cb,i.path,d+1,compiledPatterns).catch(function(){return[];}));
                }
            });
            return Promise.all(promises).then(function(results){
                results.forEach(function(res){f=f.concat(res);});
                return f;
            });
        }).catch(function(e){if(d===0)throw e;return[];});
    },
    // Smart scan: try tree API first (1 request), fallback to recursive
    scan:function(o,r,cb,compiledPatterns){
        var self=this;
        return this.scanTree(o,r,cb,compiledPatterns).catch(function(e){
            if(cb)cb('Tree API failed, using fallback...');
            return self.scanRecursive(o,r,cb,'',0,compiledPatterns);
        });
    }
};
return GitHub;
}
export {buildGitHubApiUrl,buildRepoApiUrl,splitRepoPath,decodeBase64Utf8};
