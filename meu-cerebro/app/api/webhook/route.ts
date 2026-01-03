import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// 1. Configuração do Banco (Igual ao seu front-end)
const supabaseUrl = "https://ebfqjykumgberaavzavy.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViZnFqeWt1bWdiZXJhYXZ6YXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0MDcyNTUsImV4cCI6MjA4Mjk4MzI1NX0.h7X70CBM5HQE9vbZsM31zwxiCSKYfJDogtkj960WUoU"; // <--- COLE SUA CHAVE AQUI
const supabase = createClient(supabaseUrl, supabaseKey);

// 2. O Robô que escuta mensagens (POST)
export async function POST(request: Request) {
  try {
    // O Twilio manda os dados num formato estranho (FormData), vamos ler:
    const formData = await request.formData();
    const messageBody = formData.get("Body")?.toString() || ""; // O texto da mensagem
    const sender = formData.get("From")?.toString() || "";      // Quem mandou

    console.log("📩 Mensagem recebida:", messageBody);

    // --- LÓGICA DO JARVIS ---
    
    // Comando 1: "Criar: Alguma Coisa"
    if (messageBody.toLowerCase().startsWith("criar:")) {
        const nomeDaIdeia = messageBody.split(":")[1].trim();
        const newId = nomeDaIdeia.toLowerCase().replace(/\s/g, "_") + "_" + Date.now();

        // Salva no Supabase
        await supabase.from('nodes').insert([
            { id: newId, name: nomeDaIdeia, notes: `Criado via WhatsApp por ${sender}` }
        ]);

        return NextResponse.json({ message: "✅ Ideia criada!" });
    }

    // Comando 2: "Nota: Texto da nota" (Adiciona nota ao último nó criado - simples)
    // (Podemos melhorar isso depois para vincular a tópicos específicos)
    
    // Resposta padrão se não entender
    return NextResponse.json({ message: "Robô recebeu, mas não entendeu o comando." });

  } catch (error) {
    console.error("Erro no robô:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}