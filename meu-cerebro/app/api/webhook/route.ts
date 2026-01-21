import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { addDays, subDays, format, parseISO, isSameDay, subHours } from "date-fns";
import twilio from "twilio";

// --- CONFIGURAÇÃO ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const BOT_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; 

// --- FUNÇÕES AUXILIARES ---

function generateId() {
    // Gera um ID aleatório simples para não depender do banco
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getVirtualDate() {
  const now = new Date();
  const brazilTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
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
    if (!isoString) return false;
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

// --- API PRINCIPAL ---

export async function POST(req: Request) {
  let sender = ""; 
  
  try {
    const contentType = req.headers.get('content-type') || '';
    let message = "";

    if (contentType.includes('application/json')) {
        const body = await req.json();
        message = body.message;
        sender = "teste_local";
    } else {
        const formData = await req.formData();
        message = formData.get('Body') as string;
        sender = formData.get('From') as string;
    }

    if (!message) return NextResponse.json({ error: "Vazio" }, { status: 400 });

    const cleanMessage = message.trim();
    const firstWord = cleanMessage.split(" ")[0].toLowerCase();
    let responseText = "";
    
    const virtualDate = getVirtualDate();
    const virtualDateKey = format(virtualDate, "yyyy-MM-dd");

    // 0. COMANDO DE TESTE (PING)
    if (firstWord === "ping") {
        responseText = "🏓 Pong! O cérebro está online.";
    }

    // 1. AGENDAR
    else if (firstWord === "agendar") {
      const { targetDate, targetTime, title } = extractBookingDetails(message);
      if (targetDate && targetTime && title) {
        const dateStr = format(targetDate, "yyyy-MM-dd");
        
        await supabase.from('nodes').insert([{
          id: generateId(), 
          label: title, 
          due_date: `${dateStr}T${targetTime}:00`,
          group: 'compromisso',
          type: 'compromisso',
          color: '#000000',
          x: Math.random() * 100, 
          y: Math.random() * 100
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
        const { error } = await supabase.from('nodes').insert([{
            id: generateId(),
            label: `Check ${targetHabit.label}`, 
            group: 'habit_check', 
            type: 'habit_check',
            due_date: virtualDateKey, 
            content: targetHabit.id,
            x: 0, y: 0
        }]);
        if (!error) responseText = `🔥 Hábito "${targetHabit.label}" feito!`;
        else responseText = `⚠️ Erro: ${error.message}`;
      
      } else {
        const { data: apps } = await supabase.from('nodes').select('*').eq('group', 'compromisso');
        const todaysApps = apps?.filter(app => app.due_date && isSameDayBrazil(app.due_date, virtualDate)) || [];
        const targetApp = todaysApps.find(a => a.label.toLowerCase().includes(searchTerm));

        if (targetApp) {
            const { error } = await supabase.from('nodes').insert([{ 
                id: generateId(),
                label: 'App Done', 
                group: 'app_check',
                type: 'app_check', 
                content: targetApp.id,
                x: 0, y: 0
            }]);
            
            if(!error) responseText = `✅ Compromisso "${targetApp.label}" concluído!`;
            else responseText = `⚠️ Erro: ${error.message}`;
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
          responseText += "🎉 Dia Finalizado! Tudo feito.";
      } else {
          if (pendingH.length > 0) responseText += `⚠️ *Hábitos:*\n` + pendingH.map(h => `[ ] ${h.label}`).join("\n");
          if (pendingA.length > 0) {
              responseText += `\n📅 *Agenda:*\n` + pendingA.map(a => {
                  const dateUTC = parseISO(a.due_date);
                  const dateBR = subHours(dateUTC, 3);
                  return `[ ] ${a.label} (${format(dateBR, 'HH:mm')})`;
              }).join("\n");
          }
      }
    }

    // 4. DIÁRIO
    else if (["diário", "diario", "reflexão"].includes(firstWord)) {
        const content = message.substring(message.indexOf(" ") + 1);
        const { data: existing } = await supabase.from('nodes').select('id, content').eq('group', 'daily_log').eq('due_date', virtualDateKey).limit(1).maybeSingle();
        
        if (existing) {
            await supabase.from('nodes').update({ content: existing.content + "\n\n" + content }).eq('id', existing.id);
        } else {
            await supabase.from('nodes').insert([{ 
                id: generateId(),
                label: `Log`, content, 
                group: 'daily_log', type: 'daily_log',
                due_date: virtualDateKey, 
                color: '#fff', x:0, y:0 
            }]);
        }
        responseText = `📝 Salvo no diário.`;
    }

    // =========================================================================
    // 5. TÓPICOS (GRÁFICO NEURAL) - VERSÃO ANTI-TRAVAMENTO
    // =========================================================================
    else if (message.includes(">")) {
        const parts = message.split(">").map((p) => p.trim());
        
        if (parts.length >= 2) {
            const [catName, topicName, extraText] = parts; 
            
            // --- A: CATEGORIA ---
            let parentId = null;
            
            // BUSCA SEGURA: Pega uma lista (limit 1) em vez de exigir único
            const { data: categories, error: errSearchCat } = await supabase
                .from("nodes")
                .select("id")
                .ilike("label", catName)
                .eq("group", "category")
                .limit(1);

            if (errSearchCat) throw new Error(`Erro busca Categoria: ${errSearchCat.message}`);

            // Se achou pelo menos um, usa o primeiro.
            if (categories && categories.length > 0) {
                parentId = categories[0].id;
            } else {
                // Se não achou, cria.
                const { data: newCategory, error: errCat } = await supabase
                    .from("nodes")
                    .insert([{ 
                        id: generateId(),
                        label: catName, group: "category", type: "category",
                        color: "#ef4444", x: Math.random()*100, y: Math.random()*100
                    }])
                    .select()
                    .single();
                
                if (errCat) throw new Error(`Erro Criar Categoria: ${errCat.message}`);
                if (newCategory) parentId = newCategory.id;
            }

            // --- B: TÓPICO ---
            if (parentId && topicName) {
                // BUSCA SEGURA PARA O TÓPICO TAMBÉM
                const { data: topics, error: errSearchTop } = await supabase
                    .from("nodes")
                    .select("*")
                    .ilike("label", topicName)
                    .not("group", "eq", "category")
                    .limit(1);

                if (errSearchTop) throw new Error(`Erro busca Tópico: ${errSearchTop.message}`);

                const existingTopic = (topics && topics.length > 0) ? topics[0] : null;

                if (existingTopic) {
                    // Atualizar
                    const novoConteudo = existingTopic.content ? existingTopic.content + "\n" + (extraText || "") : (extraText || "");
                    const { error: errUp } = await supabase.from("nodes").update({ content: novoConteudo }).eq("id", existingTopic.id);
                    if (errUp) throw new Error(`Erro Update: ${errUp.message}`);
                    
                    responseText = `📝 Tópico "${topicName}" atualizado.`;

                    // Conexão Segura
                    const { error: errEdge } = await supabase.from('edges').insert({ source: parentId, target: existingTopic.id });
                    // Ignora erro se já existir conexão
                } else {
                    // Criar Novo
                    const { data: newTopic, error: errNew } = await supabase
                        .from("nodes")
                        .insert([{ 
                            id: generateId(), 
                            label: topicName, group: "topic", type: "topic",
                            content: extraText || "", 
                            color: "#6b7280", 
                            x: Math.random() * 100, y: Math.random() * 100
                        }])
                        .select()
                        .single();
                    
                    if (errNew) throw new Error(`Erro Criar Tópico: ${errNew.message}`);
                    
                    if (newTopic) {
                        const { error: errConn } = await supabase.from("edges").insert([{ source: parentId, target: newTopic.id }]);
                        if (errConn) await supabase.from("links").insert([{ source: parentId, target: newTopic.id }]);
                        
                        responseText = `🔗 Novo tópico: ${catName} > ${topicName}`;
                    }
                }
            }
        }
    }

    // --- ENVIAR RESPOSTA ---
    if (responseText && sender !== "teste_local" && BOT_NUMBER) {
        try {
            await twilioClient.messages.create({ from: BOT_NUMBER, to: sender, body: responseText });
        } catch (twilioError) {
            console.error("Erro Twilio:", twilioError);
        }
    }

    return NextResponse.json({ status: "OK", reply: responseText });

  } catch (error: any) {
    console.error("Erro Crítico:", error);
    if (sender && sender !== "teste_local" && BOT_NUMBER) {
         try {
            await twilioClient.messages.create({ 
                from: BOT_NUMBER, 
                to: sender, 
                body: `☠️ Erro no Cérebro: ${error.message}` 
            });
         } catch (e) { console.error("Falha ao enviar erro", e); }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}