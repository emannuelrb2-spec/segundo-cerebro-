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
    const mediaUrl = formData.get("MediaUrl0")?.toString() || null; // Pega a foto se tiver
    
    console.log("Mensagem recebida:", body);
    console.log("Imagem recebida:", mediaUrl);

    // 2. A Mágica do "Split" (Separar por >)
    // Formato esperado: Categoria > Tópico > Conteúdo
    const parts = body.split(">").map((p) => p.trim());

    // Se o usuário mandou só uma palavra, tratamos como antes (apenas um nó solto)
    if (parts.length < 2) {
       return NextResponse.json({ message: "Formato simples recebido. Use: Categoria > Tópico" });
    }

    const categoryName = parts[0]; // Ex: Projetos
    const topicName = parts[1];    // Ex: Site Novo
    const contentText = parts[2] || ""; // Ex: Mudar cor do botão (pode ser vazio)

    // --- PASSO A: Lidar com a Categoria (O Pai) ---
    // Verifica se a categoria já existe
    let { data: parentNode } = await supabase
      .from("nodes")
      .select("id")
      .eq("label", categoryName)
      .single();

    // Se não existe, cria a categoria
    if (!parentNode) {
      const { data: newParent, error: parentError } = await supabase
        .from("nodes")
        .insert([{ 
            id: categoryName.toLowerCase().replace(/\s/g, '-'), // id amigável
            label: categoryName, 
            group: "category" // Define cor diferente pra categoria
        }])
        .select()
        .single();

      if (parentError) throw parentError;
      parentNode = newParent;
    }

    // --- PASSO B: Criar o Tópico (O Filho) com Conteúdo e Foto ---
    const topicId = topicName.toLowerCase().replace(/\s/g, '-') + '-' + Date.now(); // ID único

    const { data: newNode, error: nodeError } = await supabase
      .from("nodes")
      .insert([{ 
          id: topicId,
          label: topicName, 
          group: "topic",
          content: contentText, // Salva o texto descritivo
          image_url: mediaUrl   // Salva o link da foto do Whatsapp
      }])
      .select()
      .single();

    if (nodeError) throw nodeError;

    // --- PASSO C: Criar a Conexão (Link) ---
    // Liga a Categoria ao Tópico
    const { error: linkError } = await supabase
      .from("links")
      .insert([{ 
          source: parentNode.id, 
          target: newNode.id 
      }]);

    if (linkError) throw linkError;

    return NextResponse.json({ message: "Cérebro atualizado com sucesso!" });

  } catch (error) {
    console.error("Erro no processamento:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}