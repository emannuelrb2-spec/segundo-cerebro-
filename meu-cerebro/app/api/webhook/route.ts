import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    // 1. Ler os dados que o Twilio mandou
    const formData = await request.formData();
    const body = formData.get("Body")?.toString() || "";
    const mediaUrl = formData.get("MediaUrl0")?.toString() || null; 
    
    console.log("Mensagem recebida:", body);

    // 2. Separar por >
    const parts = body.split(">").map((p) => p.trim());

    if (parts.length < 2) {
       return NextResponse.json({ message: "Formato simples recebido." });
    }

    const categoryName = parts[0]; 
    const topicName = parts[1];    
    const contentText = parts[2] || ""; 

    // --- PASSO A: Categoria ---
    let { data: parentNode } = await supabase
      .from("nodes")
      .select("id")
      .eq("label", categoryName)
      .single();

    if (!parentNode) {
      const { data: newParent, error: parentError } = await supabase
        .from("nodes")
        .insert([{ 
            id: categoryName.toLowerCase().replace(/\s/g, '-'),
            label: categoryName, 
            group: "category" 
        }])
        .select()
        .single();

      if (parentError) throw parentError;
      parentNode = newParent;
    }

    // --- PASSO B: Tópico ---
    const topicId = topicName.toLowerCase().replace(/\s/g, '-') + '-' + Date.now();

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

    // --- CORREÇÃO AQUI EMBAIXO ---
    // Adicionamos uma verificação de segurança
    if (parentNode && newNode) {
        const { error: linkError } = await supabase
        .from("links")
        .insert([{ 
            source: parentNode.id, // Agora ele sabe que existe
            target: newNode.id 
        }]);

        if (linkError) throw linkError;
    }

    return NextResponse.json({ message: "Cérebro atualizado com sucesso!" });

  } catch (error) {
    console.error("Erro no processamento:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}