// Snapshot preparation and fallback ownership belong to the caller.
export function createWorkerDetectorAdapter({createWorker,loadFallback,snapshot,
  initTimeout=10000,detectTimeout=6000,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let worker,failed=false,closed=false,serial=0,fallbackLoad,tail=Promise.resolve();
  const pending=new Map();
  const fail=error=>{
    failed=true;worker?.terminate();worker=null;
    for(const entry of pending.values()){clearTimer(entry.timer);entry.reject(error);}
    pending.clear();
  };
  function request(type,extra={},transfers=[],timeout=detectTimeout){
    if(closed||failed)return Promise.reject(Error(closed?'detector-closed':'worker-unavailable'));
    return new Promise((resolve,reject)=>{
      const id=++serial;
      const timer=setTimer(()=>fail(Error('worker-timeout')),timeout);
      pending.set(id,{resolve,reject,timer});
      try{worker.postMessage({id,type,...extra},transfers);}catch(error){fail(error);}
    });
  }
  const ready=(async()=>{
    try{
      worker=createWorker();
      worker.onmessage=({data})=>{
        const entry=pending.get(data?.id);if(!entry||closed)return;
        if(data.error){fail(Error(String(data.error)));return;}
        pending.delete(data.id);clearTimer(entry.timer);entry.resolve(data);
      };
      worker.onerror=()=>fail(Error('worker-error'));
      worker.onmessageerror=()=>fail(Error('worker-message-error'));
      const loaded=await request('load',{},[],initTimeout);
      if(loaded.backend!=='webgpu')throw Error('worker-backend-unavailable');
    }catch(error){fail(error);}
  })();
  async function detectFrame(frame,maxBoxes,minimumScore){
    await ready;if(closed)throw Error('detector-closed');
    if(!failed){
      try{
        // Retain the original snapshot for fallback. Transferring its sole buffer
        // would otherwise destroy the pixels needed after a worker failure.
        const buffer=frame.data.slice().buffer;
        const response=await request('detect',{buffer,width:frame.width,height:frame.height,maxBoxes,minimumScore},[buffer]);
        if(closed)throw Error('detector-closed');
        if(!Array.isArray(response.result))throw Error('worker-result-invalid');
        return response.result;
      }catch(error){fail(error);}
    }
    if(closed)throw Error('detector-closed');
    fallbackLoad??=Promise.resolve().then(loadFallback);
    const fallback=await fallbackLoad;
    if(closed)throw Error('detector-closed');
    const result=await fallback.detect(frame,maxBoxes,minimumScore);
    if(closed)throw Error('detector-closed');
    return result;
  }
  return {
    ready,
    detect(source,maxBoxes=12,minimumScore=.62){
      if(closed)return Promise.reject(Error('detector-closed'));
      // Capture at invocation, not when the queue reaches this request: a live
      // canvas/video may already contain another frame by then.
      let frame;try{frame=snapshot(source);}catch(error){return Promise.reject(error);}
      const result=tail.then(()=>detectFrame(frame,maxBoxes,minimumScore));
      tail=result.catch(()=>{});return result;
    },
    dispose(){if(closed)return;closed=true;fail(Error('detector-closed'));},
    state(){return {closed,failed,pending:pending.size};}
  };
}

