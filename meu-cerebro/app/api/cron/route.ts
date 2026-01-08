import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format, parseISO, differenceInMinutes } from "date-fns";
import twilio from "twilio";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- FUNÇÃO PARA PEGAR HORA DO BRASIL ---
function getBrazilDate() {
  const dateString = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(dateString);
}

// --- ENVIO REAL USANDO SUAS VARIÁVEIS ---
async function sendWhatsAppMessage(text: string) {
  try {
    const from = process.env.TWILIO_WHATSAPP_NUMBER; // Variável correta do Vercel
    const to = process.env.MY_WHATSAPP_NUMBER;       // Variável correta do Vercel

    if (!from || !to) throw new Error("Faltam variáveis de ambiente (TWILIO_WHATSAPP_NUMBER ou MY_WHATSAPP_NUMBER)");

    await twilioClient.messages.create({ from, to, body: text });
    return "Enviado";
  } catch (error: any) {
    console.error("Erro Twilio:", error);
    return `Erro: ${error.message}`;
  }
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const forceMode = searchParams.get('force') === 'true';
    
    // Usa hora do Brasil
    const now = getBrazilDate();
    const currentHour = now.getHours();
    const logs: string[] = [];

    // 1. ROTINA MATINAL (07:00)
    if (currentHour === 7 || forceMode) {
        const todayKey = format(now, 'yyyy-MM-dd');
        
        const { data: apps } = await supabase.from('nodes')
            .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${todayKey}%`);

        const { data: habits } = await supabase.from('nodes')
            .select('label').eq('group', 'habit');

        let msg = `☀️ *Bom dia! Briefing de ${format(now, 'dd/MM')}:*\n\n`;
        if (habits && habits.length > 0) msg += `💪 *Foco:* \n` + habits.map(h => `- ${h.label}`).join("\n");
        msg += `\n\n`;
        if (apps && apps.length > 0) {
            msg += `📅 *Agenda:*\n` + apps.map(a => {
                const time = a.due_date.split('T')[1].substring(0,5);
                return `[${time}] ${a.label}`;
            }).join("\n");
        } else {
            msg += `📅 Agenda livre!`;
        }

        const res = await sendWhatsAppMessage(msg);
        logs.push("Matinal: " + res);
    }

    // 2. ROTINA NOTURNA (22:00)
    if (currentHour === 22 || forceMode) {
        const tomorrow = addDays(now, 1);
        const tomorrowKey = format(tomorrow, 'yyyy-MM-dd');
        
        const { data: apps } = await supabase.from('nodes')
            .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${tomorrowKey}%`);

        if (apps && apps.length > 0) {
            let msg = `🌙 *Amanhã (${format(tomorrow, 'dd/MM')}):*\n\n`;
            msg += apps.map(a => {
                const time = a.due_date.split('T')[1].substring(0,5);
                return `• ${time} - ${a.label}`;
            }).join("\n");
            const res = await sendWhatsAppMessage(msg);
            logs.push("Noturna: " + res);
        }
    }

    // 3. ALERTA 30 MIN
    const { data: futureApps } = await supabase.from('nodes')
        .select('*').eq('group', 'compromisso').gt('due_date', now.toISOString());

    if (futureApps) {
        for (const app of futureApps) {
            const appTime = parseISO(app.due_date); // Note: due_date no banco já deve estar em ISO
            const diff = differenceInMinutes(appTime, now);

            if (diff >= 25 && diff <= 35) {
                const res = await sendWhatsAppMessage(`🚨 *CORRE!* "${app.label}" começa em 30 min!`);
                logs.push(`Alerta 30min (${app.label}): ${res}`);
            }
        }
    }

    return NextResponse.json({ status: "Executado (Brasil Time)", logs });
}