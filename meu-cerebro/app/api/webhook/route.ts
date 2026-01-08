import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format } from "date-fns";
import twilio from "twilio";

// --- CONFIGURAÇÕES ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- FUNÇÃO DE AJUDA: EXTRAIR DATA/HORA ---
function extractBookingDetails(text: string) {
  let cleanText = text.toLowerCase();
  const today = new Date();
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
    // 1. Receber dados do Twilio ou Teste
    const contentType = req.headers.get('content-type') || '';
    let message = "";
    let sender = "";
    let mediaUrl = null;

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

    // ============================================================
    // PARTE 1: INTELIGÊNCIA NOVA (Status, Agenda, Check)
    // ============================================================

    // -> AGENDAR
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

    // -> CHECK / FEITO
    else if (firstWord === "check" || firstWord === "feito") {
      const habitName = message.substring(message.indexOf(" ") + 1).toLowerCase();
      const dateKey = format(new Date(), "yyyy-MM-dd");
      const { data: habits } = await supabase.from('nodes').select('*').eq('group', 'habit');
      const targetHabit = habits?.find(h => h.label.toLowerCase().includes(habitName));

      if (targetHabit) {
        await supabase.from('nodes').insert([{
            id: `check_${dateKey}_${targetHabit.id}_0`,
            label: `Check ${targetHabit.label}`, group: 'habit_check', due_date: dateKey, content: targetHabit.id
        }]);
        responseText = `🔥 Hábito "${targetHabit.label}" marcado!`;
      } else {
        responseText = `❌ Hábito não encontrado. Tente: ${habits?.map(h => h.label).join(", ")}`;
      }
    }

    // -> STATUS (Relatório Inteligente)
    else if (firstWord === "status" || firstWord === "resumo") {
      const todayKey = format(new Date(), "yyyy-MM-dd");
      const { data: hbs } = await supabase.from('nodes').select('id, label').eq('group', 'habit');
      const { data: hChecks } = await supabase.from('nodes').select('content').eq('group', 'habit_check').eq('due_date', todayKey);
      const { data: apps } = await supabase.from('nodes').select('id, label, due_date').eq('group', 'compromisso').ilike('due_date', `${todayKey}%`);
      const { data: aChecks } = await supabase.from('nodes').select('content').eq('group', 'app_check');

      const pendingH = hbs?.filter(h => !hChecks?.some(c => c.content === h.id)) || [];
      const pendingA = apps?.filter(a => !aChecks?.some(c => c.content === a.id)) || [];

      responseText = `📊 *Status (${format(new Date(), 'dd/MM')}):*\n\n`;
      if (pendingH.length === 0 && pendingA.length === 0 && (hbs?.length||0) > 0) {
          responseText += "🎉 TUDO FEITO! 🔥";
      } else {
          if (pendingH.length > 0) responseText += `⚠️ *Falta:* \n` + pendingH.map(h => `[ ] ${h.label}`).join("\n");
          if (pendingA.length > 0) responseText += `\n📅 *Agenda:* \n` + pendingA.map(a => `[ ] ${a.label}`).join("\n");
      }
    }

    // -> DIÁRIO (Simples)
    else if (["diário", "diario", "reflexão"].includes(firstWord)) {
        const content = message.substring(message.indexOf(" ") + 1);
        const dateKey = format(new Date(), "yyyy-MM-dd");
        const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', dateKey).maybeSingle();
        if (existing) await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
        else await supabase.from('nodes').insert([{ id: `log_${Date.now()}`, label: `Log`, content, group: 'daily_log', due_date: dateKey, color: '#fff' }]);
        responseText = "📝 Salvo no diário.";
    }

    // ============================================================
    // PARTE 2: INTELIGÊNCIA ANTIGA (Criação de Tópicos com '>')
    // ============================================================
    else if (message.includes(">")) {
        const parts = message.split(">").map((p) => p.trim());
        if (parts.length >= 2) {
            const categoryName = parts[0];
            const topicName = parts[1];
            const contentText = parts[2] || "";

            // 1. Acha ou cria Categoria
            let { data: parentNode } = await supabase.from("nodes").select("id").eq("label", categoryName).maybeSingle();
            if (!parentNode) {
                const { data: newParent } = await supabase.from("nodes").insert([{ 
                    id: categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                    label: categoryName, group: "category", color: "#ef4444"
                }]).select().single();
                parentNode = newParent;
            }

            // 2. Cria Tópico
            const topicId = topicName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
            const { data: newNode } = await supabase.from("nodes").insert([{ 
                id: topicId, label: topicName, group: "topic",
                content: contentText, image_url: mediaUrl, color: "#6b7280"
            }]).select().single();

            // 3. Linka
            if (parentNode && newNode) {
                await supabase.from("links").insert([{ source: parentNode.id, target: newNode.id }]);
            }
            responseText = `🔗 Conexão criada: ${categoryName} > ${topicName}`;
        }
    }

    // ============================================================
    // PARTE 3: ENVIO DA RESPOSTA
    // ============================================================
    
    if (responseText) {
        // Se formou uma resposta, envia
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to: sender,
            body: responseText
        });
    }

    return NextResponse.json({ status: "OK" });

  } catch (error: any) {
    console.error("Erro API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}