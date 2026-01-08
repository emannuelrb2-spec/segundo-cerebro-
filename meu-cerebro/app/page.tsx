"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js"; 
import { X, Image as ImageIcon, Plus, Trash2, Link as LinkIcon, Save, Palette, Maximize2, MousePointer2, Calendar as CalendarIcon, Clock, Activity, Edit3, TrendingUp, Check, ListChecks, Settings } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, isToday, subDays, startOfYear, endOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";

// --- CONFIGURAÇÃO ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function Home() {
  const [view, setView] = useState<"dashboard" | "neural">("dashboard");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Inputs
  const [newAppTitle, setNewAppTitle] = useState("");
  const [newAppDateOnly, setNewAppDateOnly] = useState(""); 
  const [newAppTimeOnly, setNewAppTimeOnly] = useState(""); 

  // Dados
  const [appointments, setAppointments] = useState<any[]>([]);
  const [habits, setHabits] = useState<any[]>([]);
  const [isHabitModalOpen, setIsHabitModalOpen] = useState(false);
  const [newHabitForm, setNewHabitForm] = useState({ col1: "", col2: "", col3: "", col4: "" });

  // Estados de Checks e Notas
  const [checkedHabits, setCheckedHabits] = useState<Record<string, boolean>>({});
  const [completedApps, setCompletedApps] = useState<Record<string, boolean>>({}); 
  const [dailyNotes, setDailyNotes] = useState<Record<string, string>>({});

  const [selectedDayDetails, setSelectedDayDetails] = useState<{date: Date, apps: any[]} | null>(null);
  const [editingNote, setEditingNote] = useState("");

  // --- CARREGAMENTO DE DADOS (AGORA COM CHECKS) ---
  useEffect(() => {
    fetchData(); 
    const channel = supabase.channel("realtime-everything")
        .on("postgres_changes", { event: "*", schema: "public", table: "*" }, fetchData)
        .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchData() {
    const { data: nodesData } = await supabase.from('nodes').select('*');
    if (nodesData) {
      const appNodes = nodesData.filter(n => n.group === 'compromisso');
      const habitNodes = nodesData.filter(n => n.group === 'habit');
      const logNodes = nodesData.filter(n => n.group === 'daily_log');
      const checkNodes = nodesData.filter(n => n.group === 'habit_check'); // Carrega os checks do banco
      const appCheckNodes = nodesData.filter(n => n.group === 'app_check'); // Carrega checks de compromisso

      // Dados do Neural (mantendo lógica anterior)
      const graphNodes = nodesData.filter(n => ['compromisso', 'daily_log', 'habit', 'habit_check', 'app_check'].indexOf(n.group) === -1);
      const { data: linksData } = await supabase.from('links').select('*');
      if(linksData) {
          setData({
            nodes: graphNodes.map(n => ({ ...n, val: Number(n.val) || 20, color: n.color || (n.group === 'category' ? '#ef4444' : '#6b7280') })), 
            links: linksData.map(l => ({ source: l.source, target: l.target }))
          });
      }

      setAppointments(appNodes.map(app => ({
        id: app.id, title: app.label, date: app.due_date ? parseISO(app.due_date) : new Date()
      })));

      setHabits(habitNodes.map(h => {
          try { return { id: h.id, ...JSON.parse(h.content || "{}") }; } catch(e) { return null; }
      }).filter(Boolean));

      // Reconstrói o estado visual dos Checks de Hábito
      const checksMap: Record<string, boolean> = {};
      checkNodes.forEach(c => {
          if(c.due_date && c.content) {
             const suffix = c.id.replace(`check_${c.due_date}_`, ''); 
             const visualKey = `${c.due_date}-${suffix}`;
             checksMap[visualKey] = true;
          }
      });
      setCheckedHabits(checksMap);

      // Reconstrói Checks de Compromisso
      const appChecksMap: Record<string, boolean> = {};
      appCheckNodes.forEach(c => {
          if(c.content) appChecksMap[c.content] = true; 
      });
      setCompletedApps(appChecksMap);

      // Notas
      const notesMap: Record<string, string> = {};
      logNodes.forEach(log => {
          if (log.due_date) {
              const dateKey = format(parseISO(log.due_date), 'yyyy-MM-dd');
              notesMap[dateKey] = log.content || "";
          }
      });
      setDailyNotes(notesMap);
    }
  }

  // --- FUNÇÕES DE TOGGLE COM PERSISTÊNCIA NO BANCO ---
  const toggleHabitCheck = async (date: Date, habitId: string, colIndex: number) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const visualKey = `${dateKey}-${habitId}-${colIndex}`;
    const isCheckedNow = !checkedHabits[visualKey]; 

    // 1. Atualiza Visualmente (Rápido)
    setCheckedHabits(prev => ({ ...prev, [visualKey]: isCheckedNow }));

    // 2. Atualiza no Banco
    const dbId = `check_${dateKey}_${habitId}_${colIndex}`; 
    
    if (isCheckedNow) {
        await supabase.from('nodes').insert([{
            id: dbId,
            label: 'Check',
            group: 'habit_check',
            due_date: dateKey,
            content: habitId 
        }]);
    } else {
        await supabase.from('nodes').delete().eq('id', dbId);
    }
  };

  const toggleAppCheck = async (appId: string) => {
    const isCheckedNow = !completedApps[appId];
    
    setCompletedApps(prev => ({ ...prev, [appId]: isCheckedNow }));

    const dbId = `appdone_${appId}`;
    if (isCheckedNow) {
        await supabase.from('nodes').insert([{
            id: dbId,
            label: 'App Done',
            group: 'app_check',
            content: appId 
        }]);
    } else {
        await supabase.from('nodes').delete().eq('id', dbId);
    }
  };

  // Drag do Dashboard
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isDraggingDash, setIsDraggingDash] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const handleMouseDownDash = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, button, textarea, .no-drag, .clickable-area')) return;
    setIsDraggingDash(true);
    if (dashboardRef.current) {
      setStartPos({
        x: e.pageX - dashboardRef.current.offsetLeft,
        y: e.pageY - dashboardRef.current.offsetTop,
        scrollLeft: dashboardRef.current.scrollLeft,
        scrollTop: dashboardRef.current.scrollTop
      });
    }
  };

  const handleMouseLeaveDash = () => setIsDraggingDash(false);
  const handleMouseUpDash = () => setIsDraggingDash(false);

  const handleMouseMoveDash = (e: React.MouseEvent) => {
    if (!isDraggingDash || !dashboardRef.current) return;
    e.preventDefault();
    const x = e.pageX - dashboardRef.current.offsetLeft;
    const y = e.pageY - dashboardRef.current.offsetTop;
    const walkX = (x - startPos.x) * 1.5; 
    const walkY = (y - startPos.y) * 1.5; 
    dashboardRef.current.scrollLeft = startPos.scrollLeft - walkX;
    dashboardRef.current.scrollTop = startPos.scrollTop - walkY;
  };

  const today = new Date();
  const startOfCurrentWeek = startOfWeek(today, { weekStartsOn: 1 }); 
  const weekDays = Array.from({ length: 5 }).map((_, i) => {
    const day = new Date(startOfCurrentWeek);
    day.setDate(day.getDate() + i);
    return day;
  });

  const graphDays = eachDayOfInterval({ start: startOfYear(today), end: endOfYear(today) });

  const scrollGraphToToday = useCallback((node: HTMLDivElement | null) => {
    if (node) {
        const dayOfYear = Math.floor((today.getTime() - startOfYear(today).getTime()) / 86400000);
        node.scrollLeft = (dayOfYear * 52) - 300; 
    }
  }, []);

  const calculateDailyScore = (date: Date) => {
    const dateKeyPrefix = format(date, 'yyyy-MM-dd');
    const dayApps = appointments.filter(a => isSameDay(a.date, date));
    const totalHabitsPoints = habits.length * 4; 
    const totalApps = dayApps.length;
    const totalTasks = totalHabitsPoints + totalApps;

    if (totalTasks === 0) return 0;

    let habitsDone = 0;
    habits.forEach(h => {
        for (let i = 0; i < 4; i++) {
            if (checkedHabits[`${dateKeyPrefix}-${h.id}-${i}`]) habitsDone++;
        }
    });

    let appsDone = 0;
    dayApps.forEach(a => {
        if (completedApps[a.id]) appsDone++;
    });

    const totalDone = habitsDone + appsDone;
    return Math.round((totalDone / totalTasks) * 100);
  };

  // ==========================================
  // 2. LÓGICA DO NEURAL & GERAL (MANTIDA IGUAL)
  // ==========================================
  const graphRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState({ nodes: [] as any[], links: [] as any[] });
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLinkingMode, setIsLinkingMode] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [winState, setWinState] = useState({ x: 50, y: 50, w: 450, h: 600 });
  const [dragMode, setDragMode] = useState<null | 'move' | 'resize'>(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, winX: 0, winY: 0, winW: 0, winH: 0 });

  useEffect(() => {
    if (view === 'neural' && graphRef.current) {
        setTimeout(() => {
            if(graphRef.current) {
                graphRef.current.d3Force('charge').strength(-400); 
                graphRef.current.d3Force('link').distance(100);
            }
        }, 500);
    }
  }, [data, view]);

  // --- CRUD HÁBITOS ---
  const handleAddHabit = async () => {
      if(!newHabitForm.col1) return alert("Dê um nome ao hábito!");
      
      const newHabitData = {
          col1: newHabitForm.col1,
          col2: newHabitForm.col2 || "-",
          col3: newHabitForm.col3 || "-",
          col4: newHabitForm.col4 || "-"
      };

      const { error } = await supabase.from('nodes').insert([{
          id: `habit_${Date.now()}`,
          label: newHabitForm.col1,
          content: JSON.stringify(newHabitData), 
          group: 'habit',
          color: '#ffffff'
      }]);

      if(!error) {
          setNewHabitForm({ col1: "", col2: "", col3: "", col4: "" });
          fetchData();
      }
  };

  const handleDeleteHabit = async (id: string) => {
      if(!confirm("Excluir este hábito?")) return;
      await supabase.from('nodes').delete().eq('id', id);
      fetchData();
  };

  // --- CRUD COMPROMISSOS ---
  const handleAddAppointment = async () => {
    if (!newAppTitle || !newAppDateOnly || !newAppTimeOnly) return alert("Preencha tudo.");
    const combinedDateTime = `${newAppDateOnly}T${newAppTimeOnly}:00`;
    const { error } = await supabase.from('nodes').insert([{
        id: Date.now().toString(), label: newAppTitle, due_date: combinedDateTime, group: 'compromisso', color: '#000000'
    }]);
    if (!error) { setNewAppTitle(""); setNewAppDateOnly(""); setNewAppTimeOnly(""); fetchData(); }
  };

  const handleDeleteAppointment = async (id: string) => {
    if(!confirm("Apagar?")) return;
    await supabase.from('nodes').delete().eq('id', id);
    if (selectedDayDetails) {
        const updatedApps = selectedDayDetails.apps.filter(app => app.id !== id);
        setSelectedDayDetails({ ...selectedDayDetails, apps: updatedApps });
    }
    fetchData();
  };

  const handleSaveDailyNote = async () => {
      if (!selectedDayDetails) return;
      const dateKey = format(selectedDayDetails.date, 'yyyy-MM-dd');
      const { data: existing } = await supabase.from('nodes').select('id').eq('group', 'daily_log').eq('due_date', dateKey).maybeSingle();
      if (existing) await supabase.from('nodes').update({ content: editingNote }).eq('id', existing.id);
      else await supabase.from('nodes').insert([{ id: `log_${dateKey}_${Date.now()}`, label: `Log ${dateKey}`, content: editingNote, group: 'daily_log', due_date: dateKey, color: '#ffffff' }]);
      setDailyNotes(prev => ({ ...prev, [dateKey]: editingNote }));
      alert("Frase salva com sucesso!");
  };

  const openDayDetails = (date: Date) => {
      const apps = appointments.filter(app => isSameDay(app.date, date));
      const note = dailyNotes[format(date, 'yyyy-MM-dd')] || "";
      setEditingNote(note);
      setSelectedDayDetails({ date, apps });
  };

  const generateCalendarDays = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: startDate, end: endDate });
  };

  // --- NEURAL HELPERS ---
  const handleLinkToggle = async (t: any) => { if (!selectedNode || t.id === selectedNode.id) return; const { data: e } = await supabase.from('links').select('*').or(`and(source.eq.${selectedNode.id},target.eq.${t.id}),and(source.eq.${t.id},target.eq.${selectedNode.id})`).maybeSingle(); if (e) await supabase.from('links').delete().match({ source: e.source, target: e.target }); else await supabase.from('links').insert([{ source: selectedNode.id, target: t.id }]); setIsLinkingMode(false); fetchData(); };
  const addNewNode = async () => { const n = prompt("Novo Nó:"); if (!n) return; const id = n.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now(); await supabase.from('nodes').insert([{ id, label: n, val: selectedNode ? 10 : 25, color: selectedNode ? "#9ca3af" : "#4b5563" }]); if (selectedNode) await supabase.from('links').insert([{ source: selectedNode.id, target: id }]); fetchData(); };
  const handleSave = async () => { if (!selectedNode) return; setData({...data}); await supabase.from('nodes').update({ label: selectedNode.label, notes: noteContent, content: noteContent, color: selectedNode.color }).eq('id', selectedNode.id); };
  const deleteNode = async () => { if(confirm("Deletar?")) { await supabase.from('nodes').delete().eq('id', selectedNode.id); setSelectedNode(null); }};
  const handleColorChange = async (e: any) => { if(selectedNode) { selectedNode.color = e.target.value; setData({...data}); await supabase.from('nodes').update({ color: e.target.value }).eq('id', selectedNode.id); }};
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file && selectedNode) { const r = new FileReader(); r.onload = async (event) => { const imgUrl = event.target?.result as string; const newImages = [...(selectedNode.images || []), imgUrl]; selectedNode.images = newImages; setData({...data}); await supabase.from('nodes').update({ images: newImages }).eq('id', selectedNode.id); }; r.readAsDataURL(file); } };
  const handleDeleteImage = async (imgUrl: string) => { if (!selectedNode) return; if(confirm("Remover?")) { const newImages = selectedNode.images.filter((i: string) => i !== imgUrl); selectedNode.images = newImages; setData({...data}); await supabase.from('nodes').update({ images: newImages }).eq('id', selectedNode.id); } };
  const triggerColorPicker = () => { colorInputRef.current?.click(); };

  useEffect(() => { const hM = (e: MouseEvent) => { if (!dragMode) return; e.preventDefault(); const dX = e.clientX - dragStart.current.mouseX, dY = e.clientY - dragStart.current.mouseY; if (dragMode === 'move') setWinState(p => ({ ...p, x: dragStart.current.winX + dX, y: dragStart.current.winY + dY })); else setWinState(p => ({ ...p, w: Math.max(300, dragStart.current.winW + dX), h: Math.max(300, dragStart.current.winH + dY) })); }; const hU = () => { setDragMode(null); document.body.style.cursor = 'default'; }; if (dragMode) { window.addEventListener('mousemove', hM); window.addEventListener('mouseup', hU); } return () => { window.removeEventListener('mousemove', hM); window.removeEventListener('mouseup', hU); }; }, [dragMode]);
  const startMove = (e: React.MouseEvent) => { setDragMode('move'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };
  const startResize = (e: React.MouseEvent) => { e.stopPropagation(); setDragMode('resize'); dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: winState.x, winY: winState.y, winW: winState.w, winH: winState.h }; };
  const handleNodeClick = useCallback((n: any) => { if (isLinkingMode) handleLinkToggle(n); else { graphRef.current?.centerAt(n.x, n.y, 1000); graphRef.current?.zoom(3, 2000); setSelectedNode(n); setNoteContent(n.content || n.notes || ""); } }, [selectedNode, isLinkingMode]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'white', fontFamily: 'sans-serif', color: 'black' }}>
      
      {/* MENU SUPERIOR */}
      <div style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 50, display: 'flex', gap: '16px' }}>
         <div style={{ display: 'flex' }}>
            <button onClick={() => setView('dashboard')} style={{ padding: '8px 16px', border: '1px solid black', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: view === 'dashboard' ? 'black' : 'white', color: view === 'dashboard' ? 'white' : 'black', cursor: 'pointer' }}>Painel</button>
            <button onClick={() => setView('neural')} style={{ padding: '8px 16px', border: '1px solid black', borderLeft: 'none', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: view === 'neural' ? 'black' : 'white', color: view === 'neural' ? 'white' : 'black', cursor: 'pointer' }}>Neural</button>
         </div>
         {/* BOTÃO GERENCIAR HÁBITOS */}
         {view === 'dashboard' && (
             <button onClick={() => setIsHabitModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', border: '1px solid black', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: 'white', cursor: 'pointer' }}>
                 <Settings size={14} /> Configurar Hábitos
             </button>
         )}
      </div>

      {/* MODAL GERENCIAR HÁBITOS */}
      {isHabitModalOpen && (
          <div className="no-drag" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsHabitModalOpen(false)}>
              <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '16px', width: '600px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                      <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>Gerenciar Hábitos</h2>
                      <button onClick={() => setIsHabitModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><X /></button>
                  </div>

                  {/* FORM ADD HÁBITO */}
                  <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
                      <h3 style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '12px', color: '#666' }}>ADICIONAR NOVO</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                          <input placeholder="Hábito (Ex: Leitura)" value={newHabitForm.col1} onChange={e => setNewHabitForm({...newHabitForm, col1: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                          <input placeholder="Gatilho (Ex: Deitar)" value={newHabitForm.col2} onChange={e => setNewHabitForm({...newHabitForm, col2: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                          <input placeholder="Recompensa (Ex: Sono)" value={newHabitForm.col3} onChange={e => setNewHabitForm({...newHabitForm, col3: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                          <input placeholder="Fácil (Ex: 1 pág)" value={newHabitForm.col4} onChange={e => setNewHabitForm({...newHabitForm, col4: e.target.value})} style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                      </div>
                      <button onClick={handleAddHabit} style={{ width: '100%', backgroundColor: 'black', color: 'white', padding: '8px', borderRadius: '4px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>Salvar Hábito</button>
                  </div>

                  {/* LISTA HÁBITOS */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {habits.map(h => (
                          <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid #eee', borderRadius: '8px' }}>
                              <div>
                                  <div style={{ fontWeight: 'bold' }}>{h.col1}</div>
                                  <div style={{ fontSize: '12px', color: '#666' }}>{h.col2} • {h.col3} • {h.col4}</div>
                              </div>
                              <button onClick={() => handleDeleteHabit(h.id)} style={{ color: 'red', border: 'none', background: 'transparent', cursor: 'pointer' }}><Trash2 size={16} /></button>
                          </div>
                      ))}
                      {habits.length === 0 && <p style={{ textAlign: 'center', color: '#999' }}>Nenhum hábito cadastrado.</p>}
                  </div>
              </div>
          </div>
      )}

      {/* --- DASHBOARD --- */}
      {view === 'dashboard' && (
        <div 
          ref={dashboardRef}
          onMouseDown={handleMouseDownDash}
          onMouseLeave={handleMouseLeaveDash}
          onMouseUp={handleMouseUpDash}
          onMouseMove={handleMouseMoveDash}
          style={{ height: '100%', width: '100%', backgroundColor: 'white', display: 'flex', overflow: 'auto', cursor: isDraggingDash ? 'grabbing' : 'grab', userSelect: 'none' }}
        >
          {/* MODAL DETALHES DO DIA */}
          {selectedDayDetails && (
            <div className="no-drag" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSelectedDayDetails(null)}>
                <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '24px', width: '500px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: '24px' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '16px' }}>
                        <div>
                            <h3 style={{ fontSize: '24px', fontWeight: 'bold', textTransform: 'capitalize' }}>{format(selectedDayDetails.date, "EEEE, dd", { locale: ptBR })}</h3>
                            <p style={{ fontSize: '14px', color: '#666' }}>{format(selectedDayDetails.date, "MMMM yyyy", { locale: ptBR })}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '28px', fontWeight: 'bold', color: calculateDailyScore(selectedDayDetails.date) === 100 ? '#16a34a' : 'black' }}>
                                {calculateDailyScore(selectedDayDetails.date)}%
                            </div>
                            <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#999', fontWeight: 'bold' }}>Desempenho</span>
                        </div>
                    </div>

                    {/* SEÇÃO HÁBITOS CONCLUÍDOS */}
                    <div>
                        <h4 style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <ListChecks size={14}/> Hábitos (Realizados)
                        </h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {habits.map(habit => {
                                const dateKeyPrefix = format(selectedDayDetails.date, 'yyyy-MM-dd');
                                const isDone = [0,1,2,3].some(i => checkedHabits[`${dateKeyPrefix}-${habit.id}-${i}`]);
                                return (
                                    <div key={habit.id} style={{ 
                                        padding: '8px 12px', borderRadius: '8px', 
                                        backgroundColor: isDone ? 'black' : '#f3f4f6', 
                                        color: isDone ? 'white' : '#9ca3af',
                                        fontSize: '12px', fontWeight: 'bold',
                                        textDecoration: isDone ? 'none' : 'line-through'
                                    }}>
                                        {habit.col1}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* SEÇÃO COMPROMISSOS */}
                    <div>
                        <h4 style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#999', marginBottom: '12px' }}>Compromissos</h4>
                        {selectedDayDetails.apps.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {selectedDayDetails.apps.map(app => {
                                    const isDone = completedApps[app.id];
                                    return (
                                    <div key={app.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f9fafb', padding: '12px', borderRadius: '12px', border: isDone ? '1px solid black' : '1px solid #eee' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '14px', textDecoration: isDone ? 'line-through' : 'none' }}>{app.title}</div>
                                            <div style={{ fontSize: '12px', color: '#666' }}>{format(app.date, 'HH:mm')}</div>
                                        </div>
                                        <button onClick={() => handleDeleteAppointment(app.id)} style={{ background: 'white', border: '1px solid #fee2e2', borderRadius: '8px', padding: '8px', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                    </div>
                                    )
                                })}
                            </div>
                        ) : <p style={{ color: '#ccc', fontStyle: 'italic', fontSize: '14px' }}>Livre</p>}
                    </div>

                    {/* SEÇÃO DIÁRIO */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h4 style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#999' }}>Diário / Frase do Dia</h4>
                            <Edit3 size={14} color="#999"/>
                        </div>
                        <textarea value={editingNote} onChange={(e) => setEditingNote(e.target.value)} placeholder="Como foi o seu dia? O que te tocou?" style={{ width: '100%', height: '120px', padding: '16px', borderRadius: '16px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', fontSize: '14px', resize: 'none', outline: 'none', lineHeight: '1.5' }} />
                        <button onClick={handleSaveDailyNote} style={{ marginTop: '12px', width: '100%', backgroundColor: 'black', color: 'white', padding: '12px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>Salvar Diário</button>
                    </div>
                </div>
            </div>
          )}

          {/* COLUNA ESQUERDA: FORM + CALENDÁRIO */}
          <div className="no-drag" style={{ width: '380px', backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb', padding: '80px 24px 24px 24px', display: 'flex', flexDirection: 'column', gap: '32px', flexShrink: 0, minHeight: '100vh' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #e5e7eb', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Novo Compromisso</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <input type="text" value={newAppTitle} onChange={(e) => setNewAppTitle(e.target.value)} placeholder="Ex: Reunião" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', backgroundColor: 'white', color: 'black' }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d1d5db', borderRadius: '8px', padding: '10px', backgroundColor: 'white' }}><CalendarIcon size={16} color="#6b7280" /><input type="date" value={newAppDateOnly} onChange={(e) => setNewAppDateOnly(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', width: '100%', color: '#374151', backgroundColor: 'transparent', cursor: 'pointer' }} /></div>
                            <div style={{ width: '100px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d1d5db', borderRadius: '8px', padding: '10px', backgroundColor: 'white' }}><Clock size={16} color="#6b7280" /><input type="time" value={newAppTimeOnly} onChange={(e) => setNewAppTimeOnly(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', width: '100%', color: '#374151', backgroundColor: 'transparent', cursor: 'pointer' }} /></div>
                        </div>
                        <button onClick={handleAddAppointment} style={{ marginTop: '8px', width: '100%', backgroundColor: 'black', color: 'white', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>Agendar</button>
                    </div>
                </div>
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold' }}>&lt;</button>
                        <h2 style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'capitalize' }}>{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</h2>
                        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold' }}>&gt;</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '12px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '8px' }}>{['D','S','T','Q','Q','S','S'].map(d => <div key={d}>{d}</div>)}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', justifyItems: 'center' }}>
                        {generateCalendarDays().map((day, idx) => {
                            const hasEvent = appointments.some(app => isSameDay(app.date, day));
                            const isCurrentDay = isToday(day);
                            return (
                                <div key={idx} className="clickable-area" onClick={() => openDayDetails(day)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', borderRadius: '50%', backgroundColor: hasEvent ? 'black' : (isCurrentDay ? '#e5e7eb' : 'transparent'), color: hasEvent ? 'white' : (isSameMonth(day, currentMonth) ? 'black' : '#d1d5db'), fontWeight: hasEvent || isCurrentDay ? 'bold' : 'normal', cursor: 'pointer', transition: 'transform 0.1s' }} onMouseDown={(e) => (e.currentTarget as HTMLElement).style.transform = "scale(0.9)"} onMouseUp={(e) => (e.currentTarget as HTMLElement).style.transform = "scale(1)"}>{format(day, 'd')}</div>
                            )
                        })}
                    </div>
                </div>
                {/* ÁREA DE TESTE WHATSAPP */}
                <div style={{ marginTop: 'auto' }}> <details style={{ backgroundColor: '#25D366', padding: '10px', borderRadius: '10px', color: 'white' }}> <summary style={{ fontWeight: 'bold', cursor: 'pointer' }}>Testar Bot 🤖</summary> <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}> <input id="wa-input" type="text" placeholder="Digite: Status" style={{ padding: '5px', color: 'black', borderRadius: '4px', border: 'none' }} /> <button onClick={async () => { const msg = (document.getElementById('wa-input') as HTMLInputElement).value; const res = await fetch('/api/whatsapp', { method: 'POST', body: JSON.stringify({ message: msg }) }); const json = await res.json(); alert("🤖 Bot respondeu:\n\n" + json.reply); window.location.reload(); }} style={{ backgroundColor: 'white', color: '#25D366', border: 'none', padding: '5px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px' }}>ENVIAR</button> </div> </details> </div>
            </div>
          </div>

          {/* COLUNA DIREITA: PAINEL + GRÁFICO EXPANDIDO */}
          <div style={{ flex: 1, padding: '80px 48px 48px 48px', backgroundColor: 'white', display: 'flex', flexDirection: 'column', minWidth: '1600px', gap: '64px' }}>
            
            {/* PAINEL SEMANAL */}
            <div>
                <h1 style={{ fontSize: '30px', fontWeight: 'bold', marginBottom: '32px', paddingLeft: '8px' }}>Painel Geral</h1>
                <div style={{ display: 'flex', gap: '48px', width: 'max-content', paddingBottom: '32px' }}>
                {weekDays.map((day, index) => {
                    const dayAppointments = appointments.filter(app => isSameDay(app.date, day));
                    return (
                    <div key={index} className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '420px', flexShrink: 0 }}>
                    <h2 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '20px', textTransform: 'capitalize' }}>{format(day, 'EEEE dd/MM', { locale: ptBR })}</h2>
                    
                    {/* CARD HÁBITOS */}
                    <div style={{ backgroundColor: '#D9D9D9', borderRadius: '32px', padding: '24px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', lineHeight: '1.25', marginBottom: '12px', textTransform: 'uppercase', opacity: 0.7 }}><div>Hábito</div><div>Deixa</div><div>Recompensa</div><div>Fácil</div></div>
                        <div style={{ width: '100%', height: '1px', backgroundColor: 'rgba(0,0,0,0.2)', marginBottom: '16px' }}></div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {habits.map((habit, i) => {
                            const dateKeyPrefix = format(day, 'yyyy-MM-dd');
                            return (
                            <div key={i}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center', alignItems: 'flex-start' }}>
                                {[habit.col1, habit.col2, habit.col3, habit.col4].map((text, colIdx) => {
                                    const checkKey = `${dateKeyPrefix}-${habit.id}-${colIdx}`;
                                    const isChecked = checkedHabits[checkKey];
                                    return (
                                        <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', height: '100%', gap: '12px' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 'bold', lineHeight: '1.25', textDecoration: isChecked ? 'line-through' : 'none', color: isChecked ? '#666' : 'black' }}>{text}</span>
                                            <div 
                                                className="clickable-area"
                                                onClick={(e) => { e.stopPropagation(); toggleHabitCheck(day, habit.id, colIdx); }} 
                                                style={{ width: '20px', height: '20px', border: '1px solid black', borderRadius: '4px', cursor: 'pointer', backgroundColor: isChecked ? 'black' : 'transparent', flexShrink: 0, zIndex: 10 }}
                                            ></div>
                                        </div>
                                    )
                                })}
                            </div>
                            {i < habits.length - 1 && (<div style={{ width: '100%', height: '1px', backgroundColor: 'rgba(0,0,0,0.1)', marginTop: '16px' }}></div>)}
                            </div>
                        )})}
                        {habits.length === 0 && <p style={{ textAlign: 'center', color: '#666', fontStyle: 'italic', fontSize: '12px' }}>Nenhum hábito configurado.</p>}
                        </div>
                    </div>

                    {/* CARD COMPROMISSOS */}
                    <div style={{ backgroundColor: '#D9D9D9', borderRadius: '32px', padding: '24px', flex: 1, minHeight: '220px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14px', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Compromissos</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 8px' }}>
                        {dayAppointments.length > 0 ? (
                            dayAppointments.map((app) => {
                                const isAppDone = completedApps[app.id];
                                return (
                                <div key={app.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 'bold', fontStyle: 'italic', textDecoration: isAppDone ? 'line-through' : 'none', color: isAppDone ? '#666' : 'black' }}>
                                        {app.title} <span style={{fontSize: '12px', fontWeight: 'normal', color: '#666'}}>({format(app.date, 'HH:mm')})</span>
                                    </span>
                                    <div 
                                        className="clickable-area"
                                        onClick={(e) => { e.stopPropagation(); toggleAppCheck(app.id); }}
                                        style={{ width: '20px', height: '20px', border: '1px solid black', borderRadius: '4px', backgroundColor: isAppDone ? 'black' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        {isAppDone && <Check size={12} color="white" />}
                                    </div>
                                </div>
                                )
                            })
                        ) : (<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#666', fontStyle: 'italic' }}>Livre</div>)}
                        </div>
                    </div>
                    </div>
                )})}
                </div>
            </div>

            {/* SEÇÃO 2: GRÁFICO (ANO INTEIRO) */}
            <div className="no-drag" style={{ paddingRight: '48px', width: '100%' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}><TrendingUp /> Seu Desempenho (Ano Todo)</h2>
                
                <div 
                    className="clickable-area" 
                    ref={scrollGraphToToday}
                    style={{ overflowX: 'auto', paddingBottom: '24px', maxWidth: '100%' }}
                >
                    <div style={{ height: '250px', display: 'flex', alignItems: 'flex-end', gap: '24px', position: 'relative', width: 'max-content', paddingRight: '48px' }}>
                        
                        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px dashed #e5e7eb', zIndex: 0 }}></div>

                        {graphDays.map((d, i) => {
                            const score = calculateDailyScore(d);
                            const isTodayDay = isToday(d);
                            return (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', zIndex: 2, position: 'relative', height: '100%', justifyContent: 'flex-end', minWidth: '40px' }}>
                                    {isTodayDay && <div style={{ fontSize: '10px', color: 'red', fontWeight: 'bold' }}>HOJE</div>}
                                    <div 
                                        className="clickable-area"
                                        onClick={(e) => { e.stopPropagation(); openDayDetails(d); }}
                                        style={{ 
                                            width: '40px', height: '40px', borderRadius: '50%', 
                                            backgroundColor: score === 100 ? 'black' : (score > 0 ? '#666' : 'white'), 
                                            border: isTodayDay ? '2px solid red' : '2px solid black',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: score === 100 || score > 0 ? 'white' : 'black',
                                            fontWeight: 'bold', fontSize: '10px',
                                            cursor: 'pointer',
                                            marginBottom: (score * 2) + 'px', 
                                            transition: 'all 0.3s ease',
                                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                                        }}
                                    >
                                        {score}%
                                    </div>
                                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: isTodayDay ? 'red' : '#6b7280', whiteSpace: 'nowrap' }}>{format(d, 'dd/MM')}</div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

          </div>
        </div>
      )}

      {/* --- NEURAL (ACERVO) --- */}
      {view === 'neural' && (
        <main style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#F3F4F6', overflow: 'hidden' }}>
          {expandedImage && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setExpandedImage(null)}>
                <button onClick={() => setExpandedImage(null)} style={{ position: 'absolute', top: '32px', right: '32px', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}><X size={48} /></button>
                <img src={expandedImage} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: '8px' }} />
            </div>
          )}
          {isLinkingMode && <div style={{ position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#2563eb', color: 'white', padding: '8px 24px', borderRadius: '9999px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', zIndex: 50, display: 'flex', alignItems: 'center', gap: '8px' }}><LinkIcon size={16}/> Modo Conexão</div>}
          <div style={{ position: 'absolute', inset: 0 }}>
            <ForceGraph2D ref={graphRef} graphData={data} nodeLabel="label" nodeColor={(node: any) => isLinkingMode ? "#3b82f6" : node.color} nodeRelSize={6} linkColor={() => "#d1d5db"} backgroundColor="#F3F4F6" onNodeClick={handleNodeClick} />
          </div>
          {!selectedNode && <button onClick={addNewNode} style={{ position: 'absolute', bottom: '32px', right: '32px', backgroundColor: 'black', color: 'white', padding: '16px', borderRadius: '9999px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', border: 'none' }}><Plus size={24} /> <span style={{ fontWeight: 'bold', paddingRight: '8px' }}>Nova Categoria</span></button>}
          {selectedNode && (
            <div style={{ position: 'absolute', left: winState.x, top: winState.y, width: winState.w, height: winState.h, backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', borderRadius: '12px', border: '1px solid #d1d5db', display: 'flex', flexDirection: 'column', zIndex: 50, overflow: 'hidden', color: 'black' }}>
              <div onMouseDown={startMove} style={{ height: '48px', backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', cursor: 'move', userSelect: 'none' }}>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '8px' }}><MousePointer2 size={14} /> {selectedNode.label || selectedNode.name}</div>
                <button onClick={() => { setSelectedNode(null); setIsLinkingMode(false); }} style={{ padding: '4px', cursor: 'pointer', border: 'none', background: 'transparent' }}><X size={20} /></button>
              </div>
              <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <input type="text" value={selectedNode.label || selectedNode.name} onChange={(e) => {selectedNode.label = e.target.value; setData({...data})}} style={{ fontSize: '24px', fontWeight: 'bold', width: '100%', background: 'transparent', border: 'none', outline: 'none', marginBottom: '16px', color: '#1f2937', borderBottom: '1px solid transparent' }} />
                <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} style={{ flex: 1, width: '100%', backgroundColor: 'rgba(249, 250, 251, 0.5)', padding: '16px', borderRadius: '8px', outline: 'none', color: '#374151', resize: 'none', lineHeight: '1.6', border: '1px solid #f3f4f6' }} placeholder="Escreva suas anotações aqui..." />
                {selectedNode.image_url && (<div style={{ marginTop: '16px', flexShrink: 0 }}><p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Anexo:</p><div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb', maxHeight: '160px' }}><img src={selectedNode.image_url} style={{ width: '100%', objectFit: 'cover' }} /></div></div>)}
                {selectedNode.images && selectedNode.images.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px', flexShrink: 0 }}>
                        {selectedNode.images.map((img: string, idx: number) => (
                             <div key={idx} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid #f3f4f6', height: '100px', backgroundColor: '#f9fafb' }}>
                                <img src={img} onClick={() => setExpandedImage(img)} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} title="Clique para expandir" />
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteImage(img); }} style={{ position: 'absolute', top: '4px', right: '4px', backgroundColor: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', color: '#dc2626', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} title="Remover imagem"><Trash2 size={14} /></button>
                             </div>
                        ))}
                    </div>
                )}
              </div>
              <div style={{ padding: '8px', borderTop: '1px solid #f3f4f6', backgroundColor: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={triggerColorPicker} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer' }}><Palette size={16} /></button>
                    <input ref={colorInputRef} type="color" onChange={handleColorChange} style={{ display: 'none' }} />
                    <button id="save-btn" onClick={handleSave} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer' }}><Save size={16} /></button>
                    <button onClick={addNewNode} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer' }}><Plus size={16} /></button>
                    <button onClick={() => setIsLinkingMode(true)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer', backgroundColor: isLinkingMode ? '#2563eb' : 'transparent', color: isLinkingMode ? 'white' : 'black' }}><LinkIcon size={16} /></button>
                    <button onClick={deleteNode} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer', color: '#dc2626' }}><Trash2 size={16} /></button>
                    <label style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', cursor: 'pointer', color: '#2563eb' }} title="Adicionar Imagem"><ImageIcon size={16} /><input type="file" style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} /></label>
                </div>
                <div onMouseDown={startResize} style={{ cursor: 'nwse-resize', padding: '8px', color: '#9ca3af' }}><Maximize2 size={16} /></div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}