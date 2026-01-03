"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js"; 
import { X, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Save, Palette, Maximize2, MousePointer2 } from "lucide-react";

// --- CONFIGURAÇÃO ---
// Usamos as variáveis de ambiente do Vercel para segurança
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function Home() {
  // CORREÇÃO DO ERRO: Inicializamos com null
  const graphRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState({ nodes: [] as any[], links: [] as any[] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  
  // Estado para o conteúdo do texto (Notas ou WhatsApp)
  const [noteContent, setNoteContent] = useState("");
  
  const [winState, setWinState] = useState({ x: 50, y: 50, w: 450, h: 600 });
  const [dragMode, setDragMode] = useState<null | 'move' | 'resize'>(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, winX: 0, winY: 0, winW: 0, winH: 0 });

  useEffect(() => {
    fetchGraphData();

    // Atualização em tempo real (Realtime)
    const channel = supabase
      .channel("realtime-graph")
      .on("postgres_changes", { event: "*", schema: "public", table: "nodes" }, fetchGraphData)
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, fetchGraphData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchGraphData() {
    // Busca tudo (*) para trazer também 'content' e 'image_url' e 'group'
    const { data: nodesData } = await supabase.from('nodes').select('*');
    const { data: linksData } = await supabase.from('links').select('*');

    if (nodesData && linksData) {
      setData({
        nodes: nodesData.map(n => ({ 
            ...n, 
            val: Number(n.val) || (n.group === 'category' ? 30 : 15) // Categorias maiores
        })), 
        links: linksData.map(l => ({ source: l.source, target: l.target }))
      });
    }
  }

  const addNewNode = async () => {
    const name = prompt(selectedNode ? `Novo subtópico para "${selectedNode.label}":` : "Nome da nova Categoria:");
    if (!name) return;

    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();
    const newNode = { 
        id: newId, 
        label: name, 
        group: selectedNode ? 'topic' : 'category',
        val: selectedNode ? 10 : 25, 
        color: selectedNode ? "#9ca3af" : "#ff0055", // Cor padrão manual
        content: "" 
    };

    const { error } = await supabase.from('nodes').insert([newNode]);
    
    if (error) {
        alert("Erro ao salvar: " + error.message);
        return;
    }

    if (selectedNode) {
        await supabase.from('links').insert([{ source: selectedNode.id, target: newId }]);
    }
  };

  const handleSave = async () => {
    if (!selectedNode) return;
    
    // Salva tanto no campo antigo 'notes' quanto no novo 'content' pra garantir
    const { error } = await supabase
        .from('nodes')
        .update({ 
            label: selectedNode.label,
            content: noteContent, // Salva na coluna nova
            notes: noteContent,   // Mantém compatibilidade
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
    if (!confirm(`Deletar "${selectedNode.label}"?`)) return;
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

  const handleNodeClick = useCallback(async (node: any) => {
    if (isLinkingMode && selectedNode) {
      if (node.id === selectedNode.id) return; 
      await supabase.from('links').insert([{ source: selectedNode.id, target: node.id }]);
      setIsLinkingMode(false);
    } else {
      graphRef.current?.centerAt(node.x, node.y, 1000);
      graphRef.current?.zoom(3, 2000);
      setSelectedNode(node);
      
      // LÓGICA HÍBRIDA: Pega o content novo OU o notes antigo
      setNoteContent(node.content || node.notes || ""); 
    }
  }, [selectedNode, isLinkingMode]);

  // --- ARRASTAR JANELA ---
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

  return (
    <main className="relative w-screen h-screen bg-black overflow-hidden">
      {isLinkingMode && <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg z-50 animate-pulse font-medium flex items-center gap-2"><LinkIcon size={16}/> Clique em outra bolinha para conectar</div>}
      
      <div className="absolute inset-0">
        <ForceGraph2D 
            ref={graphRef} 
            graphData={data} 
            nodeLabel="label" 
            nodeColor={(node: any) => {
                // Prioridade: Cor manual > Cor por Grupo > Cor Padrão
                if (node.color) return node.color;
                return node.group === 'category' ? '#ff0055' : '#00ccff';
            }} 
            nodeRelSize={6} 
            linkColor={() => "#ffffff33"} 
            backgroundColor="#000000" 
            onNodeClick={handleNodeClick} 
        />
      </div>

      {!selectedNode && <button onClick={addNewNode} className="absolute bottom-8 right-8 bg-white text-black p-4 rounded-full shadow-xl hover:scale-110 transition z-40 flex items-center gap-2 group"><Plus size={24} className="group-hover:rotate-90 transition duration-300" /> <span className="font-bold pr-2">Nova Categoria</span></button>}
      
      {selectedNode && (
        <div style={{ left: winState.x, top: winState.y, width: winState.w, height: winState.h }} className="absolute bg-gray-900/90 backdrop-blur-md shadow-2xl rounded-xl border border-gray-700 flex flex-col z-50 overflow-hidden text-white">
          <div onMouseDown={startMove} className="h-12 bg-gray-800 border-b border-gray-700 flex justify-between items-center px-4 cursor-move select-none active:bg-gray-700 transition">
             <div className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <MousePointer2 size={14} /> 
                {selectedNode.group || "Tópico"}
             </div>
            <button onClick={() => { setSelectedNode(null); setIsLinkingMode(false); }} className="p-1 hover:bg-red-500/20 hover:text-red-500 rounded transition"><X size={20} /></button>
          </div>
          
          <div className="flex-1 p-6 overflow-y-auto">
            <input 
                type="text" 
                value={selectedNode.label} 
                onChange={(e) => {selectedNode.label = e.target.value; setData({...data})}} 
                className="text-2xl font-bold w-full bg-transparent outline-none mb-4 text-white border-b border-transparent focus:border-blue-500 transition" 
            />
            
            {/* ÁREA DE TEXTO (MOSTRA O QUE VEIO DO WHATSAPP) */}
            <textarea 
                value={noteContent} 
                onChange={(e) => setNoteContent(e.target.value)} 
                className="w-full h-40 bg-gray-800/50 p-4 rounded-lg outline-none text-gray-200 resize-none leading-relaxed placeholder-gray-500 mb-6 border border-gray-700 focus:border-blue-500" 
                placeholder="Escreva suas anotações aqui..."
            />

            {/* MOSTRA IMAGEM DO WHATSAPP (image_url) */}
            {selectedNode.image_url && (
                <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-2 uppercase font-bold">Imagem do WhatsApp:</p>
                    <div className="relative rounded-lg overflow-hidden border border-gray-600">
                        <img src={selectedNode.image_url} className="w-full object-cover" alt="Anexo do WhatsApp" />
                    </div>
                </div>
            )}

            {/* IMAGENS ANTIGAS (Legacy) */}
            {selectedNode.images?.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                    {selectedNode.images.map((img: string, idx: number) => (
                        <div key={idx} className="relative rounded-lg overflow-hidden border border-gray-700 h-24 bg-gray-800">
                            <img src={img} className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}
          </div>

          {/* RODAPÉ DE AÇÕES */}
          <div className="p-2 border-t border-gray-700 bg-gray-800 flex justify-between items-center gap-1">
            <div className="flex gap-1">
                <button onClick={() => colorInputRef.current?.click()} className="w-8 h-8 hover:bg-purple-500/20 text-purple-400 rounded flex items-center justify-center transition"><Palette size={16} /></button>
                <input ref={colorInputRef} type="color" onChange={handleColorChange} className="hidden" />
                
                <button id="save-btn" onClick={handleSave} className="w-8 h-8 hover:bg-green-500/20 text-green-500 rounded flex items-center justify-center transition"><Save size={16} /></button>
                <button onClick={addNewNode} className="w-8 h-8 hover:bg-white/10 text-white rounded flex items-center justify-center transition"><Plus size={16} /></button>
                <button onClick={() => setIsLinkingMode(true)} className={`w-8 h-8 rounded flex items-center justify-center transition ${isLinkingMode ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-white'}`}><LinkIcon size={16} /></button>
                <button onClick={deleteNode} className="w-8 h-8 hover:bg-red-500/20 text-red-500 rounded flex items-center justify-center transition"><Trash2 size={16} /></button>
            </div>
            <div onMouseDown={startResize} className="cursor-nwse-resize text-gray-500 hover:text-white p-2"><Maximize2 size={16} /></div>
          </div>
        </div>
      )}
    </main>
  );
}