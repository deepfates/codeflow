// The project connection owns transport; this hook owns results for the current
// investigation. Moving elsewhere makes outstanding navigation results obsolete.
export function createSourceNavigationHook(React){
 const {useState,useRef,useMemo,useEffect}=React;
 return function useSourceNavigation({connection,selection,loading,language,onOpen}){
  const owner=useMemo(()=>({}),[connection,selection,loading,language?.state,language?.build?.completedAt]);
  const current=useRef(owner),open=useRef(onOpen),request=useRef(null);
  current.current=owner;open.current=onOpen;
  const [result,setResult]=useState({owner,symbols:[],locations:null,error:null});
  const state=result.owner===owner?result:{symbols:[],locations:null,error:null};
  function update(change){if(current.current===owner)setResult(prev=>({...prev,...(prev.owner===owner?{}:{symbols:[],locations:null,error:null}),owner,...change}));}
  useEffect(()=>{current.current=owner;return()=>{if(current.current===owner)current.current=null;};},[owner]);
  useEffect(()=>{
   const path=selection.selectedPath;
   if(loading||!connection||!path||!/\.exs?$/.test(path)||language?.state!=='ready')return;
   let cancelled=false;
   connection.language('symbols',path).then(symbols=>{if(!cancelled)update({symbols});}).catch(error=>{if(!cancelled&&error.name!=='AbortError')update({error:error.message});});
   return()=>{cancelled=true;};
  },[owner,language?.state,language?.build?.completedAt]);
  async function navigate(method,path,position){
   const pending={};request.current=pending;update({error:null});
   try{
    if(!connection)throw new Error('Open this checkout with the CLI to use language navigation.');
    const locations=await connection.language(method,path,position);
    if(current.current!==owner||request.current!==pending)return;
    if(method==='definition'&&locations.length===1)open.current(locations[0]);
    else update({locations:{title:method==='references'?'References':'Definitions',items:locations}});
   }catch(error){if(request.current===pending&&error.name!=='AbortError')update({error:error.message});}
  }
  return {symbols:state.symbols,locations:state.locations,error:state.error,navigate,unavailable:reason=>update({error:reason})};
 };
}
