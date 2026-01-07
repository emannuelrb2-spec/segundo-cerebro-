import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import twilio from "twilio";

export const dynamic = 'force-dynamic'; // Importante para o Cron não cachear

export async function GET() {
  try {
    // 1. Configurações
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID, 
      process.env.TWILIO_AUTH_TOKEN
    );

    // 2. Definir o intervalo: HOJE (começo ao fim do dia)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 3. Buscar tarefas pendentes para hoje
    const { data: tasks } = await supabase
      .from("nodes")
      .select("label, content, due_date")
      .eq("group", "compromisso")
      .eq("is_completed", false)
      .gte("due_date", startOfDay.toISOString())
      .lte("due_date", endOfDay.toISOString());

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ message: "Nada para hoje." });
    }

    // 4. Montar a mensagem
    let messageBody = "🌞 *Bom dia! Sua agenda de hoje:*\n";
    
    tasks.forEach((task) => {
      const date = new Date(task.due_date);
      // Ajuste para hora do Brasil (simples) se estiver rodando em servidor UTC
      date.setHours(date.getHours() - 3); 
      const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      messageBody += `\n- [${time}] *${task.label}*: ${task.content.split('\n')[0]}`;
    });

    messageBody += "\n\nResponda 'OK' para marcar como concluído.";

    // 5. Enviar via Twilio
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: process.env.MY_WHATSAPP_NUMBER!,
      body: messageBody,
    });

    return NextResponse.json({ success: true, count: tasks.length });

  } catch (error: any) {
    console.error("Erro no Cron:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}