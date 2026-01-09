import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, subDays, format, parseISO, isSameDay, subHours } from "date-fns";
import twilio from "twilio";

// --- CONFIGURAÇÕES ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BOT_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; 

// --- 🇧🇷 CORREÇÃO SIMPLES DE FUSO (SEM VOLTAR DIA) ---
// Removemos a lógica de "madrugada". Agora é data calendário pura.
function getVirtualDate() {
  const now = new Date();
  // Apenas subtrai 3 horas para cair no horário do Brasil
  // Se for 00:01 no Brasil, já conta como o novo dia.
  const brazilTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
  return brazilTime;
}

// Data real (para agendar no futuro)
function getRealBrazilDate() {
    const now = new Date();
    return new Date(now.getTime() - (3 * 60 * 60 * 1000));
}

// --- CHECAGEM DE DATA ROBUSTA ---
function isSameDayBrazil(isoString: string, targetDate: Date) {
    const dbDateUTC = parseISO(isoString);
    const dbDateBrazil = subHours(dbDateUTC, 3);
    return isSameDay(dbDateBrazil, targetDate);
}

function extractBookingDetails(text: string) {
  let cleanText = text.toLowerCase();
  const today = getRealBrazilDate(); 
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
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { targetDate, targetTime, title };
}

// --- ROTA PRINCIPAL ---
export async function POST(req: Request) {
  try {
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
    
    // Agora usa a data "reta", sem voltar 1 dia na madrugada
    const virtualDate = getVirtualDate();
    const virtualDateKey = format(virtualDate, "yyyy-MM-dd");

    // 1. AGENDAR
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
        responseText = "❌ Exemplo: 'Agendar amanhã 15h Dentista'";
      }
    }

    // 2. CHECK (Hábito ou Compromisso)
    else if (firstWord === "check" || firstWord === "feito") {
      const searchTerm = message.substring(message.indexOf(" ") + 1).toLowerCase();
      
      const { data: habits } = await supabase.from('nodes').select('*').eq('group', 'habit');
      const targetHabit = habits?.find(h => h.label.toLowerCase().includes(searchTerm));

      if (targetHabit) {
        const checkId = `check_${virtualDateKey}_${targetHabit.id}-0`; 
        const { error } = await supabase.from('nodes').insert([{
            id: checkId, label: `Check ${targetHabit.label}`, group: 'habit_check', 
            due_date: virtualDateKey, content: targetHabit.id
        }]);
        if (!error) responseText = `🔥 Hábito "${targetHabit.label}" feito!`;
        else responseText = `⚠️ Hábito "${targetHabit.label}" já estava feito hoje.`;
      
      } else {
        // Busca compromissos DE HOJE (Data Calendário)
        const { data: apps } = await supabase.from('nodes').select('*').eq('group', 'compromisso');
        const todaysApps = apps?.filter(app => app.due_date && isSameDayBrazil(app.due_date, virtualDate)) || [];
        
        const targetApp = todaysApps.find(a => a.label.toLowerCase().includes(searchTerm));

        if (targetApp) {
            const dbId = `appdone_${targetApp.id}`;
            const { error } = await supabase.from('nodes').insert([{ 
                id: dbId, label: 'App Done', group: 'app_check', content: targetApp.id 
            }]);
            
            if(!error) responseText = `✅ Compromisso "${targetApp.label}" concluído!`;
            else responseText = `⚠️ Compromisso "${targetApp.label}" já estava concluído.`;
        } else {
            responseText = `❌ Não encontrei hábito nem compromisso HOJE com esse nome.`;
        }
      }
    }

    // 3. STATUS / RESUMO
    else if (firstWord === "status" || firstWord === "resumo") {
      const { data: hbs } = await supabase.from('nodes').select('id, label').eq('group', 'habit');
      const { data: hChecks } = await supabase.from('nodes').select('content').eq('group', 'habit_check').eq('due_date', virtualDateKey);
      
      const { data: allApps } = await supabase.from('nodes').select('id, label, due_date').eq('group', 'compromisso');
      // Filtra compromissos de HOJE (Data Calendário)
      const todaysApps = allApps?.filter(app => app.due_date && isSameDayBrazil(app.due_date, virtualDate)) || [];

      const { data: aChecks } = await supabase.from('nodes').select('content').eq('group', 'app_check');

      const pendingH = hbs?.filter(h => !hChecks?.some(c => c.content === h.id)) || [];
      const pendingA = todaysApps.filter(a => !aChecks?.some(c => c.content === a.id));

      responseText = `📊 *Status (${format(virtualDate, 'dd/MM')}):*\n\n`;
      
      if (pendingH.length === 0 && pendingA.length === 0 && (hbs?.length||0) > 0) {
          responseText += "🎉 Dia Finalizado! Parabéns.";
      } else {
          if (pendingH.length > 0) responseText += `⚠️ *Hábitos:*\n` + pendingH.map(h => `[ ] ${h.label}`).join("\n");
          if (pendingA.length > 0) {
              responseText += `\n📅 *Agenda:*\n` + pendingA.map(a => {
                  const dateUTC = parseISO(a.due_date);
                  const dateBR = subHours(dateUTC, 3);
                  return `[ ] ${a.label} (${format(dateBR, 'HH:mm')})`;
              }).join("\n");
          }
          if (pendingA.length === 0 && pendingH.length > 0) responseText += `\n📅 Agenda Livre!`;
      }
    }

    // 4. DIÁRIO (Correção aplicada aqui também)
    else if (["diário", "diario", "reflexão"].includes(firstWord)) {
        const content = message.substring(message.indexOf(" ") + 1);
        
        // Agora busca/salva na data CALENDÁRIO exata
        const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', virtualDateKey).maybeSingle();
        
        if (existing) {
            await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
        } else {
            await supabase.from('nodes').insert([{ id: `log_${Date.now()}`, label: `Log`, content, group: 'daily_log', due_date: virtualDateKey, color: '#fff' }]);
        }
        responseText = `📝 Salvo no diário de ${format(virtualDate, 'dd/MM')}.`;
    }

    // 5. TÓPICOS
    else if (message.includes(">")) {
        const parts = message.split(">").map((p) => p.trim());
        if (parts.length >= 2) {
            const [cat, top, txt] = parts;
            let { data: pNode } = await supabase.from("nodes").select("id").eq("label", cat).maybeSingle();
            if (!pNode) { const { data: n } = await supabase.from("nodes").insert([{ id: cat.toLowerCase().replace(/[^a-z0-9]/g, '-'), label: cat, group: "category", color: "#ef4444" }]).select().single(); pNode = n; }
            const tId = top.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
            const { data: nNode } = await supabase.from("nodes").insert([{ id: tId, label: top, group: "topic", content: txt || "", image_url: mediaUrl, color: "#6b7280" }]).select().single();
            if (pNode && nNode) await supabase.from("links").insert([{ source: pNode.id, target: nNode.id }]);
            responseText = `🔗 Salvo no Grafo: ${cat} > ${top}`;
        }
    }

    if (responseText && sender !== "teste_local" && BOT_NUMBER) {
        await twilioClient.messages.create({ from: BOT_NUMBER, to: sender, body: responseText });
    }

    return NextResponse.json({ status: "OK", reply: responseText });

  } catch (error: any) {
    console.error("Erro API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}