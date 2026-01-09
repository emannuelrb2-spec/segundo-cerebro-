import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, format, parseISO, differenceInMinutes } from "date-fns";
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

// --- 🇧🇷 FUSO HORÁRIO MANUAL (-3h) ---
function getBrazilDate() {
  const now = new Date();
  // Subtrai 3h para garantir horário de Brasília no servidor UTC
  return new Date(now.getTime() - (3 * 60 * 60 * 1000));
}

// --- FUNÇÃO DE ENVIO ---
async function sendWhatsAppMessage(text: string) {
  try {
    const from = process.env.TWILIO_WHATSAPP_NUMBER; 
    const to = process.env.MY_WHATSAPP_NUMBER;      

    if (!from || !to) throw new Error("Faltam variáveis (TWILIO_WHATSAPP_NUMBER ou MY_WHATSAPP_NUMBER)");

    await twilioClient.messages.create({ from, to, body: text });
    return "Enviado";
  } catch (error: any) {
    console.error("Erro Twilio:", error);
    return `Erro: ${error.message}`;
  }
}

export async function GET(req: Request) {
    // Permite forçar execução via ?force=true na URL
    const { searchParams } = new URL(req.url);
    const forceMode = searchParams.get('force') === 'true';
    
    const now = getBrazilDate();
    const currentHour = now.getHours();
    const todayKey = format(now, 'yyyy-MM-dd');
    const logs: string[] = [];

    // ============================================================
    // 1. ROTINA MATINAL (07:00) - BLINDADA CONTRA SPAM
    // ============================================================
    if (currentHour === 7 || forceMode) {
        const logId = `system_msg_morning_${todayKey}`;

        // Verifica se JÁ enviou hoje para não repetir
        const { data: existing } = await supabase.from('nodes').select('id').eq('id', logId).maybeSingle();

        if (!existing || forceMode) {
            // Busca dados
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${todayKey}%`);

            const { data: habits } = await supabase.from('nodes')
                .select('label').eq('group', 'habit');

            // Monta mensagem
            let msg = `☀️ *Bom dia! Briefing de ${format(now, 'dd/MM')}:*\n\n`;
            if (habits && habits.length > 0) msg += `💪 *Foco:* \n` + habits.map(h => `- ${h.label}`).join("\n");
            msg += `\n\n`;
            if (apps && apps.length > 0) {
                msg += `📅 *Agenda:*\n` + apps.map(a => {
                    // Pega hora HH:mm da string ISO
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `[${time}] ${a.label}`;
                }).join("\n");
            } else {
                msg += `📅 Agenda livre! Aproveite.`;
            }

            // Envia e Marca como enviado no banco
            const res = await sendWhatsAppMessage(msg);
            logs.push("Matinal: " + res);

            if (!forceMode) {
                await supabase.from('nodes').insert([{ 
                    id: logId, label: 'Log Matinal', group: 'system_log', due_date: todayKey 
                }]);
            }
        } else {
            logs.push("Matinal: Já enviada hoje.");
        }
    }

    // ============================================================
    // 2. ROTINA NOTURNA (22:00) - BLINDADA
    // ============================================================
    if (currentHour === 22 || forceMode) {
        const logId = `system_msg_night_${todayKey}`;
        const { data: existing } = await supabase.from('nodes').select('id').eq('id', logId).maybeSingle();

        if (!existing || forceMode) {
            const tomorrow = addDays(now, 1);
            const tomorrowKey = format(tomorrow, 'yyyy-MM-dd');
            
            const { data: apps } = await supabase.from('nodes')
                .select('label, due_date').eq('group', 'compromisso').ilike('due_date', `${tomorrowKey}%`);

            if (apps && apps.length > 0) {
                let msg = `🌙 *Para amanhã (${format(tomorrow, 'dd/MM')}):*\n\n`;
                msg += apps.map(a => {
                    const time = a.due_date.split('T')[1].substring(0,5);
                    return `• ${time} - ${a.label}`;
                }).join("\n");
                
                const res = await sendWhatsAppMessage(msg);
                logs.push("Noturna: " + res);
            } else {
                logs.push("Noturna: Nada agendado para amanhã, sem msg.");
            }

            if (!forceMode) {
                await supabase.from('nodes').insert([{ 
                    id: logId, label: 'Log Noturno', group: 'system_log', due_date: todayKey 
                }]);
            }
        }
    }

    // ============================================================
    // 3. ALERTA DE 30 MINUTOS (BETA)
    // ============================================================
    // Verifica compromissos futuros
    const { data: futureApps } = await supabase.from('nodes')
        .select('*').eq('group', 'compromisso').gt('due_date', now.toISOString());

    if (futureApps) {
        for (const app of futureApps) {
            const appTime = parseISO(app.due_date);
            // Corrige fuso se necessário (depende de como salvou no banco)
            // Assumindo que o banco salva UTC e appTime vira objeto Date correto
            
            const diff = differenceInMinutes(appTime, now); // now já é -3h? Cuidado aqui.
            // Para evitar confusão de fuso no diff, usamos timestamps absolutos:
            // O "now" do getBrazilDate() é visualmente correto, mas o timestamp é deslocado.
            // Melhor comparar UTC com UTC para diff.
            
            const realNowUTC = new Date();
            const realAppTimeUTC = new Date(app.due_date); // Supabase devolve ISO UTC
            const realDiff = differenceInMinutes(realAppTimeUTC, realNowUTC);

            // Janela de 10 min para pegar o cron (entre 25 e 35 min antes)
            if (realDiff >= 25 && realDiff <= 35) {
                // Checa se já avisou (usando o campo content ou notes como flag seria ideal, 
                // mas por enquanto vamos confiar no intervalo curto)
                 
                // Opcional: Evitar duplo envio simples
                const alertLogId = `alert_${app.id}`;
                const { data: sent } = await supabase.from('nodes').select('id').eq('id', alertLogId).maybeSingle();
                
                if (!sent) {
                    const res = await sendWhatsAppMessage(`🚨 *CORRE!* "${app.label}" começa em 30 min!`);
                    logs.push(`Alerta (${app.label}): ${res}`);
                    // Marca que avisou
                    await supabase.from('nodes').insert([{ id: alertLogId, label: 'Alert Log', group: 'system_log' }]);
                }
            }
        }
    }

    return NextResponse.json({ status: "Executado (Brasil Time)", logs });
}