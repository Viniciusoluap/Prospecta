import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import type { PosicaoAssinatura } from "@/lib/certificados-digitais";
GlobalWorkerOptions.workerSrc = workerUrl;

export default function PosicionarAssinaturaPdf({ bytes, mudou }: { bytes: Uint8Array; mudou:(p:PosicaoAssinatura|null)=>void }) {
  const [pdf,setPdf]=useState<PDFDocumentProxy>();const [pagina,setPagina]=useState(1);const [erro,setErro]=useState("");
  const [tamanho,setTamanho]=useState<{width:number;height:number}>();
  const [box,setBox]=useState({x:0.1,y:0.7,w:0.52,h:0.11});const [escolhida,setEscolhida]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null), container=useRef<HTMLDivElement>(null);
  const viewport=useRef<ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["getViewport"]> | undefined>(undefined);
  const boxRef=useRef(box);boxRef.current=box;
  function publicar(b:typeof box) {
    const v=viewport.current;if(!v){mudou(null);return;}
    const [x,y]=v.convertToPdfPoint(b.x*v.width,(b.y+b.h)*v.height);
    const [r,t]=v.convertToPdfPoint((b.x+b.w)*v.width,b.y*v.height);
    mudou({pagina:pagina-1,x:Math.min(x,r),y:Math.min(y,t),largura:Math.abs(r-x),altura:Math.abs(t-y)});
  }
  useEffect(()=>{let cancelado=false;const task=getDocument({data:bytes.slice()});
    task.promise.then(p=>{if(!cancelado){setPdf(p);setPagina(p.numPages);}}).catch(()=>setErro("Não foi possível exibir este PDF."));
    return()=>{cancelado=true;void task.destroy();};
  },[bytes]);
  useEffect(()=>{
    if(!pdf||!canvas.current||!container.current)return;let cancelado=false;let render:ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>|undefined;
    mudou(null);setEscolhida(false);viewport.current=undefined;
    void pdf.getPage(pagina).then(async page=>{if(cancelado)return;
      const base=page.getViewport({scale:1,rotation:0});const scale=Math.min(1.5,(container.current!.parentElement?.clientWidth||600)/base.width,(window.innerHeight*0.52)/base.height);
      const v=page.getViewport({scale,rotation:0});viewport.current=v;setTamanho({width:v.width,height:v.height});
      const c=canvas.current!;c.width=v.width*2;c.height=v.height*2;c.style.width="100%";
      render=page.render({canvas:c,viewport:v,transform:[2,0,0,2,0,0]});await render.promise;
    }).catch(e=>{if(!cancelado&&e.name!=="RenderingCancelledException")setErro("Não foi possível renderizar a página.");});
    return()=>{cancelado=true;render?.cancel();};
  },[pdf,pagina]);
  function posicionar(e:React.PointerEvent<HTMLDivElement>) {
    if(e.type==="pointermove"&&!e.currentTarget.hasPointerCapture(e.pointerId))return;
    if(e.type==="pointerdown")e.currentTarget.setPointerCapture(e.pointerId);
    const r=e.currentTarget.getBoundingClientRect(),b=boxRef.current;
    const next={...b,x:Math.max(0,Math.min(1-b.w,(e.clientX-r.left)/r.width-b.w/2)),y:Math.max(0,Math.min(1-b.h,(e.clientY-r.top)/r.height-b.h/2))};
    setBox(next);setEscolhida(true);publicar(next);
  }
  return <div className="space-y-2">
    <p className="text-sm">Escolha a página e toque no local da assinatura. Arraste para ajustar; a marca ficará dentro do retângulo.</p>
    {erro&&<p role="alert" className="text-red-300">{erro}</p>}
    {pdf&&<div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={pagina<=1} onClick={()=>setPagina(pagina-1)}>Anterior</Button><span>Página {pagina} de {pdf.numPages}</span><Button size="sm" variant="outline" disabled={pagina>=pdf.numPages} onClick={()=>setPagina(pagina+1)}>Próxima</Button></div>}
    <div ref={container} style={tamanho} className="relative max-w-full touch-none overflow-hidden bg-white" onPointerDown={posicionar} onPointerMove={posicionar}>
      <canvas ref={canvas} className="block h-auto w-full" />
      {pdf&&<div className="pointer-events-none absolute overflow-hidden border-2 border-blue-700 bg-blue-100/80 p-1 text-[10px] text-blue-950" style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.w*100}%`,height:`${box.h*100}%`}}>ASSINADO DIGITALMENTE<br/>Titular do certificado<br/>{escolhida?"Posição selecionada":"Toque para posicionar"}</div>}
    </div>
    <label className="flex items-center gap-2 text-sm">Tamanho da assinatura<input type="range" min="0.5" max="1.6" step="0.05" value={box.w/0.52} onChange={e=>{
      const escala=Number(e.target.value),w=0.52*escala,h=0.11*escala;
      const b={w,h,x:Math.max(0,Math.min(1-w,box.x+(box.w-w)/2)),y:Math.max(0,Math.min(1-h,box.y+(box.h-h)/2))};
      boxRef.current=b;setBox(b);if(escolhida)publicar(b);
    }} /><span className="tabular-nums">{Math.round(box.w/0.52*100)}%</span></label>
  </div>;
}
