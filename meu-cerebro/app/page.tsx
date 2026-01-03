"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import ForceGraph2D from "react-force-graph-2d";

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Home() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  
  // Estado para guardar qual bolinha foi clicada
  const [selectedNode, setSelectedNode] = useState<any>(null);
  
  const graphRef = useRef<any>();

  const fetchData = useCallback(async () => {
    // AGORA BUSCAMOS TUDO (*) PARA TER O CONTENT E A FOTO
    const { data: nodesData } = await supabase.from("nodes").select("*");
    const { data: linksData } = await supabase.from("links").select("*");

    if (nodesData) setNodes(nodesData);
    if (linksData) setLinks(linksData);
  }, []);

  useEffect(() => {
    fetchData();

    // Atualização em tempo real (Realtime)
    const channel = supabase
      .channel("realtime-graph")
      .on("postgres_changes", { event: "*", schema: "public", table: "nodes" }, fetchData)
      .on("postgres_changes", { event: "*", schema: "public", table: "links" }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // Função disparada ao clicar na bolinha
  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
    
    // Zoom na bolinha clicada
    graphRef.current?.centerAt(node.x, node.y, 1000);
    graphRef.current?.zoom(3, 2000);
  };

  return (
    <div className="flex h-screen w-screen bg-black text-white overflow-hidden">
      
      {/* BARRA LATERAL (SIDEBAR) */}
      <aside className="w-1/3 h-full border-r border-gray-800 bg-gray-900/50 p-6 flex flex-col z-10 backdrop-blur-sm absolute left-0 top-0 bottom-0 shadow-2xl transition-transform">
        
        <h1 className="text-2xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          Segundo Cérebro
        </h1>

        {selectedNode ? (
          // SE TIVER BOLINHA SELECIONADA, MOSTRA OS DETALHES
          <div className="animate-fade-in space-y-4">
            <div className="border-b border-gray-700 pb-2">
               <span className="text-xs uppercase tracking-widest text-gray-500">{selectedNode.group || "Tópico"}</span>
               <h2 className="text-3xl font-bold text-white mt-1">{selectedNode.label}</h2>
            </div>

            {/* Mostra a Foto se existir */}
            {selectedNode.image_url && (
              <img 
                src={selectedNode.image_url} 
                alt="Imagem anexa" 
                className="w-full rounded-lg border border-gray-700 shadow-lg mb-4"
              />
            )}

            {/* Mostra o Texto se existir */}
            <div className="prose prose-invert max-w-none text-gray-300 whitespace-pre-wrap">
              {selectedNode.content ? selectedNode.content : "Sem anotações para este tópico."}
            </div>
            
            <div className="pt-4 text-xs text-gray-600">
              ID: {selectedNode.id}
            </div>
          </div>
        ) : (
          // SE NÃO TIVER NADA SELECIONADO
          <div className="flex flex-col items-center justify-center h-full text-gray-500 opacity-50">
            <p>Clique em uma conexão para ver os detalhes</p>
          </div>
        )}
      </aside>

      {/* ÁREA DO GRÁFICO */}
      <main className="flex-1 h-full relative">
        <ForceGraph2D
          ref={graphRef}
          graphData={{ nodes, links }}
          nodeLabel="label"
          nodeColor={(node: any) => node.group === 'category' ? '#ff0055' : '#00ccff'} // Cores diferentes!
          nodeRelSize={6}
          linkColor={() => "#ffffff33"}
          backgroundColor="#000000"
          onNodeClick={handleNodeClick} // AQUI LIGAMOS O CLIQUE
        />
      </main>
    </div>
  );
}