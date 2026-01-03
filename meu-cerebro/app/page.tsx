"use client";
// Atualizando site
import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js"; 
import { X, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Save, Palette, Maximize2, MousePointer2 } from "lucide-react";

// --- CONFIGURAÇÃO ---
const supabaseUrl = "https://ebfqjykumgberaavzavy.supabase.co";

// 🔴 CONFIRA SE SUA CHAVE ESTÁ AQUI EMBAIXO 🔴
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViZnFqeWt1bWdiZXJhYXZ6YXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0MDcyNTUsImV4cCI6MjA4Mjk4MzI1NX0.h7X70CBM5HQE9vbZsM31zwxiCSKYfJDogtkj960WUoU";

// 🔥 CRIAÇÃO DO CLIENTE (SEM TRAVAS DE SEGURANÇA) 🔥
// Agora ele conecta direto, sem verificar se é texto de exemplo.
const supabase = createClient(supabaseUrl, supabaseKey);

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function Home() {
  const graphRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState({ nodes: [] as any[], links: [] as any[] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [winState, setWinState] = useState({ x: 50, y: 50, w: 450, h: 600 });
  const [dragMode, setDragMode] = useState<null | 'move' | 'resize'>(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, winX: 0, winY: 0, winW: 0, winH: 0 });

  useEffect(() => {
    fetchGraphData();
  }, []);

  async function fetchGraphData() {
    console.log("🔄 Buscando dados...");
    
    // Tenta buscar os dados
    const { data: nodesData, error } = await supabase.from('nodes').select('*');
    const { data: linksData } = await supabase.from('links').select('*');

    if (error) {
        console.error("❌ Erro:", error.message);
        alert("ERRO DE BANCO: " + error.message);
        return;
    }

    if (nodesData && linksData) {
      console.log("✅ Dados recebidos:", nodesData.length);
      setData({
        nodes: nodesData.map(n => ({ ...n, val: Number(n.val) })), 
        links: linksData.map(l => ({ source: l.source, target: l.target }))
      });
    }
  }

  const addNewNode = async () => {
    const name = prompt(selectedNode ? `Novo subtópico para "${selectedNode.name}":` : "Nome da nova Categoria:");
    if (!name) return;

    const newId = name.toLowerCase().replace(/\s/g, "_") + "_" + Date.now();
    const newNode = { 
        id: newId, name: name, val: selectedNode ? 10 : 25, 
        color: selectedNode ? "#9ca3af" : "#4b5563", 
        images: [],
        notes: "" 
    };

    const { error } = await supabase.from('nodes').insert([newNode]);
    
    if (error) {
        alert("Erro ao salvar: " + error.message);
        return;
    }

    if (selectedNode) {
        await supabase.from('links').insert([{ source: selectedNode.id, target: newId }]);
    }
    fetchGraphData(); 
  };

  const handleSave = async () => {
    if (!selectedNode) return;
    
    selectedNode.notes = noteContent;
    setData({...data}); 

    const { error } = await supabase
        .from('nodes')
        .update({ 
            name: selectedNode.name,
            notes: noteContent,
            color: selectedNode.color
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
    if (!confirm(`Deletar "${selectedNode.name}"?`)) return;
    await supabase.from('nodes').delete().eq('id', selectedNode.id);
    setSelectedNode(null);
    fetchGraphData();
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

  const handleNodeClick = useCallback(async (node: any) => {
    if (isLinkingMode && selectedNode) {
      if (node.id === selectedNode.id) return; 
      await supabase.from('links').insert([{ source: selectedNode.id, target: node.id }]);
      setIsLinkingMode(false);
      fetchGraphData();
    } else {
      graphRef.current?.centerAt(node.x, node.y, 1000);
      graphRef.current?.zoom(3, 2000);
      setSelectedNode(node);
      setNoteContent(node.notes || ""); 
    }
  }, [selectedNode, isLinkingMode]);

  useEffect(() => {
    if (graphRef.current) {
        graphRef.current.d3Force('charge').strength(-400); 
        graphRef.current.d3Force('link').distance(100);
    }
  }, []);

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
  const handleNodeDragEnd = (node: any) => { node.fx = node.x; node.fy = node.y; };

  return (
    <main className="relative w-screen h-screen bg-[#F3F4F6] overflow-hidden">
      {isLinkingMode && <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg z-50 animate-pulse font-medium flex items-center gap-2"><LinkIcon size={16}/> Clique em outra bolinha para conectar</div>}
      <div className="absolute inset-0">
        <ForceGraph2D ref={graphRef} graphData={data} nodeLabel="name" nodeColor={(node: any) => isLinkingMode ? "#3b82f6" : node.color} nodeRelSize={6} linkColor={() => "#d1d5db"} backgroundColor="#F3F4F6" onNodeClick={handleNodeClick} onNodeDragEnd={handleNodeDragEnd} />
      </div>
      {!selectedNode && <button onClick={addNewNode} className="absolute bottom-8 right-8 bg-black text-white p-4 rounded-full shadow-xl hover:scale-110 transition z-40 flex items-center gap-2 group"><Plus size={24} className="group-hover:rotate-90 transition duration-300" /> <span className="font-bold pr-2">Nova Categoria</span></button>}
      {selectedNode && (
        <div style={{ left: winState.x, top: winState.y, width: winState.w, height: winState.h }} className="absolute bg-white/95 backdrop-blur-md shadow-2xl rounded-xl border border-gray-300 flex flex-col z-50 overflow-hidden">
          <div onMouseDown={startMove} className="h-12 bg-gray-100 border-b border-gray-200 flex justify-between items-center px-4 cursor-move select-none active:bg-gray-200 transition">
             <div className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2"><MousePointer2 size={14} /> {selectedNode.name}</div>
            <button onClick={() => { setSelectedNode(null); setIsLinkingMode(false); }} className="p-1 hover:bg-red-100 hover:text-red-500 rounded transition"><X size={20} /></button>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            <input type="text" value={selectedNode.name} onChange={(e) => {selectedNode.name = e.target.value; setData({...data})}} className="text-2xl font-bold w-full bg-transparent outline-none mb-4 text-gray-800 border-b border-transparent focus:border-blue-500 transition" />
            <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} className="w-full h-32 bg-transparent outline-none text-gray-700 resize-none leading-relaxed placeholder-gray-400 mb-6" placeholder="Escreva suas anotações aqui..."/>
            {selectedNode.images?.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                    {selectedNode.images.map((img: string, idx: number) => (
                        <div key={idx} className="relative rounded-lg overflow-hidden border border-gray-100 h-24 bg-gray-50">
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
                <button onClick={() => setIsLinkingMode(true)} className={`w-8 h-8 rounded flex items-center justify-center transition ${isLinkingMode ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 text-gray-700'}`} title="Conectar"><LinkIcon size={16} /></button>
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