import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format, parseISO, differenceInMinutes, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- SIMULAÇÃO DE ENVIO ---
// No futuro, aqui entra a chamada para Twilio ou Evolution API
async function sendWhatsAppMessage(text: string) {
    console.log("\n🔔 [WHATSAPP SENDING] --------------------------------");
    console.log(text);
    console.log("------------------------------------------------------\n");
    return text; // Retorna o texto para visualizarmos na resposta da API
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const forceMode = searchParams.get('force') === 'true'; // ?force=true para testar fora do horário
    
    const now = new Date();
    const currentHour = now.getHours();
    const logs: string[] = [];

    // ============================================================
    // 1. ROTINA MATINAL (07:00)
    // Mostra hábitos e compromissos do dia
    // ============================================================
    if (currentHour === 7 || forceMode) {
        const todayKey = format(now, 'yyyy-MM-dd');
        
        // Busca Compromissos de Hoje
        const { data: apps } = await supabase.from('nodes')
            .select('label, due_date')
            .eq('group', 'compromisso')
            .ilike('due_date', `${todayKey}%`);

        // Busca Hábitos (Estáticos no banco)
        const { data: habits } = await supabase.from('nodes')
            .select('label')
            .eq('group', 'habit');

        let msg = `☀️ *Bom dia! Aqui está seu briefing de hoje (${format(now, 'dd/MM')}):*\n\n`;
        
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
        logs.push("Rotina Matinal Disparada: " + log);
    }

    // ============================================================
    // 2. ROTINA NOTURNA (22:00) - PREVIEW DO DIA SEGUINTE
    // ============================================================
    if (currentHour === 22 || forceMode) {
        const tomorrow = addDays(now, 1);
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
            logs.push("Rotina Noturna Disparada: " + log);
        }
    }

    // ============================================================
    // 3. ALERTA DE URGÊNCIA (30 MIN ANTES)
    // Roda a cada 10 min
    // ============================================================
    // Busca compromissos futuros hoje
    const { data: futureApps } = await supabase.from('nodes')
        .select('*')
        .eq('group', 'compromisso')
        .gt('due_date', now.toISOString());

    if (futureApps) {
        for (const app of futureApps) {
            const appTime = parseISO(app.due_date);
            const diff = differenceInMinutes(appTime, now);

            // Regra: Se falta entre 25 e 35 minutos para começar
            if (diff >= 25 && diff <= 35) {
                const msg = `🚨 *CORRE!* "${app.label}" começa em 30 minutos!`;
                const log = await sendWhatsAppMessage(msg);
                logs.push("Alerta 30min Disparado: " + log);
            }
        }
    }

    if (logs.length === 0) {
        return NextResponse.json({ status: "Nenhuma rotina agendada para este horário.", serverTime: format(now, 'HH:mm') });
    }

    return NextResponse.json({ status: "Rotinas Executadas", messagesSent: logs });
}