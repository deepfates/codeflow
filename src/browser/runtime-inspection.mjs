// The project connection owns request cancellation; this hook owns the current
// runtime result and input state, which survive switching between app panels.
export function createRuntimeInspectionHook(React){
    const {useState,useRef,useEffect}=React;
    return function useRuntimeInspection(connection,defaultNode=''){
        const [node,setNode]=useState(defaultNode);
        const [result,setResult]=useState({connection,snapshot:null,busy:false,focus:null});
        const current=useRef(connection);
        current.current=connection;
        useEffect(()=>{
            current.current=connection;
            setResult({connection,snapshot:null,busy:false,focus:null});
            return ()=>{if(current.current===connection)current.current=null;};
        },[connection]);
        useEffect(()=>setNode(defaultNode),[connection,defaultNode]);
        const state=result.connection===connection?result:{snapshot:null,busy:false,focus:null};
        async function connect(){
            if(!connection){
                setResult({connection,snapshot:{status:'unavailable',reason:'Open this checkout with the CLI to inspect its runtime.'},busy:false,focus:null});
                return;
            }
            setResult(previous=>({...previous,connection,busy:true}));
            try{
                const snapshot=await connection.runtime(node);
                if(current.current===connection)setResult(previous=>({...previous,connection,snapshot,busy:false}));
            }catch(error){
                if(current.current===connection&&error.name!=='AbortError')setResult(previous=>({...previous,connection,snapshot:{status:'unavailable',reason:error.message},busy:false}));
            }
        }
        function setFocus(focus){setResult(previous=>({...previous,connection,focus}));}
        return {...state,node,setNode,connect,setFocus};
    };
}
