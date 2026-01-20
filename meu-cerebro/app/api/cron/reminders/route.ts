import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format, parseISO, differenceInMinutes, subHours, subMinutes, addMinutes, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import twilio from "twilio";

// --- CONFIGURAÇÃO ---
// ⚠️ COLOQUE SEU NÚMERO AQUI (Ex: whatsapp:+5561999999999)
const MEU_NUMERO = "whatsapp:+556198825063"; 
// --------------------

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_BOT = process.env.TWILIO_WHATSAPP_NUMBER;

// --- FUNÇÃO DE ENVIO REAL (TWILIO) ---
async function sendWhatsAppMessage(text: string) {
    if (!MEU_NUMERO || MEU_NUMERO.includes("SEU_NUMERO")) {
        console.error("ERRO: Número não configurado no código.");
        return "ERRO: Número não configurado";
    }

    try {
        await twilioClient.messages.create({
            from: TWILIO_BOT,
            to: MEU_NUMERO,
            body: text
        });
        return "Enviado com sucesso";
    } catch (error) {
        console.error("Erro Twilio:", error);
        return "Erro ao enviar";
    }
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const forceMode = searchParams.get('force') === 'true'; 
    
    // 1. AJUSTE DE FUSO HORÁRIO (CRUCIAL)
    const nowUTC = new Date();
    const nowBrazil = subHours(nowUTC, 3); // O servidor é UTC, nós somos -3
    const currentHour = nowBrazil.getHours();
    
    const logs: string[] = [];

    // ============================================================
    // 1. ROTINA MATINAL (07:00 BRASIL)
    // ============================================================
    if (currentHour === 7 || forceMode) {
        // Só executa nos primeiros minutos da hora 7 para evitar repetição (ou se forçado)
        if (nowBrazil.getMinutes() < 12 || forceMode) {
            const todayKey = format(nowBrazil, 'yyyy-MM-dd');
            
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date')
                .eq('group', 'compromisso')
                .ilike('due_date', `${todayKey}%`);

            const { data: habits } = await supabase.from('nodes')
                .select('label')
                .eq('group', 'habit');

            let msg = `☀️ *Bom dia! Aqui está seu briefing de hoje (${format(nowBrazil, 'dd/MM')}):*\n\n`;
            
            if (habits && habits.length > 0) {
                msg += `💪 *Foco nos Hábitos:*\n` + habits.map(h => `- ${h.label}`).join("\n");
            } else {
                msg += `💪 *Hábitos:* Nenhum configurado.`;
            }

            msg += `\n\n`;

            if (apps && apps.length > 0) {
                msg += `📅 *Agenda de Hoje:*\n` + apps.map(a => {
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `[${time}] ${a.label}`;
                }).join("\n");
            } else {
                msg += `📅 *Agenda:* Dia livre! Aproveite.`;
            }

            const log = await sendWhatsAppMessage(msg);
            logs.push("Rotina Matinal: " + log);
        }
    }

    // ============================================================
    // 2. ROTINA NOTURNA (22:00 BRASIL)
    // ============================================================
    if (currentHour === 22 || forceMode) {
        if (nowBrazil.getMinutes() < 12 || forceMode) {
            const tomorrow = addDays(nowBrazil, 1);
            const tomorrowKey = format(tomorrow, 'yyyy-MM-dd');
            
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date')
                .eq('group', 'compromisso')
                .ilike('due_date', `${tomorrowKey}%`);

            if (apps && apps.length > 0) {
                let msg = `🌙 *Preview de Amanhã (${format(tomorrow, 'dd/MM')}):*\n\n`;
                msg += `Não esqueça:\n` + apps.map(a => {
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `• ${time} - ${a.label}`;
                }).join("\n");
                
                const log = await sendWhatsAppMessage(msg);
                logs.push("Rotina Noturna: " + log);
            }
        }
    }

    // ============================================================
    // 3. ALERTAS DE TEMPO (30min ANTES + HORA EXATA)
    // ============================================================
    
    // MUDANÇA: Buscamos compromissos de 1h atrás para frente.
    // Isso garante que peguemos o compromisso que é "AGORA" mesmo se passar alguns segundos.
    const { data: activeApps } = await supabase.from('nodes')
        .select('*')
        .eq('group', 'compromisso')
        .gt('due_date', subHours(nowBrazil, 1).toISOString()); 

    // Janela para "Hora Exata" (centralizada no momento atual para cobrir o intervalo do Cron)
    const windowExactStart = subMinutes(nowBrazil, 6);
    const windowExactEnd = addMinutes(nowBrazil, 4);

    if (activeApps) {
        for (const app of activeApps) {
            const appTime = parseISO(app.due_date);
            
            // A) HORA EXATA (O Despertador)
            if (isWithinInterval(appTime, { start: windowExactStart, end: windowExactEnd })) {
                 const msg = `🔔 *AGORA:* ${app.label}\n⏰ ${format(appTime, "HH:mm")}`;
                 const log = await sendWhatsAppMessage(msg);
                 logs.push(`Alerta Hora Exata (${app.label}): ` + log);
            }

            // B) 30 MINUTOS ANTES (A Urgência)
            const diff = differenceInMinutes(appTime, nowBrazil);
            if (diff >= 25 && diff <= 35) {
                const msg = `🚨 *CORRE!* "${app.label}" começa em 30 minutos!`;
                const log = await sendWhatsAppMessage(msg);
                logs.push(`Alerta 30min (${app.label}): ` + log);
            }
        }
    }

    // Retorno para o Cron Job (Relatório)
    if (logs.length === 0) {
        return NextResponse.json({ 
            status: "Nenhuma rotina agendada para este horário.", 
            horaBrasil: format(nowBrazil, 'HH:mm'),
            horaServidorUTC: format(nowUTC, 'HH:mm')
        });
    }

    return NextResponse.json({ status: "Rotinas Executadas", logs, horaBrasil: format(nowBrazil, 'HH:mm') });
}