import React, { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { createClient } from "@supabase/supabase-js";

// --- Gastos — MVP (React) ---
// Enforce canonical domain so magic links siempre vuelvan al dominio correcto
const CANONICAL_HOST = "gastos-mvp.vercel.app";
if (typeof window !== "undefined" && window.location.host !== CANONICAL_HOST) {
  window.location.href = `https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// Offline-first (localStorage) + Sync manual en Supabase. Gráficos por categoría y por día.

const SUPABASE_URL = "https://qugnkfjbfqcihummbaal.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1Z25rZmpiZnFjaWh1bW1iYWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NDU5NzQsImV4cCI6MjA3NzUyMTk3NH0.b6etAkGNHkCPE5rUulXNuw36vHFAm_kv1_pVopc_c14";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// Helper: dominio actual (para debug)
console.debug("Host actual:", typeof window !== 'undefined' ? window.location.host : '(SSR)');

// Helpers
const LS_KEY = "gastos_mvp_v1";
const fmt = (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(Number(n || 0));
const todayISO = () => new Date().toISOString().slice(0, 10);
const toMonthKey = (d) => (d || todayISO()).slice(0, 7); // YYYY-MM

function useLocalState(defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(state)); }, [state]);
  return [state, setState];
}

// ---- Supabase helpers (snapshot por usuario)
async function signInWithMagic(email) {
  if (!email) return alert("Ingresá un email válido");
  const redirectTo = window?.location?.origin || "https://example.com"; // vuelve a esta misma app
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) alert(error.message); else alert("Revisá tu email para iniciar sesión");
}

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function pullRemote(userId) {
  const { data, error } = await sb.from("gastos_snapshots").select("payload").eq("user_id", userId).single();
  if (error && error.code !== "PGRST116") { // not found está ok
    alert("Pull error: " + error.message);
    return null;
  }
  return data?.payload || null;
}

async function pushRemote(userId, payload) {
  const { error } = await sb.from("gastos_snapshots").upsert({ user_id: userId, payload, updated_at: new Date().toISOString() });
  if (error) alert("Push error: " + error.message);
}

// === Registrar Service Worker (PWA) ===
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

function InstallPromptButton(){
  const [canInstall, setCanInstall] = React.useState(false);
  const deferredRef = React.useRef(null);
  React.useEffect(()=>{
    const h = (e)=>{ e.preventDefault(); deferredRef.current = e; setCanInstall(true); };
    window.addEventListener("beforeinstallprompt", h);
    return ()=> window.removeEventListener("beforeinstallprompt", h);
  },[]);
  if(!canInstall) return null;
  return (
    <button onClick={()=>deferredRef.current?.prompt()} className="mt-4 px-3 py-2 rounded-xl bg-white border">Instalar app</button>
  );
}

export default function App() {
  // Estado base
  const [db, setDb] = useLocalState({
    currency: "ARS",
    categories: [
      { id: "almuerzo-trabajo", name: "Almuerzo Trabajo" },
      { id: "amex-compras", name: "Amex Compras" },
      { id: "auto-pau", name: "Auto Pau" },
      { id: "bebe", name: "Bebé" },
      { id: "casa", name: "Casa" },
      { id: "casamiento", name: "Casamiento" },
      { id: "celular", name: "Celular" },
      { id: "coche", name: "Coche" },
      { id: "comida-y-almacen", name: "Comida y Almacén" },
      { id: "cuba", name: "CUBA" },
      { id: "delivery", name: "Delivery" },
      { id: "deporte", name: "Deporte" },
      { id: "desarrollo-personal", name: "Desarrollo personal" },
      { id: "donaciones", name: "Donaciones" },
      { id: "entretenimiento", name: "Entretenimiento" },
      { id: "eventos", name: "Eventos" },
      { id: "higiene", name: "Higiene" },
      { id: "jacinto-diaz", name: "Jacinto Diaz" },
      { id: "muchacha", name: "Muchacha" },
      { id: "otros", name: "Otros" },
      { id: "peluqueria", name: "Peluqueria" },
      { id: "perro", name: "Perro" },
      { id: "pileta", name: "Pileta" },
      { id: "regalos", name: "Regalos" },
      { id: "restaurantes", name: "Restaurantes" },
      { id: "ropa", name: "Ropa" },
      { id: "salud", name: "Salud" },
      { id: "servicios-e-impuestos", name: "Servicios e Impuestos" },
      { id: "tarjeta-pau", name: "Tarjeta Pau" },
      { id: "tarjeta-visa", name: "Tarjeta Visa" },
      { id: "taxi", name: "Taxi" },
      { id: "transporte", name: "Transporte" },
      { id: "vacaciones", name: "Vacaciones" },
    ],
    expenses: [], // {id, date, amount, categoryId, note}
  });

  const [filters, setFilters] = useState({ month: toMonthKey(todayISO()), categoryId: "all", q: "" });
  const [form, setForm] = useState({ date: todayISO(), amount: "", categoryId: "almuerzo-trabajo", note: "" });
  const amountRef = useRef(null);
  useEffect(() => { amountRef.current?.focus(); }, []);

  // Auth & sync state
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // Captura el magic link (#access_token=#...&refresh_token=...) y crea la sesión
  useEffect(() => {
    try {
      const hash = window?.location?.hash || "";
      if (hash.includes("access_token")) {
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          sb.auth.setSession({ access_token, refresh_token }).then(({ data, error }) => {
            if (!error && data?.session?.user?.id) {
              setUserId(data.session.user.id);
              // Limpio el hash de la URL para que no quede visible
              const { origin, pathname, search } = window.location;
              window.history.replaceState({}, document.title, origin + pathname + search);
            }
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    getSession().then((s) => setUserId(s?.user?.id || null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id || null);
    });
    return () => sub.subscription?.unsubscribe?.();
  }, []);

  // Derivados
  const categoriesById = useMemo(
    () => Object.fromEntries(db.categories.map(c => [c.id, c])),
    [db.categories]
  );

  const expensesFiltered = useMemo(() => {
    return db.expenses
      .filter(e => {
        const inMonth = toMonthKey(e.date) === filters.month;
        const inCat = filters.categoryId === "all" || e.categoryId === filters.categoryId;
        const inQ = !filters.q || (e.note?.toLowerCase().includes(filters.q.toLowerCase()));
        return inMonth && inCat && inQ;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [db.expenses, filters]);

  const totals = useMemo(() => {
    const monthTotal = expensesFiltered.reduce((acc, e) => acc + Number(e.amount || 0), 0);
    const byCat = {};
    for (const e of expensesFiltered) {
      byCat[e.categoryId] = (byCat[e.categoryId] || 0) + Number(e.amount || 0);
    }
    return { monthTotal, byCat };
  }, [expensesFiltered]);

  const dataByCategory = useMemo(() => {
    return Object.entries(totals.byCat).map(([catId, amt]) => ({
      name: categoriesById[catId]?.name || catId,
      amount: Number(amt || 0),
    })).sort((a,b)=>b.amount-a.amount);
  }, [totals.byCat, categoriesById]);

  const dataByDay = useMemo(() => {
    const [y, m] = filters.month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const base = Array.from({ length: lastDay }, (_, i) => ({ day: i + 1, amount: 0 }));
    for (const e of db.expenses) {
      if (toMonthKey(e.date) !== filters.month) continue;
      const d = new Date(e.date);
      const day = d.getDate();
      base[day - 1].amount += Number(e.amount || 0);
    }
    return base;
  }, [db.expenses, filters.month]);

  // Acciones
  function addExpense(ev) {
    ev.preventDefault();
    const amt = Number(String(form.amount).replace(",", "."));
    if (!amt || amt <= 0) return alert("Ingresá un monto válido");
    const id = crypto.randomUUID();
    setDb(prev => ({
      ...prev,
      expenses: [...prev.expenses, { id, date: form.date, amount: amt, categoryId: form.categoryId, note: form.note?.trim() }],
    }));
    setForm(f => ({ ...f, amount: "", note: "" }));
    amountRef.current?.focus();
  }

  function removeExpense(id) {
    if (!confirm("¿Eliminar gasto?")) return;
    setDb(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }

  function addCategory() {
    const name = prompt("Nombre de la nueva categoría:")?.trim();
    if (!name) return;
    const id = name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (db.categories.some(c => c.id === id)) return alert("Ya existe una categoría con ese nombre");
    setDb(prev => ({ ...prev, categories: [...prev.categories, { id, name }] }));
  }

  function renameCategory(catId) {
    const current = categoriesById[catId];
    const name = prompt("Nuevo nombre:", current?.name) || current?.name;
    setDb(prev => ({ ...prev, categories: prev.categories.map(c => c.id === catId ? { ...c, name } : c) }));
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gastos_${filters.month}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const header = ["id", "date", "amount", "category", "note"]; 
    const rows = db.expenses.map(e => [e.id, e.date, e.amount, categoriesById[e.categoryId]?.name || e.categoryId, (e.note||"").replaceAll("\n"," ")]);
    const csv = [header, ...rows].map(r => r.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gastos_${filters.month}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed?.expenses || !parsed?.categories) throw new Error("Formato inválido");
        setDb(parsed);
        alert("Datos importados");
      } catch (e) {
        alert("No pude importar el archivo. Revisa el formato JSON.");
      }
    };
    reader.readAsText(file);
  }

  // --- Sync manual (fuera de useEffect)
  async function doPull() {
    if (!userId) return alert("Iniciá sesión para sincronizar");
    const remote = await pullRemote(userId);
    if (remote) {
      setDb(remote);
      setLastSync(new Date());
    } else {
      alert("No hay datos remotos aún");
    }
  }
  async function doPush() {
    if (!userId) return alert("Iniciá sesión para sincronizar");
    await pushRemote(userId, db);
    setLastSync(new Date());
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Gastos — MVP</h1>
            <p className="text-sm text-slate-600">Offline • Export/Import • Sync manual • Moneda: {db.currency}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCSV} className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md">Exportar CSV</button>
            <button onClick={exportJSON} className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md">Exportar JSON</button>
            <label className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md cursor-pointer">
              Importar JSON
              <input type="file" accept="application/json" className="hidden" onChange={(e)=>e.target.files?.[0] && importJSON(e.target.files[0])} />
            </label>
          </div>
        </header>

        {/* Auth & Sync */}
        <section className="bg-white rounded-2xl shadow p-4 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex items-center gap-2">
            {userId ? (
              <div className="text-sm">Conectado · <span className="font-mono">{userId.slice(0,8)}…</span></div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex flex-col">
                  <label className="text-sm">Email para iniciar sesión</label>
                  <input className="border rounded-xl p-2" placeholder="tu@email" value={email} onChange={(e)=>setEmail(e.target.value)} />
                </div>
                <button onClick={()=>signInWithMagic(email)} className="px-3 py-2 rounded-xl bg-white border">Iniciar sesión</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={doPull} className="px-3 py-2 rounded-xl bg-white border">Pull</button>
            <button onClick={doPush} className="px-3 py-2 rounded-xl bg-white border">Push</button>
            <div className="text-xs text-slate-500">Última sync: {lastSync ? lastSync.toLocaleString() : "—"}</div>
          </div>
        </section>

        {/* Filtros */}
        <section className="bg-white rounded-2xl shadow p-4 grid gap-3 md:grid-cols-4">
          <div className="flex flex-col">
            <label className="text-sm">Mes</label>
            <input type="month" value={filters.month} onChange={(e)=>setFilters(f=>({...f, month: e.target.value}))} className="rounded-xl border p-2" />
          </div>
          <div className="flex flex-col">
            <label className="text-sm">Categoría</label>
            <select value={filters.categoryId} onChange={(e)=>setFilters(f=>({...f, categoryId: e.target.value}))} className="rounded-xl border p-2">
              <option value="all">Todas</option>
              {db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col md:col-span-2">
            <label className="text-sm">Buscar nota</label>
            <input value={filters.q} onChange={(e)=>setFilters(f=>({...f, q: e.target.value}))} placeholder="super, nafta, etc." className="rounded-xl border p-2" />
          </div>
        </section>

        {/* Totales rápidos */}
        <section className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-xl border text-center">
            <div className="text-xs text-slate-500">Total del mes</div>
            <div className="text-xl font-bold">{fmt(totals.monthTotal)}</div>
          </div>
          {Object.entries(totals.byCat).slice(0,3).map(([catId, amt]) => (
            <div className="p-3 rounded-xl border" key={catId}>
              <div className="text-xs text-slate-500">{categoriesById[catId]?.name || catId}</div>
              <div className="text-lg font-semibold">{fmt(amt)}</div>
            </div>
          ))}
        </section>

        {/* Gráficos */}
        <section className="bg-white rounded-2xl shadow p-4 grid md:grid-cols-2 gap-6">
          <div className="h-72">
            <h3 className="font-semibold mb-2">Gasto por categoría ({filters.month})</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataByCategory} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v)=>new Intl.NumberFormat().format(v)} />
                <Tooltip formatter={(v)=>fmt(v)} />
                <Legend />
                <Bar dataKey="amount" name="Monto" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-72">
            <h3 className="font-semibold mb-2">Gasto por día del mes ({filters.month})</h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dataByDay} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis tickFormatter={(v)=>new Intl.NumberFormat().format(v)} />
                <Tooltip formatter={(v)=>fmt(v)} labelFormatter={(l)=>`Día ${l}`} />
                <Legend />
                <Line type="monotone" dataKey="amount" name="Monto" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Alta de gasto */}
        <section className="bg-white rounded-2xl shadow p-4">
          <form onSubmit={addExpense} className="grid md:grid-cols-5 gap-3 items-end">
            <div className="flex flex-col">
              <label className="text-sm">Fecha</label>
              <input type="date" value={form.date} onChange={(e)=>setForm(f=>({...f, date: e.target.value}))} className="rounded-xl border p-2" />
            </div>
            <div className="flex flex-col">
              <label className="text-sm">Monto ({db.currency})</label>
              <input ref={amountRef} inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(e)=>setForm(f=>({...f, amount: e.target.value}))} className="rounded-xl border p-2" />
            </div>
            <div className="flex flex-col">
              <label className="text-sm">Categoría</label>
              <div className="flex gap-2">
                <select value={form.categoryId} onChange={(e)=>setForm(f=>({...f, categoryId: e.target.value}))} className="rounded-xl border p-2 w-full">
                  {db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" onClick={addCategory} title="Agregar categoría" className="px-3 rounded-xl border">+</button>
              </div>
            </div>
            <div className="flex flex-col md:col-span-2">
              <label className="text-sm">Nota</label>
              <input value={form.note} onChange={(e)=>setForm(f=>({...f, note: e.target.value}))} placeholder="Detalle opcional" className="rounded-xl border p-2" />
            </div>
            <div className="md:col-span-5 flex gap-2">
              <button type="submit" className="px-4 py-2 rounded-2xl bg-slate-900 text-white hover:opacity-90">Agregar</button>
              <button type="button" onClick={()=>setDb(prev=>({...prev, expenses: []}))} className="px-4 py-2 rounded-2xl bg-white border">Borrar todo</button>
            </div>
          </form>
        </section>

        {/* Lista de gastos */}
        <section className="bg-white rounded-2xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left p-2">Fecha</th>
                <th className="text-left p-2">Categoría</th>
                <th className="text-right p-2">Monto</th>
                <th className="text-left p-2">Nota</th>
                <th className="p-2"/>
              </tr>
            </thead>
            <tbody>
              {expensesFiltered.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-slate-500">Sin gastos en el período/criterios</td></tr>
              )}
              {expensesFiltered.map(e => (
                <tr key={e.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{e.date}</td>
                  <td className="p-2">{categoriesById[e.categoryId]?.name || e.categoryId}</td>
                  <td className="p-2 text-right font-medium">{fmt(e.amount)}</td>
                  <td className="p-2">{e.note}</td>
                  <td className="p-2 text-right">
                    <button onClick={()=>removeExpense(e.id)} className="text-red-600">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Categorías */}
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Categorías</h2>
            <button onClick={addCategory} className="px-3 py-1 rounded-xl border">Agregar</button>
          </div>
          <div className="grid md:grid-cols-3 gap-2">
            {db.categories.map(c => (
              <div key={c.id} className="flex items-center justify-between border rounded-xl p-2">
                <div>{c.name}</div>
                <div className="flex gap-2">
                  <button onClick={()=>renameCategory(c.id)} className="text-slate-700">Renombrar</button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Consejo: mantené pocas categorías y usá la nota para el detalle.</p>
        </section>

        {/* Footer */}
        <footer className="text-xs text-slate-500 text-center py-6">
          Hecho con React.
          <InstallPromptButton />
        </footer>
      </div>
    </div>
  );
}
