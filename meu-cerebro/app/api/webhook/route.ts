import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Função auxiliar simples para extrair datas do texto (ex: 12/05 ou 12/05/2026 às 14:00)
function extractDate(text: string): Date | null {
  // Regex para capturar DD/MM ou DD/MM/AAAA e horas opcionais
  const dateRegex = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(?:às|as|at)?\s*(\d{1,2}:\d{2}|\d{1,2}h))?/i;
  const match = text.match(dateRegex);

  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1; // JS conta meses de 0 a 11
    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
    
    let hours = 0;
    let minutes = 0;

    if (match[4]) {
      const timeParts = match[4].replace('h', '').split(':');
      hours = parseInt(timeParts[0]);
      minutes = timeParts[1] ? parseInt(timeParts[1]) : 0;
    }

    const dateObj = new Date(year, month, day, hours, minutes);
    
    // Se a data já passou este ano (ex: digitou 01/01 em Dezembro), assume ano que vem? 
    // Por enquanto, mantemos o ano atual se não especificado.
    return dateObj;
  }
  return null;
}

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

    // --- CENÁRIO 1: MODO SIMPLES ---
    if (parts.length < 2) {
       const topicName = parts[0];
       
       // Verifica se é um comando de visualização (ex: "Agenda")
       if(topicName.toLowerCase() === 'agenda') {
          // AQUI entraria a lógica de buscar os compromissos, mas
          // como este endpoint recebe webhook do Twilio, ele espera salvar dados.
          // Para LEITURA, precisaríamos configurar uma resposta diferente.
          return NextResponse.json({ message: "Comando de leitura recebido (Lógica pendente)" });
       }

       const { data: existingNode } = await supabase
         .from("nodes")
         .select("*")
         .eq("label", topicName)
         .single();

       if (existingNode) {
         await supabase
           .from("nodes")
           .update({ 
             content: (existingNode.content || "") + "\n" + (mediaUrl ? "[Nova Imagem]" : ""),
             image_url: mediaUrl || existingNode.image_url 
           })
           .eq("id", existingNode.id);
         
         return NextResponse.json({ message: "Tópico atualizado!" });
       } else {
         await supabase.from("nodes").insert([{ 
            id: topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
            label: topicName, 
            group: "topic", 
            image_url: mediaUrl, 
            content: "" 
         }]);
         return NextResponse.json({ message: "Novo tópico criado!" });
       }
    }

    // --- CENÁRIO 2: MODO AVANÇADO (Categoria > Tópico > Conteúdo) ---
    const categoryName = parts[0]; 
    const topicName = parts[1];    
    const contentText = parts[2] || ""; 

    // DETECÇÃO DE DATA E TIPO
    // Se acharmos uma data no texto, classificamos como 'compromisso'
    const detectedDate = extractDate(contentText);
    const nodeGroup = detectedDate ? "compromisso" : "topic";
    
    // A. Buscar ou Criar Categoria (Pai)
    let { data: parentNode } = await supabase.from("nodes").select("id").eq("label", categoryName).single();

    if (!parentNode) {
      const { data: newParent } = await supabase.from("nodes").insert([{ 
          id: categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          label: categoryName, 
          group: "category" 
      }]).select().single();
      parentNode = newParent;
    }

    // B. Tópico Filho
    let { data: existingTopic } = await supabase
      .from("nodes")
      .select("*")
      .eq("label", topicName)
      .single();

    if (existingTopic) {
      const novoTexto = (existingTopic.content || "") + "\n---\n" + contentText;
      
      // Se for atualização, decidimos se atualizamos a data ou mantemos a antiga
      // Lógica: Se o novo texto tem data, atualiza o due_date.
      const updatePayload: any = { 
        content: novoTexto,
        image_url: mediaUrl || existingTopic.image_url,
      };

      if (detectedDate) {
        updatePayload.due_date = detectedDate.toISOString();
        updatePayload.group = "compromisso"; // Promove a nota a compromisso
      }

      await supabase
        .from("nodes")
        .update(updatePayload)
        .eq("id", existingTopic.id);

      return NextResponse.json({ message: detectedDate ? "Compromisso agendado!" : "Nota adicionada!" });

    } else {
      const topicId = topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
      
      const { data: newNode } = await supabase.from("nodes").insert([{ 
          id: topicId, 
          label: topicName, 
          group: nodeGroup, // 'topic' ou 'compromisso'
          content: contentText, 
          image_url: mediaUrl,
          due_date: detectedDate ? detectedDate.toISOString() : null, // Salva a data no banco
          is_completed: false // Padrão para novos itens
      }]).select().single();

      if (parentNode && newNode) {
        await supabase.from("links").insert([{ source: parentNode.id, target: newNode.id }]);
      }
      return NextResponse.json({ message: detectedDate ? "Novo compromisso criado!" : "Nova nota criada!" });
    }

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}