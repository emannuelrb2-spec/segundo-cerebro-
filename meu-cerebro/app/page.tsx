"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js"; 
import { X, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Save, Palette, Maximize2, MousePointer2 } from "lucide-react";

// --- CONFIGURAÇÃO DE SEGURANÇA ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function Home() {
  // Ajuste: useRef iniciado com null para evitar erros de compilação
  const graphRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState({ nodes: [] as any[], links: [] as any[] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  
  // Estado da Janela Flutuante
  const [winState, setWinState] = useState({ x: 50, y: 50, w: 450, h: 600 });
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

  // Força as bolinhas a se empurrarem e mantém a distância
  useEffect(() => {
    if (graphRef.current) {
        setTimeout(() => {
            if(graphRef.current) {
                graphRef.current.d3Force('charge').strength(-400); 
                graphRef.current.d3Force('link').distance(100);
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

  // --- NOVA LÓGICA: ADICIONAR OU REMOVER LINHA (TOGGLE) ---
  const handleLinkToggle = async (targetNode: any) => {
    if (!selectedNode || targetNode.id === selectedNode.id) return;

    // Procura se já existe um link entre as duas bolinhas
    const { data: existingLink } = await supabase
      .from('links')
      .select('*')
      .or(`and(source.eq.${selectedNode.id},target.eq.${targetNode.id}),and(source.eq.${targetNode.id},target.eq.${selectedNode.id})`)
      .maybeSingle();

    if (existingLink) {
      // Se já existe, nós removemos (cortamos o barbante)
      await supabase
        .from('links')
        .delete()
        .match({ source: existingLink.source, target: existingLink.target });
    } else {
      // Se não existe, nós criamos (amarramos o barbante)
      await supabase
        .from('links')
        .insert([{ source: selectedNode.id, target: targetNode.id }]);
    }

    setIsLinkingMode(false);
    fetchGraphData();
  };

  const addNewNode = async () => {
    const name = prompt(selectedNode ? `Novo subtópico para "${selectedNode.label}":` : "Nome da nova Categoria:");
    if (!name) return;

    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();
    const newNode = { 
        id: newId, 
        label: name, 
        val: selectedNode ? 10 : 25, 
        color: selectedNode ? "#9ca3af" : "#4b5563", 
        images: [],
        content: "" 
    };

    const { error } = await supabase.from('nodes').insert([newNode]);
    if (error) { alert("Erro ao salvar: " + error.message); return; }

    if (selectedNode) {
        await supabase.from('links').insert([{ source: selectedNode.id, target: newId }]);
    }
  };

  const handleSave = async () => {
    if (!selectedNode) return;
    
    selectedNode.notes = noteContent;
    selectedNode.content = noteContent;
    setData({...data}); 

    const { error } = await supabase
        .from('nodes')
        .update({ 
            label: selectedNode.label || selectedNode.name, 
            notes: noteContent,
            content: noteContent, 
            color: selectedNode.color,
            images: selectedNode.images 
        })
        .eq('id', selectedNode.id);

    if (error) {
        alert("Erro ao salvar: " + error.message);
    } else {
        const btn = document.getElementById('save-btn');
        if(btn) btn.style.color = '#16a34a'; 
        setTimeout(() => { if(btn) btn.style.color = ''; }, 1000);
    }
  };

  const deleteNode = async () => {
    if (!confirm(`Deletar "${selectedNode.label || selectedNode.name}"?`)) return;
    await supabase.from('nodes').delete().eq('id', selectedNode.id);
    setSelectedNode(null);
  };

  const handleColorChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if(selectedNode) {
        const newColor = e.target.value;
        selectedNode.color = newColor; 
        setData({...data}); 
        await supabase.from('nodes').update({ color: newColor }).eq('id', selectedNode.id);
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedNode) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            const imgUrl = event.target?.result as string;
            const newImages = [...(selectedNode.images || []), imgUrl];
            selectedNode.images = newImages; 
            setData({...data}); 
            await supabase.from('nodes').update({ images: newImages }).eq('id', selectedNode.id);
        };
        reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragMode) return;
      e.preventDefault(); 
      const deltaX = e.clientX - dragStart.current.mouseX;
      const deltaY = e.clientY - dragStart.current.mouseY;
      if (dragMode === 'move') {
        setWinState(prev => ({ ...prev, x: dragStart.current.winX + deltaX, y: dragStart.current.winY + deltaY }));
      } else if (dragMode === 'resize') {
        setWinState(prev => ({ ...prev, w: Math.max(300, dragStart.current.winW + deltaX), h: Math.max(300, dragStart.current.winH + deltaY) }));
      }
    };
    const handleMouseUp = () => { setDragMode(null); document.body.style.cursor = 'default'; };
    if (dragMode) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragMode]);

  const startMove = (e: React.MouseEvent) => { setDragMode('move'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };
  const startResize = (e: React.MouseEvent) => { e.stopPropagation(); setDragMode('resize'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };
  const triggerColorPicker = () => { colorInputRef.current?.click(); };

  const handleNodeClick = useCallback(async (node: any) => {
    if (isLinkingMode) {
      handleLinkToggle(node); // Agora usa a lógica de Toggle
    } else {
      graphRef.current?.centerAt(node.x, node.y, 1000);
      graphRef.current?.zoom(3, 2000);
      setSelectedNode(node);
      setNoteContent(node.content || node.notes || ""); 
    }
  }, [selectedNode, isLinkingMode]);

  return (
    <main className="relative w-screen h-screen bg-[#F3F4F6] overflow-hidden">
      {isLinkingMode && <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg z-50 animate-pulse font-medium flex items-center gap-2"><LinkIcon size={16}/> Clique em outra bolinha para ligar ou desligar</div>}
      
      <div className="absolute inset-0">
        <ForceGraph2D 
            ref={graphRef} 
            graphData={data} 
            nodeLabel="label" 
            nodeColor={(node: any) => isLinkingMode ? "#3b82f6" : node.color} 
            nodeRelSize={6} 
            linkColor={() => "#d1d5db"} 
            backgroundColor="#F3F4F6" 
            onNodeClick={handleNodeClick} 
        />
      </div>

      {!selectedNode && <button onClick={addNewNode} className="absolute bottom-8 right-8 bg-black text-white p-4 rounded-full shadow-xl hover:scale-110 transition z-40 flex items-center gap-2 group"><Plus size={24} className="group-hover:rotate-90 transition duration-300" /> <span className="font-bold pr-2">Nova Categoria</span></button>}
      
      {selectedNode && (
        <div style={{ left: winState.x, top: winState.y, width: winState.w, height: winState.h }} className="absolute bg-white/95 backdrop-blur-md shadow-2xl rounded-xl border border-gray-300 flex flex-col z-50 overflow-hidden">
          <div onMouseDown={startMove} className="h-12 bg-gray-100 border-b border-gray-200 flex justify-between items-center px-4 cursor-move select-none active:bg-gray-200 transition">
             <div className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2"><MousePointer2 size={14} /> {selectedNode.label || selectedNode.name}</div>
            <button onClick={() => { setSelectedNode(null); setIsLinkingMode(false); }} className="p-1 hover:bg-red-100 hover:text-red-500 rounded transition"><X size={20} /></button>
          </div>
          
          {/* ÁREA DE TEXTO EXPANSÍVEL (flex-1 e resize-none) */}
          <div className="flex-1 p-6 flex flex-col min-h-0">
            <input type="text" value={selectedNode.label || selectedNode.name} onChange={(e) => {selectedNode.label = e.target.value; setData({...data})}} className="text-2xl font-bold w-full bg-transparent outline-none mb-4 text-gray-800 border-b border-transparent focus:border-blue-500 transition" />
            
            <textarea 
              value={noteContent} 
              onChange={(e) => setNoteContent(e.target.value)} 
              className="flex-1 w-full bg-gray-50/50 p-4 rounded-lg outline-none text-gray-700 resize-none leading-relaxed placeholder-gray-400 border border-gray-100 focus:border-blue-200" 
              placeholder="Escreva suas anotações aqui..."
            />
            
            {selectedNode.image_url && (
                <div className="mt-4 flex-shrink-0">
                    <p className="text-xs text-gray-500 mb-1 font-bold uppercase">Anexo:</p>
                    <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50 max-h-40">
                        <img src={selectedNode.image_url} className="w-full object-cover" />
                    </div>
                </div>
            )}

            {selectedNode.images?.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-4 flex-shrink-0">
                    {selectedNode.images.map((img: string, idx: number) => (
                        <div key={idx} className="relative rounded-lg overflow-hidden border border-gray-100 h-20 bg-gray-50">
                            <img src={img} className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}
          </div>
          
          <div className="p-2 border-t border-gray-100 bg-gray-50 flex justify-between items-center gap-1">
            <div className="flex gap-1">
                <button onClick={triggerColorPicker} className="w-8 h-8 hover:bg-purple-100 text-purple-600 rounded flex items-center justify-center transition" title="Mudar Cor"><Palette size={16} /></button>
                <input ref={colorInputRef} type="color" onChange={handleColorChange} className="hidden" />
                <button id="save-btn" onClick={handleSave} className="w-8 h-8 hover:bg-green-100 text-green-700 rounded flex items-center justify-center transition" title="Salvar Alterações"><Save size={16} /></button>
                <button onClick={addNewNode} className="w-8 h-8 hover:bg-gray-200 text-gray-700 rounded flex items-center justify-center transition" title="Subtópico"><Plus size={16} /></button>
                <button onClick={() => setIsLinkingMode(true)} className={`w-8 h-8 rounded flex items-center justify-center transition ${isLinkingMode ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 text-gray-700'}`} title="Conectar/Desconectar"><LinkIcon size={16} /></button>
                <button onClick={deleteNode} className="w-8 h-8 hover:bg-red-100 text-red-600 rounded flex items-center justify-center transition" title="Deletar"><Trash2 size={16} /></button>
                <label className="w-8 h-8 hover:bg-blue-100 text-blue-600 rounded flex items-center justify-center transition cursor-pointer" title="Adicionar Imagem">
                    <ImageIcon size={16} />
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>
            </div>
            <div onMouseDown={startResize} className="cursor-nwse-resize text-gray-400 hover:text-blue-500 p-2" title="Puxe para redimensionar"><Maximize2 size={16} /></div>
          </div>
        </div>
      )}
    </main>
  );
}