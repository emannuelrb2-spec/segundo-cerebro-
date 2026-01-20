import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, subDays, format, parseISO, isSameDay, subHours } from "date-fns";
import twilio from "twilio";

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Configuração do Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BOT_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; 

// --- FUNÇÕES DE DATA (Fuso Horário Brasil) ---

function getVirtualDate() {
  const now = new Date();
  // Ajuste manual para Brasília (-3h)
  const brazilTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
  
  // Se for antes das 04:00 da manhã, conta como "ontem" (madrugada produtiva)
  if (brazilTime.getHours() < 4) {
      return subDays(brazilTime, 1);
  }
  return brazilTime;
}

function getRealBrazilDate() {
    const now = new Date();
    return new Date(now.getTime() - (3 * 60 * 60 * 1000));
}

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
  
  // Detecta "amanhã" ou data específica
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

  // Detecta horário
  const timeMatch = cleanText.match(/(\d{1,2})(?:h|:)(\d{2})?/);
  if (timeMatch) {
    targetTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2] || "00"}`;
    cleanText = cleanText.replace(timeMatch[0], "");
  }

  // Limpa o texto para pegar o título
  let title = cleanText.replace("agendar", "").replace(/\s(às|as|para|o|a)\s/g, " ").replace(/\s+/g, " ").trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { targetDate, targetTime, title };
}

// --- API ROUTE (POST) ---
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let message = "";
    let sender = "";
    let mediaUrl = null;

    // Processa JSON (Teste local) ou FormData (WhatsApp Real)
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
    
    const virtualDate = getVirtualDate();
    const virtualDateKey = format(virtualDate, "yyyy-MM-dd");

    // 1. AGENDAR
    if (firstWord === "agendar") {
      const { targetDate, targetTime, title } = extractBookingDetails(message);
      if (targetDate && targetTime && title) {
        const dateStr = format(targetDate, "yyyy-MM-dd");
        await supabase.from('nodes').insert([{
          label: title, // Removido ID manual para deixar o banco gerar UUID ou int
          due_date: `${dateStr}T${targetTime}:00`,
          group: 'compromisso', 
          color: '#000000',
          x: Math.random() * 100, y: Math.random() * 100
        }]);
        responseText = `✅ Agendado: "${title}"\n📅 ${format(targetDate, "dd/MM")} às ${targetTime}`;
      } else {
        responseText = "❌ Exemplo: 'Agendar amanhã 15h Dentista'";
      }
    }

    // 2. CHECK / FEITO
    else if (firstWord === "check" || firstWord === "feito") {
      const searchTerm = message.substring(message.indexOf(" ") + 1).toLowerCase();
      
      const { data: habits } = await supabase.from('nodes').select('*').eq('group', 'habit');
      const targetHabit = habits?.find(h => h.label.toLowerCase().includes(searchTerm));

      if (targetHabit) {
        const checkId = `check_${virtualDateKey}_${targetHabit.id}`; 
        const { error } = await supabase.from('nodes').insert([{
            label: `Check ${targetHabit.label}`, group: 'habit_check', 
            due_date: virtualDateKey, content: targetHabit.id,
            x: 0, y: 0
        }]);
        if (!error) responseText = `🔥 Hábito "${targetHabit.label}" feito!`;
        else responseText = `⚠️ Hábito "${targetHabit.label}" já estava feito.`;
      
      } else {
        const { data: apps } = await supabase.from('nodes').select('*').eq('group', 'compromisso');
        const todaysApps = apps?.filter(app => app.due_date && isSameDayBrazil(app.due_date, virtualDate)) || [];
        const targetApp = todaysApps.find(a => a.label.toLowerCase().includes(searchTerm));

        if (targetApp) {
            const { error } = await supabase.from('nodes').insert([{ 
                label: 'App Done', group: 'app_check', content: targetApp.id,
                x: 0, y: 0
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
                  const timeStr = format(dateBR, 'HH:mm');
                  return `[ ] ${a.label} (${timeStr})`;
              }).join("\n");
          }
      }
    }

    // 4. DIÁRIO
    else if (["diário", "diario", "reflexão"].includes(firstWord)) {
        const content = message.substring(message.indexOf(" ") + 1);
        const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', virtualDateKey).maybeSingle();
        
        if (existing) {
            await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
        } else {
            await supabase.from('nodes').insert([{ label: `Log`, content, group: 'daily_log', due_date: virtualDateKey, color: '#fff', x:0, y:0 }]);
        }
        responseText = `📝 Salvo no diário de ${format(virtualDate, 'dd/MM')}.`;
    }

    // =========================================================================
    // 5. TÓPICOS (GRÁFICO NEURAL) - CORRIGIDO PARA EVITAR DUPLICIDADE
    // =========================================================================
    else if (message.includes(">")) {
        const parts = message.split(">").map((p) => p.trim());
        
        if (parts.length >= 2) {
            const [catName, topicName, extraText] = parts; 
            
            // --- PASSO A: Resolver a Categoria (Pai) ---
            let parentId = null;

            // 1. Procura se JÁ EXISTE categoria com esse nome
            const { data: existingCategory } = await supabase
                .from("nodes")
                .select("id")
                .ilike("label", catName) // Case Insensitive ('Dia a dia' == 'dia a dia')
                .eq("group", "category")
                .maybeSingle();

            if (existingCategory) {
                // ACHEI! Uso o ID dela.
                parentId = existingCategory.id;
            } else {
                // NÃO ACHEI! Crio uma nova.
                const { data: newCategory } = await supabase
                    .from("nodes")
                    .insert([{ 
                        label: catName, 
                        group: "category", 
                        type: "category",
                        color: "#ef4444",
                        x: 0, y: 0
                    }])
                    .select()
                    .single();
                
                if (newCategory) parentId = newCategory.id;
            }

            // --- PASSO B: Resolver o Tópico (Filho) ---
            if (parentId && topicName) {
                // 1. Procura se JÁ EXISTE tópico com esse nome
                const { data: existingTopic } = await supabase
                    .from("nodes")
                    .select("*")
                    .ilike("label", topicName)
                    .not("group", "eq", "category") // Garante que não pega a categoria por engano
                    .maybeSingle();

                if (existingTopic) {
                    // CENÁRIO: JÁ EXISTE -> ATUALIZAR (Não criar bola nova)
                    // Adiciona o novo texto ao texto antigo
                    const novoConteudo = existingTopic.content 
                        ? existingTopic.content + "\n" + (extraText || "") 
                        : (extraText || "");

                    await supabase
                        .from("nodes")
                        .update({ content: novoConteudo })
                        .eq("id", existingTopic.id);
                        
                    responseText = `📝 Tópico "${topicName}" atualizado (Informação adicionada à bolinha existente).`;

                    // Garante que a conexão existe (caso o tópico existisse mas estivesse solto)
                    // Se sua tabela de conexões chamar 'links', troque 'edges' por 'links' abaixo
                    const { data: linkCheck } = await supabase.from('edges').select('*').eq('source', parentId).eq('target', existingTopic.id);
                    if (!linkCheck || linkCheck.length === 0) {
                         await supabase.from('edges').insert({ source: parentId, target: existingTopic.id });
                    }

                } else {
                    // CENÁRIO: NÃO EXISTE -> CRIAR NOVA BOLA
                    const { data: newTopic } = await supabase
                        .from("nodes")
                        .insert([{ 
                            label: topicName, 
                            group: "topic", 
                            content: extraText || "", 
                            image_url: mediaUrl, 
                            color: "#6b7280",
                            x: Math.random() * 100,
                            y: Math.random() * 100
                        }])
                        .select()
                        .single();
                    
                    if (newTopic) {
                        // Cria a conexão
                        // Se sua tabela chamar 'links', mude aqui para 'links'
                        await supabase.from("edges").insert([{ source: parentId, target: newTopic.id }]);
                        responseText = `🔗 Novo tópico criado: ${catName} > ${topicName}`;
                    }
                }
            }
        }
    }

    // --- ENVIAR RESPOSTA PARA WHATSAPP ---
    if (responseText && sender !== "teste_local" && BOT_NUMBER) {
        await twilioClient.messages.create({ from: BOT_NUMBER, to: sender, body: responseText });
    }

    return NextResponse.json({ status: "OK", reply: responseText });

  } catch (error: any) {
    console.error("Erro API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}