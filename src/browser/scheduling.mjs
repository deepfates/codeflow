function yieldToBrowser(){
    if(typeof scheduler!=='undefined'&&scheduler.yield){
        return scheduler.yield();
    }
    if(typeof MessageChannel!=='undefined'){
        return new Promise(function(resolve){
            var channel=new MessageChannel();
            channel.port1.onmessage=function(){
                channel.port1.close();
                channel.port2.close();
                resolve();
            };
            channel.port2.postMessage(null);
        });
    }
    return new Promise(function(resolve){setTimeout(resolve,0);});
}
export {yieldToBrowser};
