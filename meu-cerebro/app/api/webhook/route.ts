import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import twilio from "twilio"; // <--- NOVO: Importando o Twilio

// Função auxiliar simples para extrair datas do texto
function extractDate(text: string): Date | null {
  const dateRegex = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\s+(?:às|as|at)?\s*(\d{1,2}:\d{2}|\d{1,2}h))?/i;
  const match = text.match(dateRegex);

  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1; 
    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
    
    let hours = 0;
    let minutes = 0;

    if (match[4]) {
      const timeParts = match[4].replace('h', '').split(':');
      hours = parseInt(timeParts[0]);
      minutes = timeParts[1] ? parseInt(timeParts[1]) : 0;
    }

    return new Date(year, month, day, hours, minutes);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    // 1. Configurações do Banco e do Twilio
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // 2. Recebendo os dados do WhatsApp
    const formData = await request.formData();
    const body = formData.get("Body")?.toString() || "";
    const mediaUrl = formData.get("MediaUrl0")?.toString() || null;
    const sender = formData.get("From")?.toString(); // <--- QUEM MANDOU?

    const cleanBody = body.replace(/^Criar:\s*/i, "");
    const parts = cleanBody.split(">").map((p) => p.trim());
    
    let replyMessage = ""; // <--- AQUI VAMOS GUARDAR A RESPOSTA DO BOT

    // --- CENÁRIO 1: MODO SIMPLES ---
    if (parts.length < 2) {
       const topicName = parts[0];
       
       if(topicName.toLowerCase() === 'agenda') {
          // Futuramente aqui você pode listar os compromissos
          return NextResponse.json({ message: "Comando de leitura recebido" });
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
         
         replyMessage = `✅ Tópico '${topicName}' atualizado!`;
       } else {
         await supabase.from("nodes").insert([{ 
            id: topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
            label: topicName, 
            group: "topic", 
            image_url: mediaUrl, 
            content: "" 
         }]);
         replyMessage = `✨ Novo tópico '${topicName}' criado!`;
       }
    }

    // --- CENÁRIO 2: MODO AVANÇADO ---
    else {
        const categoryName = parts[0]; 
        const topicName = parts[1];    
        const contentText = parts[2] || ""; 

        // Detecção de Data
        const detectedDate = extractDate(contentText);
        const nodeGroup = detectedDate ? "compromisso" : "topic";
        
        // A. Categoria
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
            
            const updatePayload: any = { 
                content: novoTexto,
                image_url: mediaUrl || existingTopic.image_url,
            };

            if (detectedDate) {
                updatePayload.due_date = detectedDate.toISOString();
                updatePayload.group = "compromisso";
            }

            await supabase.from("nodes").update(updatePayload).eq("id", existingTopic.id);

            // Define a resposta baseada se foi data ou nota comum
            replyMessage = detectedDate 
                ? `📅 Compromisso agendado em '${topicName}'!` 
                : `📝 Nota adicionada em '${topicName}'!`;

        } else {
            const topicId = topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
            
            const { data: newNode } = await supabase.from("nodes").insert([{ 
                id: topicId, 
                label: topicName, 
                group: nodeGroup,
                content: contentText, 
                image_url: mediaUrl,
                due_date: detectedDate ? detectedDate.toISOString() : null,
                is_completed: false 
            }]).select().single();

            if (parentNode && newNode) {
                await supabase.from("links").insert([{ source: parentNode.id, target: newNode.id }]);
            }
            
            replyMessage = detectedDate 
                ? `📅 Novo compromisso '${topicName}' criado!` 
                : `🔗 Conexão criada: ${categoryName} > ${topicName}`;
        }
    }

    // --- 3. ENVIA A RESPOSTA PARA O WHATSAPP ---
    if (sender && replyMessage) {
        await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: sender,
            body: replyMessage
        });
    }

    return NextResponse.json({ message: "Processado com sucesso e respondido." });

  } catch (error: any) {
    console.error("Erro no Webhook:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}