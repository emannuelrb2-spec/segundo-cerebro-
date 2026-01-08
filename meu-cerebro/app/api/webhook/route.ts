import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format } from "date-fns";
import twilio from "twilio";

// --- CONFIGURAÇÕES ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- TWILIO CLIENT ---
// Usa as chaves do ambiente
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- 🇧🇷 CORREÇÃO DE FUSO HORÁRIO ---
// Garante que o servidor (UTC) entenda que estamos no Brasil (-3h)
function getBrazilDate() {
  const dateString = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(dateString);
}

// --- FUNÇÃO AUXILIAR: EXTRAIR DADOS ---
function extractBookingDetails(text: string) {
  let cleanText = text.toLowerCase();
  const today = getBrazilDate(); 
  let targetDate = today;
  let targetTime = "";
  
  if (cleanText.includes("amanhã") || cleanText.includes("amanha")) {
    targetDate = addDays(today, 1);
    cleanText = cleanText.replace("amanhã", "").replace("amanha", "");
  } else if (cleanText.includes("hoje")) {
    targetDate = today;
    cleanText = cleanText.replace("hoje", "");
  } else {
    const dateMatch = cleanText.match(/(\d{1,2})\/(\d{1,2})/);
    if (dateMatch) {
      const currentYear = today.getFullYear();
      targetDate = new Date(currentYear, parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
      cleanText = cleanText.replace(dateMatch[0], "");
    }
  }

  const timeMatch = cleanText.match(/(\d{1,2})(?:h|:)(\d{2})?/);
  if (timeMatch) {
    targetTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2] || "00"}`;
    cleanText = cleanText.replace(timeMatch[0], "");
  }

  let title = cleanText.replace("agendar", "").replace(/\s(às|as|para|o|a)\s/g, " ").replace(/\s+/g, " ").trim();
  return { targetDate, targetTime, title: title.charAt(0).toUpperCase() + title.slice(1) };
}

// --- ROTA PRINCIPAL ---
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let message = "";
    let sender = "";
    let mediaUrl = null;

    // Suporte para teste local e Twilio real
    if (contentType.includes('application/json')) {
        const body = await req.json();
        message = body.message;
        sender = "teste_local";
    } else {
        const formData = await req.formData();
        message = formData.get('Body') as string;
        sender = formData.get('From') as string;
        mediaUrl = formData.get("MediaUrl0")?.toString() || null;
    }

    if (!message) return NextResponse.json({ error: "Vazio" }, { status: 400 });

    const cleanMessage = message.trim();
    const firstWord = cleanMessage.split(" ")[0].toLowerCase();
    let responseText = "";
    
    // Define a data de hoje no Brasil
    const todayBrazil = getBrazilDate();
    const dateKey = format(todayBrazil, "yyyy-MM-dd");

    // ============================================================
    // 1. AGENDAR
    // ============================================================
    if (firstWord === "agendar") {
      const { targetDate, targetTime, title } = extractBookingDetails(message);
      if (targetDate && targetTime && title) {
        const dateStr = format(targetDate, "yyyy-MM-dd");
        await supabase.from('nodes').insert([{
          id: Date.now().toString(), label: title, due_date: `${dateStr}T${targetTime}:00`,
          group: 'compromisso', color: '#000000'
        }]);
        responseText = `✅ Agendado: "${title}"\n📅 ${format(targetDate, "dd/MM")} às ${targetTime}`;
      } else {
        responseText = "❌ Use: 'Agendar amanhã 15h Reunião'";
      }
    }

    // ============================================================
    // 2. CHECK (HÁBITOS)
    // ============================================================
    else if (firstWord === "check" || firstWord === "feito") {
      const habitName = message.substring(message.indexOf(" ") + 1).toLowerCase();
      const { data: habits } = await supabase.from('nodes').select('*').eq('group', 'habit');
      const targetHabit = habits?.find(h => h.label.toLowerCase().includes(habitName));

      if (targetHabit) {
        // Usa HÍFEN no ID para casar com o Frontend
        const checkId = `check_${dateKey}_${targetHabit.id}-0`; 
        
        await supabase.from('nodes').insert([{
            id: checkId,
            label: `Check ${targetHabit.label}`, group: 'habit_check', 
            due_date: dateKey, content: targetHabit.id
        }]);
        responseText = `🔥 Hábito "${targetHabit.label}" marcado para hoje (${format(todayBrazil, 'dd/MM')})!`;
      } else {
        responseText = `❌ Hábito não encontrado.`;
      }
    }

    // ============================================================
    // 3. STATUS (RESUMO DO DIA)
    // ============================================================
    else if (firstWord === "status" || firstWord === "resumo") {
      const { data: hbs } = await supabase.from('nodes').select('id, label').eq('group', 'habit');
      const { data: hChecks } = await supabase.from('nodes').select('content').eq('group', 'habit_check').eq('due_date', dateKey);
      const { data: apps } = await supabase.from('nodes').select('id, label, due_date').eq('group', 'compromisso').ilike('due_date', `${dateKey}%`);
      const { data: aChecks } = await supabase.from('nodes').select('content').eq('group', 'app_check');

      const pendingH = hbs?.filter(h => !hChecks?.some(c => c.content === h.id)) || [];
      const pendingA = apps?.filter(a => !aChecks?.some(c => c.content === a.id)) || [];

      responseText = `📊 *Status (${format(todayBrazil, 'dd/MM')}):*\n\n`;
      if (pendingH.length === 0 && pendingA.length === 0 && (hbs?.length||0) > 0) {
          responseText += "🎉 TUDO FEITO! Você destruiu hoje. 🔥";
      } else {
          if (pendingH.length > 0) responseText += `⚠️ *Falta:* \n` + pendingH.map(h => `[ ] ${h.label}`).join("\n");
          if (pendingA.length > 0) responseText += `\n📅 *Agenda:* \n` + pendingA.map(a => `[ ] ${a.label}`).join("\n");
      }
    }

    // ============================================================
    // 4. DIÁRIO / REFLEXÃO
    // ============================================================
    else if (["diário", "diario", "reflexão", "reflexao"].includes(firstWord)) {
        const content = message.substring(message.indexOf(" ") + 1);
        const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', dateKey).maybeSingle();
        
        if (existing) await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
        else await supabase.from('nodes').insert([{ id: `log_${Date.now()}`, label: `Log`, content, group: 'daily_log', due_date: dateKey, color: '#fff' }]);
        responseText = `📝 Salvo no diário de ${format(todayBrazil, 'dd/MM')}.`;
    }

    // ============================================================
    // 5. TÓPICOS (Formato Antigo com >)
    // ============================================================
    else if (message.includes(">")) {
        const parts = message.split(">").map((p) => p.trim());
        if (parts.length >= 2) {
            const [cat, top, txt] = parts;
            let { data: parent } = await supabase.from("nodes").select("id").eq("label", cat).maybeSingle();
            if (!parent) { const { data: np } = await supabase.from("nodes").insert([{ id: `cat_${Date.now()}`, label: cat, group: "category", color: "#ef4444" }]).select().single(); parent = np; }
            const { data: nn } = await supabase.from("nodes").insert([{ id: `node_${Date.now()}`, label: top, group: "topic", content: txt || "", image_url: mediaUrl, color: "#6b7280" }]).select().single();
            if (parent && nn) await supabase.from("links").insert([{ source: parent.id, target: nn.id }]);
            responseText = `🔗 Conexão criada: ${cat} > ${top}`;
        }
    }

    // ============================================================
    // 6. ENVIO DA RESPOSTA (CORRIGIDO PARA SUAS VARIÁVEIS)
    // ============================================================
    
    if (responseText && sender !== "teste_local") {
        // Pega o número do robô da variável certa
        const botNumber = process.env.TWILIO_WHATSAPP_NUMBER; 

        if (botNumber) {
            await twilioClient.messages.create({
                from: botNumber,
                to: sender,
                body: responseText
            });
        } else {
            console.error("ERRO: Variável TWILIO_WHATSAPP_NUMBER não encontrada na Vercel.");
        }
    }

    return NextResponse.json({ status: "OK", reply: responseText });

  } catch (error: any) {
    console.error("Erro API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}