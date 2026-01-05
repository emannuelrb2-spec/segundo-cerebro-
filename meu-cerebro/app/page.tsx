"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js"; 
import { X, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Save, Palette, Maximize2, MousePointer2 } from "lucide-react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function Home() {
  const graphRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState({ nodes: [] as any[], links: [] as any[] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  
  const [winState, setWinState] = useState({ x: 50, y: 50, w: 500, h: 600 });
  const [dragMode, setDragMode] = useState<null | 'move' | 'resize'>(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, winX: 0, winY: 0, winW: 0, winH: 0 });

  useEffect(() => {
    fetchGraphData();
    const channel = supabase
      .channel("realtime-graph")
      .on("postgres_changes", { event: "*", schema: "public", table: "nodes" }, fetchGraphData)
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, fetchGraphData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (graphRef.current) {
        setTimeout(() => {
            if(graphRef.current) {
                graphRef.current.d3Force('charge').strength(-400); 
                graphRef.current.d3Force('link').distance(120);
            }
        }, 500);
    }
  }, [data]);

  async function fetchGraphData() {
    const { data: nodesData } = await supabase.from('nodes').select('*');
    const { data: linksData } = await supabase.from('links').select('*');
    if (nodesData && linksData) {
      setData({
        nodes: nodesData.map(n => ({ 
          ...n, 
          val: Number(n.val) || 20, 
          color: n.color || (n.group === 'category' ? '#ef4444' : '#6b7280') 
        })), 
        links: linksData.map(l => ({ source: l.source, target: l.target }))
      });
    }
  }

  // --- FUNÇÃO PARA ADICIONAR OU REMOVER LINHA ---
  const handleLinkToggle = async (targetNode: any) => {
    if (!selectedNode || targetNode.id === selectedNode.id) return;

    // Procura se já existe um link entre as duas
    const { data: existingLink } = await supabase
      .from('links')
      .select('*')
      .or(`and(source.eq.${selectedNode.id},target.eq.${targetNode.id}),and(source.eq.${targetNode.id},target.eq.${selectedNode.id})`)
      .maybeSingle();

    if (existingLink) {
      // Se existe, apaga (Tira linha)
      await supabase.from('links').delete().match({ id: existingLink.id });
    } else {
      // Se não existe, cria (Põe linha)
      await supabase.from('links').insert([{ source: selectedNode.id, target: targetNode.id }]);
    }
    setIsLinkingMode(false);
    fetchGraphData();
  };

  const handleNodeClick = useCallback((node: any) => {
    if (isLinkingMode) {
      handleLinkToggle(node);
    } else {
      graphRef.current?.centerAt(node.x, node.y, 1000);
      graphRef.current?.zoom(3, 2000);
      setSelectedNode(node);
      setNoteContent(node.content || node.notes || ""); 
    }
  }, [selectedNode, isLinkingMode]);

  const handleSave = async () => {
    if (!selectedNode) return;
    const { error } = await supabase.from('nodes').update({ 
      label: selectedNode.label || selectedNode.name, 
      content: noteContent, 
      notes: noteContent, 
      color: selectedNode.color 
    }).eq('id', selectedNode.id);
    
    if (!error) {
      const btn = document.getElementById('save-btn');
      if(btn) btn.style.color = '#16a34a'; 
      setTimeout(() => { if(btn) btn.style.color = ''; }, 1000);
    }
  };

  // --- ARRASTAR E REDIMENSIONAR ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragMode) return;
      const deltaX = e.clientX - dragStart.current.mouseX;
      const deltaY = e.clientY - dragStart.current.mouseY;
      if (dragMode === 'move') {
        setWinState(prev => ({ ...prev, x: dragStart.current.winX + deltaX, y: dragStart.current.winY + deltaY }));
      } else if (dragMode === 'resize') {
        setWinState(prev => ({ ...prev, w: Math.max(300, dragStart.current.winW + deltaX), h: Math.max(300, dragStart.current.winH + deltaY) }));
      }
    };
    const handleMouseUp = () => setDragMode(null);
    if (dragMode) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragMode]);

  const startMove = (e: React.MouseEvent) => { setDragMode('move'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };
  const startResize = (e: React.MouseEvent) => { e.stopPropagation(); setDragMode('resize'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };

  return (
    <main className="relative w-screen h-screen bg-[#F3F4F6] overflow-hidden">
      {isLinkingMode && <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg z-50 animate-pulse flex items-center gap-2"><LinkIcon size={16}/> Clique em outro nó para ligar/desligar</div>}
      
      <div className="absolute inset-0">
        <ForceGraph2D ref={graphRef} graphData={data} nodeLabel="label" nodeColor={(node: any) => isLinkingMode ? "#3b82f6" : node.color} nodeRelSize={6} linkColor={() => "#d1d5db"} backgroundColor="#F3F4F6" onNodeClick={handleNodeClick} />
      </div>

      {selectedNode && (
        <div style={{ left: winState.x, top: winState.y, width: winState.w, height: winState.h }} className="absolute bg-white/95 backdrop-blur-md shadow-2xl rounded-xl border border-gray-300 flex flex-col z-50 overflow-hidden">
          <div onMouseDown={startMove} className="h-12 bg-gray-100 border-b border-gray-200 flex justify-between items-center px-4 cursor-move select-none">
             <div className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2"><MousePointer2 size={14} /> {selectedNode.label || selectedNode.name}</div>
            <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-red-100 hover:text-red-500 rounded"><X size={20} /></button>
          </div>
          
          {/* CONTEÚDO COM ÁREA DE TEXTO FLEXÍVEL */}
          <div className="flex-1 p-6 flex flex-col min-h-0">
            <input type="text" value={selectedNode.label || selectedNode.name} onChange={(e) => {selectedNode.label = e.target.value; setData({...data})}} className="text-2xl font-bold w-full bg-transparent outline-none mb-4" />
            
            {/* O SEGREDO: h-full e flex-1 faz ele ocupar todo o espaço */}
            <textarea 
                value={noteContent} 
                onChange={(e) => setNoteContent(e.target.value)} 
                className="flex-1 w-full bg-gray-50/50 p-4 rounded-lg outline-none text-gray-700 resize-none leading-relaxed border border-gray-100 focus:border-blue-200" 
                placeholder="Escreva suas anotações aqui..."
            />

            {selectedNode.image_url && (
                <div className="mt-4 rounded-lg overflow-hidden border border-gray-200 max-h-40">
                    <img src={selectedNode.image_url} className="w-full object-cover" />
                </div>
            )}
          </div>
          
          <div className="p-2 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
            <div className="flex gap-1">
                <button onClick={() => colorInputRef.current?.click()} className="w-8 h-8 hover:bg-purple-100 text-purple-600 rounded flex items-center justify-center transition"><Palette size={16} /></button>
                <input ref={colorInputRef} type="color" onChange={(e) => {selectedNode.color = e.target.value; setData({...data})}} className="hidden" />
                <button id="save-btn" onClick={handleSave} className="w-8 h-8 hover:bg-green-100 text-green-700 rounded flex items-center justify-center transition"><Save size={16} /></button>
                <button onClick={() => setIsLinkingMode(true)} className={`w-8 h-8 rounded flex items-center justify-center transition ${isLinkingMode ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 text-gray-700'}`}><LinkIcon size={16} /></button>
                <button onClick={() => { if(confirm("Deletar?")) { supabase.from('nodes').delete().eq('id', selectedNode.id).then(() => setSelectedNode(null)); } }} className="w-8 h-8 hover:bg-red-100 text-red-600 rounded flex items-center justify-center transition"><Trash2 size={16} /></button>
            </div>
            <div onMouseDown={startResize} className="cursor-nwse-resize text-gray-400 p-2"><Maximize2 size={16} /></div>
          </div>
        </div>
      )}
    </main>
  );
}