import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format, parse, isValid, startOfDay, endOfDay } from "date-fns";
import twilio from "twilio";

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configuração do Twilio
// (Certifique-se de que essas variáveis estão no seu .env.local)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- 🧠 FUNÇÃO DE EXTRAÇÃO (IGUAL) ---
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
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      const currentYear = today.getFullYear();
      targetDate = new Date(currentYear, month, day);
      cleanText = cleanText.replace(dateMatch[0], "");
    }
  }

  const timeMatch = cleanText.match(/(\d{1,2})(?:h|:)(\d{2})?/);
  if (timeMatch) {
    let hour = timeMatch[1];
    let minute = timeMatch[2] || "00";
    targetTime = `${hour.padStart(2, '0')}:${minute}`;
    cleanText = cleanText.replace(timeMatch[0], "");
  }

  let title = cleanText.replace("agendar", "").replace(/\s(às|as|para|o|a)\s/g, " ").replace(/\s+/g, " ").trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { targetDate, targetTime, title };
}

// --- A ROTA PRINCIPAL (POST) ---
export async function POST(req: Request) {
  try {
    // --- 1. DETECTAR ORIGEM (Twilio vs Teste Local) ---
    const contentType = req.headers.get('content-type') || '';
    let message = "";
    let sender = "";
    let isTwilio = false;

    if (contentType.includes('application/json')) {
        // Veio da Caixinha de Teste no Site
        const body = await req.json();
        message = body.message;
        sender = "teste_local";
    } else {
        // Veio do WhatsApp Real (Twilio manda FormData)
        const formData = await req.formData();
        message = formData.get('Body') as string;
        sender = formData.get('From') as string; // Ex: whatsapp:+55...
        isTwilio = true;
    }

    if (!message) return NextResponse.json({ error: "Vazio" }, { status: 400 });

    const cleanMessage = message.trim();
    const firstWord = cleanMessage.split(" ")[0].toLowerCase();
    let responseText = "";

    // ======================================================
    // 2. PROCESSAR INTENÇÃO (Sua lógica existente)
    // ======================================================

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
        responseText = "❌ Erro. Ex: 'Agendar amanhã 15h Reunião'";
      }
    }

    // -> DIÁRIO / REFLEXÃO
    else if (["diário", "diario", "reflexão", "reflexao"].includes(firstWord)) {
      const content = message.substring(message.indexOf(" ") + 1);
      const dateKey = format(new Date(), "yyyy-MM-dd");
      const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', dateKey).maybeSingle();
      
      if (existing) await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
      else await supabase.from('nodes').insert([{ id: `log_${Date.now()}`, label: `Log`, content, group: 'daily_log', due_date: dateKey, color: '#fff' }]);
      responseText = "📝 Salvo no diário!";
    }

    // -> CHECK / FEITO
    else if (firstWord === "check" || firstWord === "feito") {
      const habitName = message.substring(message.indexOf(" ") + 1).toLowerCase();
      const dateKey = format(new Date(), "yyyy-MM-dd");
      const { data: habits } = await supabase.from('nodes').select('*').eq('group', 'habit');
      const targetHabit = habits?.find(h => h.label.toLowerCase().includes(habitName));

      if (targetHabit) {
        const checkId = `check_${dateKey}_${targetHabit.id}_0`;
        await supabase.from('nodes').insert([{
            id: checkId, label: `Check ${targetHabit.label}`, group: 'habit_check', due_date: dateKey, content: targetHabit.id
        }]);
        responseText = `🔥 Hábito "${targetHabit.label}" marcado!`;
      } else {
        responseText = `❌ Hábito não encontrado. Tente: ${habits?.map(h => h.label).join(", ")}`;
      }
    }

    // -> STATUS / RESUMO (A versão inteligente)
    else if (firstWord === "status" || firstWord === "resumo") {
      const todayKey = format(new Date(), "yyyy-MM-dd");
      
      const { data: habits } = await supabase.from('nodes').select('id, label').eq('group', 'habit');
      const { data: habitChecks } = await supabase.from('nodes').select('content').eq('group', 'habit_check').eq('due_date', todayKey);
      const { data: apps } = await supabase.from('nodes').select('id, label, due_date').eq('group', 'compromisso').ilike('due_date', `${todayKey}%`);
      const { data: appChecks } = await supabase.from('nodes').select('content').eq('group', 'app_check');

      const pendingHabits = habits?.filter(h => !habitChecks?.some(c => c.content === h.id)) || [];
      const pendingApps = apps?.filter(a => !appChecks?.some(c => c.content === a.id)) || [];

      responseText = `📊 *Status (${format(new Date(), 'dd/MM')}):*\n\n`;

      if (pendingHabits.length === 0 && pendingApps.length === 0 && (apps?.length||0) + (habits?.length||0) > 0) {
          responseText += "🎉 TUDO FEITO! Você é uma máquina. 🔥";
      } else {
          if (pendingHabits.length > 0) responseText += `⚠️ *Falta:* \n` + pendingHabits.map(h => `[ ] ${h.label}`).join("\n");
          if (pendingApps.length > 0) responseText += `\n📅 *Agenda:* \n` + pendingApps.map(a => `[ ] ${a.label}`).join("\n");
      }
    }

    // -> DEFAULT (Silencioso para conversas aleatórias, ou Ajuda)
    else {
        // Se quiser que ele responda sempre que não entender, descomente abaixo:
        // responseText = "🤖 Comandos: Agendar, Check, Diário, Status";
        return NextResponse.json({ reply: null }); // Retorna nada
    }

    // ======================================================
    // 3. ENTREGA DA RESPOSTA (O PULO DO GATO)
    // ======================================================
    
    if (isTwilio) {
        // Se veio do WhatsApp real, usamos a biblioteca do Twilio para responder
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            to: sender, // Responde para quem mandou
            body: responseText
        });
        return new NextResponse("OK"); // Twilio exige um 200 OK simples
    } else {
        // Se veio do teste local (caixinha verde), devolve JSON
        return NextResponse.json({ reply: responseText });
    }

  } catch (error: any) {
    console.error("Erro API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}