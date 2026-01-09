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

function getBrazilDate() {
  const now = new Date();
  return new Date(now.getTime() - (3 * 60 * 60 * 1000));
}

async function sendWhatsAppMessage(text: string) {
  try {
    const from = process.env.TWILIO_WHATSAPP_NUMBER; 
    const to = process.env.MY_WHATSAPP_NUMBER;      
    if (!from || !to) return;
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
    
    const now = getBrazilDate();
    const currentHour = now.getHours();
    const todayKey = format(now, 'yyyy-MM-dd');
    const logs: string[] = [];

    // ============================================================
    // 1. ROTINA MATINAL (07:00) - HOJE
    // ============================================================
    if (currentHour === 7 || forceMode) {
        const logId = `morning_msg_${todayKey}`;
        const { data: existing } = await supabase.from('nodes').select('id').eq('id', logId).maybeSingle();

        if (!existing || forceMode) {
            // Pega Compromissos de HOJE
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${todayKey}%`);
            // Pega Hábitos
            const { data: habits } = await supabase.from('nodes').select('label').eq('group', 'habit');

            let msg = `☀️ *Bom dia! Foco para hoje (${format(now, 'dd/MM')}):*\n\n`;
            
            if (habits && habits.length > 0) {
                msg += `💪 *Hábitos:*\n` + habits.map(h => `[ ] ${h.label}`).join("\n");
            }
            msg += `\n\n`;
            
            if (apps && apps.length > 0) {
                msg += `📅 *Agenda:*\n` + apps.map(a => {
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `• ${time} - ${a.label}`;
                }).join("\n");
            } else {
                msg += `📅 Agenda livre hoje!`;
            }

            await sendWhatsAppMessage(msg);
            logs.push("Matinal enviada.");
            if (!forceMode) await supabase.from('nodes').insert([{ id: logId, label: 'Log Matinal', group: 'system_log', due_date: todayKey }]);
        }
    }

    // ============================================================
    // 2. PRÉVIA DO DIA SEGUINTE (10:00 AM)
    // ============================================================
    // Você pediu para receber as 10h do dia anterior.
    if (currentHour === 10 || forceMode) {
        const logId = `preview_msg_${todayKey}`;
        const { data: existing } = await supabase.from('nodes').select('id').eq('id', logId).maybeSingle();

        if (!existing || forceMode) {
            const tomorrow = addDays(now, 1);
            const tomorrowKey = format(tomorrow, 'yyyy-MM-dd');
            
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${tomorrowKey}%`);

            if (apps && apps.length > 0) {
                let msg = `🔮 *Agenda de Amanhã (${format(tomorrow, 'dd/MM')}):*\n\n`;
                msg += apps.map(a => {
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `• ${time} - ${a.label}`;
                }).join("\n");
                
                await sendWhatsAppMessage(msg);
                logs.push("Preview Amanhã enviada.");
            }
            
            if (!forceMode) await supabase.from('nodes').insert([{ id: logId, label: 'Log Preview', group: 'system_log', due_date: todayKey }]);
        }
    }

    // ============================================================
    // 3. ALERTA DE 30 MINUTOS
    // ============================================================
    // Busca tudo que é futuro
    const realNowUTC = new Date(); // Para calculo de diff usamos UTC real
    const { data: futureApps } = await supabase.from('nodes')
        .select('*').eq('group', 'compromisso').gt('due_date', realNowUTC.toISOString());

    if (futureApps) {
        for (const app of futureApps) {
            const appTime = new Date(app.due_date);
            const diff = differenceInMinutes(appTime, realNowUTC);

            // Janela de disparo: entre 25 e 35 minutos antes
            if (diff >= 25 && diff <= 35) {
                const alertId = `alert_${app.id}`;
                const { data: sent } = await supabase.from('nodes').select('id').eq('id', alertId).maybeSingle();
                
                if (!sent) {
                    await sendWhatsAppMessage(`🚨 *Lembrete:* "${app.label}" começa em 30 min!`);
                    logs.push(`Alerta enviado: ${app.label}`);
                    // Marca que já avisou pra não floodar
                    await supabase.from('nodes').insert([{ id: alertId, label: 'Alert Log', group: 'system_log' }]);
                }
            }
        }
    }

    return NextResponse.json({ status: "Executado", logs });
}