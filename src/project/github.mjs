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

    getRepoInstallation:function(owner,repo,signal){
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['repos',owner,repo,'installation']),{
            signal,headers:{
                'Accept':'application/vnd.github.v3+json',
                'Authorization':'Bearer '+jwt
            }
        },{401:'Invalid App credentials',404:'This GitHub App is not installed on the selected repository'});
    },

    // Get installation access token
    getInstallationToken:function(installationId,signal){
        var self=this;
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['app','installations',String(installationId),'access_tokens']),{
            signal,method:'POST',
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
    authenticateApp:function(owner,repo,signal){
        var self=this;
        // Check if we have a valid installation token
        if(this.installationToken&&this.installationTokenExpiry&&Date.now()<this.installationTokenExpiry-60000){
            this.token=this.installationToken;
            return Promise.resolve(this.installationToken);
        }
        return this.getRepoInstallation(owner,repo,signal).then(function(installation){
            if(!installation||!installation.id){
                throw new Error('No installation found for this repository');
            }
            return self.getInstallationToken(installation.id,signal);
        });
    },

    request:function(url,options,errorMap){
        var self=this;
        var h=Object.assign({'Accept':'application/vnd.github.v3+json'},options&&options.headers?options.headers:{});
        if(this.token&&!h.Authorization)h.Authorization='Bearer '+this.token;
        var controller=new AbortController();
        var signal=options&&options.signal;
        if(signal&&signal.aborted)return Promise.reject(signal.reason);
        var cancel=function(){controller.abort(signal.reason);};
        if(signal)signal.addEventListener('abort',cancel,{once:true});
        var timedOut=false;
        var timeoutId=setTimeout(function(){timedOut=true;controller.abort();},this.requestTimeoutMs);
        var requestOptions=Object.assign({},options||{},{headers:h,signal:controller.signal});
        return fetch(url,requestOptions).then(function(r){
            controller.signal.throwIfAborted();
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
            return r.json().then(function(data){controller.signal.throwIfAborted();return data;});
        }).catch(function(err){
            if(signal&&signal.aborted)throw signal.reason;
            if(timedOut&&err&&err.name==='AbortError'){
                throw new Error('GitHub request timed out. Please try again.');
            }
            throw err;
        }).finally(function(){
            clearTimeout(timeoutId);
            if(signal)signal.removeEventListener('abort',cancel);
        });
    },
    fetch:function(url,options,errorMap){
        return this.request(url,options,errorMap);
    },
    getRateLimit:function(signal){
        var self=this;
        return this.request(buildGitHubApiUrl(['rate_limit']),{signal}).then(function(d){
            if(d.resources&&d.resources.core){
                self.rateLimit.remaining=d.resources.core.remaining;
                self.rateLimit.limit=d.resources.core.limit;
                self.rateLimit.reset=d.resources.core.reset;
            }
            return self.rateLimit;
        }).catch(function(){if(signal)signal.throwIfAborted();return self.rateLimit;});
    },
    getFile:function(o,r,p,signal){
        return this.fetch(buildRepoApiUrl(o,r,['contents'].concat(splitRepoPath(p))),{signal}).then(function(d){return typeof d.content==='string'?decodeBase64Utf8(d.content):null;}).catch(function(){if(signal)signal.throwIfAborted();return null;});
    },
    getCommits:function(o,r,path,limit,signal){
        if(this.rateLimit.remaining<20&&!this.token)return Promise.resolve([]);// Skip when rate limited
        return this.fetch(buildRepoApiUrl(o,r,['commits'],{per_page:limit||30,path:path||undefined}),{signal}).catch(function(){if(signal)signal.throwIfAborted();return[];});
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
    async scan(o,r,cb,compiledPatterns,signal){
        if(cb)cb('Fetching repository tree...');
        const repo=await this.fetch(buildRepoApiUrl(o,r),{signal});
        const branch=repo.default_branch||'main';
        const tree=await this.fetch(buildRepoApiUrl(o,r,['git','trees',branch],{recursive:1}),{signal});
        if(!Array.isArray(tree.tree))throw new Error('Invalid GitHub tree response');
        let entries=tree.tree;
        if(tree.truncated){
            // GitHub's recursive response is bounded. Walk immutable subtrees of
            // the same root SHA, as documented by the Git Trees API, without a
            // depth cutoff or treating a failed directory read as an empty one.
            if(!tree.sha)throw new Error('Truncated GitHub tree has no root SHA');
            entries=[];
            const pending=[{sha:tree.sha,path:''}];
            while(pending.length){
                if(signal)signal.throwIfAborted();
                const directory=pending.pop();
                if(cb)cb('Reading repository tree: '+(directory.path||'/'));
                const subtree=await this.fetch(buildRepoApiUrl(o,r,['git','trees',directory.sha]),{signal});
                if(!Array.isArray(subtree.tree)||subtree.truncated){
                    throw new Error('Incomplete GitHub tree at '+(directory.path||'/'));
                }
                for(const entry of subtree.tree){
                    const path=directory.path?directory.path+'/'+entry.path:entry.path;
                    if(entry.type==='tree'){
                        if(!shouldIgnoreDirectory(path,entry.path,compiledPatterns)){
                            if(!entry.sha)throw new Error('GitHub subtree has no SHA: '+path);
                            pending.push({sha:entry.sha,path});
                        }
                    }else if(entry.type==='blob')entries.push({...entry,path});
                }
            }
        }
        const files=[];
        for(const entry of entries){
            if(entry.type!=='blob')continue;
            const parts=entry.path.split('/'),name=parts.at(-1);
            if(shouldExcludeFile(entry.path,name,compiledPatterns))continue;
            if(parts.slice(0,-1).some((part,index)=>shouldIgnoreDirectory(parts.slice(0,index+1).join('/'),part,compiledPatterns)))continue;
            files.push({path:entry.path,name,folder:parts.length>1?parts.slice(0,-1).join('/'):'root',size:entry.size||0,isCode:isCode(name)});
        }
        if(cb)cb('Found '+files.length+' files');
        return files;
    }
};
return GitHub;
}
export {buildGitHubApiUrl,buildRepoApiUrl,splitRepoPath,decodeBase64Utf8};
