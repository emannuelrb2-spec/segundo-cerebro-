import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    // Conexão Segura
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Chaves do Supabase não encontradas.");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Ler a mensagem
    const formData = await request.formData();
    const body = formData.get("Body")?.toString() || "";
    const mediaUrl = formData.get("MediaUrl0")?.toString() || null;
    
    console.log("Mensagem:", body);

    // Remove o prefixo "Criar:" se o usuário usar, pra ficar limpo
    // Ex: "Criar: Comprar Pão" vira só "Comprar Pão"
    const cleanBody = body.replace(/^Criar:\s*/i, "");

    // 2. Tenta separar por >
    const parts = cleanBody.split(">").map((p) => p.trim());

    // --- CENÁRIO 1: MODO SIMPLES (Só uma bolinha) ---
    if (parts.length < 2) {
       const topicName = parts[0];
       
       const { error } = await supabase
        .from("nodes")
        .insert([{ 
            id: topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
            label: topicName, 
            group: "topic", // Cria como tópico solto
            image_url: mediaUrl,
            content: "" // Sem descrição extra
        }]);

       if (error) throw error;
       return NextResponse.json({ message: "Ideia simples salva!" });
    }

    // --- CENÁRIO 2: MODO AVANÇADO (Categoria > Tópico) ---
    const categoryName = parts[0]; 
    const topicName = parts[1];    
    const contentText = parts[2] || ""; 

    // A. Categoria
    let { data: parentNode } = await supabase
      .from("nodes")
      .select("id")
      .eq("label", categoryName)
      .single();

    if (!parentNode) {
      const { data: newParent, error: parentError } = await supabase
        .from("nodes")
        .insert([{ 
            id: categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            label: categoryName, 
            group: "category" 
        }])
        .select()
        .single();

      if (parentError) throw parentError;
      parentNode = newParent;
    }

    // B. Tópico Filho
    const topicId = topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
    const { data: newNode, error: nodeError } = await supabase
      .from("nodes")
      .insert([{ 
          id: topicId,
          label: topicName, 
          group: "topic",
          content: contentText, 
          image_url: mediaUrl   
      }])
      .select()
      .single();

    if (nodeError) throw nodeError;

    // C. Conexão
    if (parentNode && newNode) {
        const { error: linkError } = await supabase
        .from("links")
        .insert([{ source: parentNode.id, target: newNode.id }]);

        if (linkError) throw linkError;
    }

    return NextResponse.json({ message: "Conexão inteligente criada!" });

  } catch (error: any) {
    console.error("Erro:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
// Atualização forçada v2