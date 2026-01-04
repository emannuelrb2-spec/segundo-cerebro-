import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await request.formData();
    const body = formData.get("Body")?.toString() || "";
    const mediaUrl = formData.get("MediaUrl0")?.toString() || null;
    
    const cleanBody = body.replace(/^Criar:\s*/i, "");
    const parts = cleanBody.split(">").map((p) => p.trim());

    // --- CENÁRIO 1: MODO SIMPLES (Ajustado para não repetir) ---
    if (parts.length < 2) {
       const topicName = parts[0];

       // 1. Procurar se já existe uma bolinha com esse nome
       const { data: existingNode } = await supabase
         .from("nodes")
         .select("*")
         .eq("label", topicName)
         .single();

       if (existingNode) {
         // Se existe, apenas atualizamos o conteúdo (content)
         await supabase
           .from("nodes")
           .update({ 
              content: (existingNode.content || "") + "\n" + (mediaUrl ? "[Nova Imagem]" : ""),
              image_url: mediaUrl || existingNode.image_url 
           })
           .eq("id", existingNode.id);
         
         return NextResponse.json({ message: "Tópico atualizado!" });
       } else {
         // Se não existe, cria do zero (como era antes)
         await supabase.from("nodes").insert([{ 
            id: topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
            label: topicName, group: "topic", image_url: mediaUrl, content: "" 
         }]);
         return NextResponse.json({ message: "Novo tópico criado!" });
       }
    }

    // --- CENÁRIO 2: MODO AVANÇADO (Categoria > Tópico) ---
    const categoryName = parts[0]; 
    const topicName = parts[1];    
    const contentText = parts[2] || ""; 

    // A. Buscar ou Criar Categoria (Pai)
    let { data: parentNode } = await supabase.from("nodes").select("id").eq("label", categoryName).single();

    if (!parentNode) {
      const { data: newParent } = await supabase.from("nodes").insert([{ 
          id: categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          label: categoryName, group: "category" 
      }]).select().single();
      parentNode = newParent;
    }

    // B. Tópico Filho (AQUI ESTÁ A MUDANÇA PRINCIPAL)
    // 1. Primeiro, procuramos se esse tópico já existe dentro dessa categoria
    let { data: existingTopic } = await supabase
      .from("nodes")
      .select("*")
      .eq("label", topicName)
      .single();

    if (existingTopic) {
      // 2. Se já existe, apenas somamos o texto novo ao antigo
      const novoTexto = (existingTopic.content || "") + "\n---\n" + contentText;
      
      await supabase
        .from("nodes")
        .update({ 
          content: novoTexto,
          image_url: mediaUrl || existingTopic.image_url 
        })
        .eq("id", existingTopic.id);

      return NextResponse.json({ message: "Conteúdo adicionado ao tópico existente!" });

    } else {
      // 3. Se não existe, aí sim criamos e fazemos o link
      const topicId = topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
      const { data: newNode } = await supabase.from("nodes").insert([{ 
          id: topicId, label: topicName, group: "topic", content: contentText, image_url: mediaUrl 
      }]).select().single();

      if (parentNode && newNode) {
        await supabase.from("links").insert([{ source: parentNode.id, target: newNode.id }]);
      }
      return NextResponse.json({ message: "Nova conexão criada!" });
    }

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}