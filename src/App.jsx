import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { createClient } from "@supabase/supabase-js";

// --- Gastos — MVP (React) ---
// Enforce canonical domain so magic links/OTP siempre vuelvan al dominio correcto
const CANONICAL_HOST = "gastos-mvp.vercel.app";
if (typeof window !== "undefined" && window.location.host !== CANONICAL_HOST) {
  window.location.href = `https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// Offline-first (localStorage) + Sync manual en Supabase. Gráficos por categoría y por día.

const SUPABASE_URL = "https://qugnkfjbfqcihummbaal.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1Z25rZmpiZnFjaWh1bW1iYWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NDU5NzQsImV4cCI6MjA3NzUyMTk3NH0.b6etAkGNHkCPE5rUulXNuw36vHFAm_kv1_pVopc_c14";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

console.debug("Host actual:", typeof window !== "undefined" ? window.location.host : "(SSR)");

// Helpers
const LS_KEY = "gastos_mvp_v1";

const fmt = (n) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const toMonthKey = (d) => (d || todayISO()).slice(0, 7); // YYYY-MM

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  const lastDay = new Date(y, m, 0).getDate();
  return d >= 1 && d <= lastDay;
}

function getDayFromISODate(value) {
  if (!isValidISODate(value)) return NaN;
  return Number(String(value).slice(8, 10));
}

function getDaysInMonth(monthKey) {
  const [y, m] = String(monthKey || "").split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return 31;
  }
  return new Date(y, m, 0).getDate();
}

function getFirstCategoryId(categories = []) {
  if (!Array.isArray(categories) || categories.length === 0) return "otros";

  return [...categories]
    .sort((a, b) =>
      String(a?.name || "").localeCompare(String(b?.name || ""), "es", {
        sensitivity: "base",
      })
    )[0]?.id || "otros";
}

function buildEmptyForm(categories = [], overrides = {}) {
  return {
    date: todayISO(),
    amount: "",
    categoryId: getFirstCategoryId(categories),
    note: "",
    ...overrides,
  };
}

function evaluateAmountExpression(rawValue) {
  const raw = String(rawValue ?? "").trim();

  if (!raw) {
    throw new Error("Ingresá un monto");
  }

  const normalized = raw.replace(/,/g, ".").replace(/\s+/g, "");

  // Solo permite números, paréntesis y operadores básicos
  if (!/^[\d.+\-*/()]+$/.test(normalized)) {
    throw new Error("El monto solo puede contener números y + - * / ( )");
  }

  // Evita operadores repetidos inválidos tipo ++, **, //, etc.
  if (/[*\/]{2,}|\+\+|--|\)\(|\.\./.test(normalized)) {
    throw new Error("La operación ingresada no es válida");
  }

  let result;
  try {
    result = Function(`"use strict"; return (${normalized});`)();
  } catch {
    throw new Error("La operación ingresada no es válida");
  }

  if (!Number.isFinite(result) || result <= 0) {
    throw new Error("Ingresá un monto válido (>0)");
  }

  return Number(result);
}

// ---------- HELPERS PARA ID DE GASTO ----------
function buildExpenseCode(num) {
  return `G${String(num).padStart(6, "0")}`;
}

function getDisplayExpenseId(expense) {
  return `${expense.expenseId || ""}${expense.modified ? "M" : ""}`;
}

function extractExpenseNumber(expenseId) {
  if (!expenseId) return 0;
  const m = String(expenseId).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function getNextExpenseCode(expenses = []) {
  const maxNum = expenses.reduce((acc, e) => {
    const n = extractExpenseNumber(e.expenseId);
    return n > acc ? n : acc;
  }, 0);
  return buildExpenseCode(maxNum + 1);
}

function normalizeDb(rawDb) {
  const safeDb = rawDb || {};
  const categories = Array.isArray(safeDb.categories) ? safeDb.categories : [];
  const expenses = Array.isArray(safeDb.expenses) ? safeDb.expenses : [];

  let maxExisting = expenses.reduce((acc, e) => {
    const n = extractExpenseNumber(e?.expenseId);
    return n > acc ? n : acc;
  }, 0);

  const normalizedExpenses = expenses.map((e) => {
    const internalId = e?.id || crypto.randomUUID();

    let expenseId = e?.expenseId;
    if (!expenseId) {
      maxExisting += 1;
      expenseId = buildExpenseCode(maxExisting);
    }

    return {
      id: internalId,
      expenseId,
      modified: Boolean(e?.modified),
      date: isValidISODate(e?.date) ? e.date : todayISO(),
      amount: Number(e?.amount || 0),
      categoryId: e?.categoryId || "otros",
      note: e?.note || "",
    };
  });

  return {
    ...safeDb,
    categories,
    expenses: normalizedExpenses,
  };
}

function useLocalState(defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : defaultValue;
      return normalizeDb(parsed);
    } catch {
      return normalizeDb(defaultValue);
    }
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  return [state, setState];
}

// === Registrar Service Worker (PWA) ===
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

function InstallPromptButton() {
  const [canInstall, setCanInstall] = React.useState(false);
  const deferredRef = React.useRef(null);

  React.useEffect(() => {
    const h = (e) => {
      e.preventDefault();
      deferredRef.current = e;
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (!canInstall) return null;

  return (
    <button
      onClick={() => deferredRef.current?.prompt()}
      className="mt-4 px-3 py-2 rounded-xl bg-white border"
    >
      Instalar app
    </button>
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
    expenses: [], // {id, expenseId, modified, date, amount, categoryId, note}
  });

  const [filters, setFilters] = useState({
    month: toMonthKey(todayISO()),
    categoryId: "all",
    q: "",
  });

  const [form, setForm] = useState(() => buildEmptyForm(db.categories));
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  const amountRef = useRef(null);
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // Si no existe la categoría seleccionada en el form, la corrige
  useEffect(() => {
    setForm((prev) => {
      const exists = db.categories.some((c) => c.id === prev.categoryId);
      if (exists) return prev;
      return {
        ...prev,
        categoryId: getFirstCategoryId(db.categories),
      };
    });
  }, [db.categories]);

  // Auth & sync state
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // UI auth
  const [step, setStep] = useState("email"); // "email" | "code" | "link"
  const [code, setCode] = useState("");
  const [link, setLink] = useState("");

  // Fallback: captura magic link cuando abre en el mismo origen (escritorio)
  useEffect(() => {
    try {
      const hash = window?.location?.hash || "";
      if (hash.includes("access_token")) {
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          sb.auth
            .setSession({ access_token, refresh_token })
            .then(({ data, error }) => {
              if (!error && data?.session?.user?.id) {
                setUserId(data.session.user.id);
                const { origin, pathname, search } = window.location;
                window.history.replaceState({}, document.title, origin + pathname + search);
              }
            });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      setUserId(data.session?.user?.id || null);
    })();

    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user?.id || null)
    );

    return () => sub.subscription?.unsubscribe?.();
  }, []);

  // === OTP (no Safari) ===
  async function sendCode() {
    if (!email) return alert("Ingresá un email válido");

    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setStep("code");
      alert("Te enviamos un código de 6 dígitos. Copialo del mail y pegalo aquí.");
    } catch (e) {
      console.error("OTP error:", e);
      alert(e?.message ?? "No pudimos enviar el código");
    }
  }

  async function verifyCode() {
    if (!email) return alert("Falta el e-mail");
    if (code.trim().length !== 6) return alert("El código debe tener 6 dígitos");

    try {
      const { error } = await sb.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      setCode("");
      setStep("email");
    } catch (e) {
      console.error("OTP verify error:", e);
      alert(e?.message ?? "Código inválido");
    }
  }

  async function importMagicLink() {
    if (!link) {
      alert("Pegá el enlace completo del mail");
      return;
    }

    try {
      const raw = link.trim().replace(/\u201C|\u201D/g, '"');
      const url = new URL(raw);

      const codeParam = url.searchParams.get("code");
      if (codeParam) {
        const { error } = await sb.auth.exchangeCodeForSession(codeParam);
        if (error) throw error;
        setLink("");
        setStep("email");
        return;
      }

      const token_hash =
        url.searchParams.get("token_hash") || url.searchParams.get("token");
      let flowType = url.searchParams.get("type");

      if (token_hash) {
        const TYPES = flowType
          ? [flowType]
          : ["magiclink", "signup", "recovery", "invite", "email_change"];

        let ok = false;
        let lastErr = null;

        for (const t of TYPES) {
          const { error } = await sb.auth.verifyOtp({ token_hash, type: t });
          if (!error) {
            ok = true;
            break;
          }
          lastErr = error;

          if (
            String(error?.message || "").toLowerCase().includes("expired") ||
            String(error?.message || "").toLowerCase().includes("used")
          ) {
            break;
          }
        }

        if (ok) {
          setLink("");
          setStep("email");
          return;
        }

        throw lastErr || new Error("Email link is invalid or has expired");
      }

      const hashIndex = raw.indexOf("#");
      if (hashIndex !== -1) {
        const q = new URLSearchParams(raw.slice(hashIndex + 1));
        const at = q.get("access_token");
        const rt = q.get("refresh_token");
        if (at && rt) {
          const { error } = await sb.auth.setSession({
            access_token: at,
            refresh_token: rt,
          });
          if (error) throw error;
          setLink("");
          setStep("email");
          return;
        }
      }

      alert(
        "No pude reconocer el enlace. Pegá el link final de Supabase (https://<project>.supabase.co/auth/v1/verify?...)."
      );
    } catch (e) {
      console.error("Import link error:", e);
      alert(e?.message ?? "No pudimos importar el enlace");
    }
  }

  // Derivados
  const categoriesById = useMemo(
    () => Object.fromEntries(db.categories.map((c) => [c.id, c])),
    [db.categories]
  );

  const noteSuggestions = useMemo(() => {
    const currentText = String(form.note || "").trim().toLowerCase();
    const sameCategory = [];
    const otherCategories = [];
    const seen = new Set();

    for (const e of db.expenses) {
      const note = String(e?.note || "").trim();
      if (!note) continue;

      const key = note.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      if (e.categoryId === form.categoryId) {
        sameCategory.push(note);
      } else {
        otherCategories.push(note);
      }
    }

    const ordered = [...sameCategory, ...otherCategories];

    if (!currentText) return ordered.slice(0, 20);

    return ordered
      .filter((note) => note.toLowerCase().includes(currentText))
      .slice(0, 20);
  }, [db.expenses, form.note, form.categoryId]);

  const expensesFiltered = useMemo(() => {
    return db.expenses
      .filter((e) => {
        if (!e || !isValidISODate(e.date)) return false;

        const inMonth = !filters.month || toMonthKey(e.date) === filters.month;
        const inCat = filters.categoryId === "all" || e.categoryId === filters.categoryId;
        const q = filters.q.toLowerCase();

        const inQ =
          !filters.q ||
          (e.note || "").toLowerCase().includes(q) ||
          (e.expenseId || "").toLowerCase().includes(q) ||
          getDisplayExpenseId(e).toLowerCase().includes(q);

        return inMonth && inCat && inQ;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return extractExpenseNumber(b.expenseId) - extractExpenseNumber(a.expenseId);
      });
  }, [db.expenses, filters]);

  const totals = useMemo(() => {
    const monthTotal = expensesFiltered.reduce(
      (acc, e) => acc + Number(e.amount || 0),
      0
    );

    const byCat = {};
    for (const e of expensesFiltered) {
      byCat[e.categoryId] = (byCat[e.categoryId] || 0) + Number(e.amount || 0);
    }

    return { monthTotal, byCat };
  }, [expensesFiltered]);

  const dataByCategory = useMemo(() => {
    return Object.entries(totals.byCat)
      .map(([catId, amt]) => ({
        name: categoriesById[catId]?.name || catId,
        amount: Number(amt || 0),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [totals.byCat, categoriesById]);

  const dataByDay = useMemo(() => {
    const lastDay = getDaysInMonth(filters.month || toMonthKey(todayISO()));

    const base = Array.from({ length: lastDay }, (_, i) => ({
      day: i + 1,
      amount: 0,
    }));

    for (const e of expensesFiltered) {
      const day = getDayFromISODate(e?.date);
      if (!Number.isFinite(day)) continue;

      if (day >= 1 && day <= lastDay) {
        base[day - 1].amount += Number(e.amount ?? 0) || 0;
      }
    }

    return base;
  }, [expensesFiltered, filters.month]);

  const expensesOfSelectedDay = useMemo(() => {
    if (!Number.isFinite(selectedDay)) return [];

    return expensesFiltered
      .filter((e) => getDayFromISODate(e?.date) === selectedDay)
      .sort((a, b) => {
        return extractExpenseNumber(b.expenseId) - extractExpenseNumber(a.expenseId);
      });
  }, [expensesFiltered, selectedDay]);

  const selectedDayTotal = useMemo(() => {
    return expensesOfSelectedDay.reduce((acc, e) => acc + Number(e.amount || 0), 0);
  }, [expensesOfSelectedDay]);

  function resetForm(options = {}) {
    const {
      preserveLastDateAndCategory = false,
      forcedDate,
      forcedCategoryId,
    } = options;

    setForm((prev) =>
      buildEmptyForm(db.categories, {
        date: preserveLastDateAndCategory ? prev.date : forcedDate || todayISO(),
        categoryId: preserveLastDateAndCategory
          ? prev.categoryId
          : forcedCategoryId || getFirstCategoryId(db.categories),
      })
    );
    setEditingRecordId(null);
  }

  function resolveAmountInForm() {
    try {
      const result = evaluateAmountExpression(form.amount);
      setForm((f) => ({ ...f, amount: String(result) }));
      setTimeout(() => {
        amountRef.current?.focus();
        const len = String(result).length;
        amountRef.current?.setSelectionRange?.(len, len);
      }, 0);
      return true;
    } catch (e) {
      alert(e?.message || "Ingresá un monto válido");
      return false;
    }
  }

  function handleSubmitExpense(ev) {
    ev.preventDefault();

    const date = (form.date || "").trim();
    if (!isValidISODate(date)) {
      alert("Elegí una fecha válida (AAAA-MM-DD)");
      return;
    }

    let amt;
    try {
      amt = evaluateAmountExpression(form.amount);
    } catch (e) {
      alert(e?.message || "Ingresá un monto válido");
      return;
    }

    if (!form.categoryId) {
      alert("Elegí una categoría");
      return;
    }

    if (editingRecordId) {
      setDb((prev) => ({
        ...prev,
        expenses: prev.expenses.map((e) =>
          e.id === editingRecordId
            ? {
                ...e,
                date,
                amount: amt,
                categoryId: form.categoryId,
                note: (form.note || "").trim(),
                modified: true,
              }
            : e
        ),
      }));
    } else {
      const nextExpenseId = getNextExpenseCode(db.expenses);

      setDb((prev) => ({
        ...prev,
        expenses: [
          ...prev.expenses,
          {
            id: crypto.randomUUID(),
            expenseId: nextExpenseId,
            modified: false,
            date,
            amount: amt,
            categoryId: form.categoryId,
            note: (form.note || "").trim(),
          },
        ],
      }));
    }

    resetForm({ preserveLastDateAndCategory: true });
    amountRef.current?.focus();
  }

  function removeExpense(id) {
    if (!confirm("¿Eliminar gasto?")) return;
    setDb((prev) => ({
      ...prev,
      expenses: prev.expenses.filter((e) => e.id !== id),
    }));
    if (editingRecordId === id) {
      resetForm();
    }
  }

  function editExpense(expense) {
    setForm({
      date: expense.date || todayISO(),
      amount: String(expense.amount ?? ""),
      categoryId: expense.categoryId || getFirstCategoryId(db.categories),
      note: expense.note || "",
    });
    setEditingRecordId(expense.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => amountRef.current?.focus(), 50);
  }

  function duplicateExpense(expense) {
    setForm({
      date: expense.date || todayISO(),
      amount: String(expense.amount ?? ""),
      categoryId: expense.categoryId || getFirstCategoryId(db.categories),
      note: expense.note || "",
    });
    setEditingRecordId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => amountRef.current?.focus(), 50);
  }

  function addCategory() {
    const name = prompt("Nombre de la nueva categoría:")?.trim();
    if (!name) return;

    const id = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    if (db.categories.some((c) => c.id === id)) {
      return alert("Ya existe una categoría con ese nombre");
    }

    setDb((prev) => ({
      ...prev,
      categories: [...prev.categories, { id, name }],
    }));
  }

  function renameCategory(catId) {
    const current = categoriesById[catId];
    const name = prompt("Nuevo nombre:", current?.name) || current?.name;

    setDb((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === catId ? { ...c, name } : c
      ),
    }));
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(db, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos_${filters.month || "todos"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const header = ["id_gasto", "fecha", "monto", "categoria", "nota"];

    const rows = db.expenses.map((e) => [
      getDisplayExpenseId(e),
      e.date,
      e.amount,
      categoriesById[e.categoryId]?.name || e.categoryId,
      (e.note || "").replaceAll("\n", " "),
    ]);

    const csv = [header, ...rows]
      .map((r) =>
        r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos_${filters.month || "todos"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed?.expenses || !parsed?.categories) {
          throw new Error("Formato inválido");
        }
        const normalized = normalizeDb(parsed);
        setDb(normalized);
        setForm(buildEmptyForm(normalized.categories));
        setEditingRecordId(null);
        alert("Datos importados");
      } catch (e) {
        alert("No pude importar el archivo. Revisá el formato JSON.");
      }
    };
    reader.readAsText(file);
  }

  // --- Sync manual
  async function doPull() {
    if (!userId) return alert("Iniciá sesión para sincronizar");

    const remote = await sb
      .from("gastos_snapshots")
      .select("payload")
      .eq("user_id", userId)
      .single();

    if (remote.error && remote.error.code !== "PGRST116") {
      alert("Pull error: " + remote.error.message);
      return;
    }

    if (remote.data?.payload) {
      const normalized = normalizeDb(remote.data.payload);
      setDb(normalized);
      setLastSync(new Date());
      setForm(buildEmptyForm(normalized.categories));
      setEditingRecordId(null);
    } else {
      alert("No hay datos remotos aún");
    }
  }

  async function doPush() {
    if (!userId) return alert("Iniciá sesión para sincronizar");

    const { error } = await sb.from("gastos_snapshots").upsert({
      user_id: userId,
      payload: db,
      updated_at: new Date().toISOString(),
    });

    if (error) alert("Push error: " + error.message);
    else setLastSync(new Date());
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Gastos — MVP</h1>
            <p className="text-sm text-slate-600">
              Offline • Export/Import • Sync manual • Moneda: {db.currency}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={exportCSV}
              className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md"
            >
              Exportar CSV
            </button>
            <button
              onClick={exportJSON}
              className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md"
            >
              Exportar JSON
            </button>
            <label className="px-3 py-2 rounded-xl bg-white shadow hover:shadow-md cursor-pointer">
              Importar JSON
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && importJSON(e.target.files[0])
                }
              />
            </label>
          </div>
        </header>

        {/* Auth & Sync */}
        <section className="bg-white rounded-2xl shadow p-4 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="flex items-center gap-2">
            {userId ? (
              <div className="text-sm">
                Conectado · <span className="font-mono">{userId.slice(0, 8)}…</span>
              </div>
            ) : (
              <>
                {step === "email" && (
                  <div className="flex flex-col gap-2 md:flex-row md:items-end">
                    <div className="flex flex-col">
                      <label className="text-sm">Email para iniciar sesión</label>
                      <input
                        className="border rounded-xl p-2"
                        placeholder="tu@email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={sendCode}
                        className="px-3 py-2 rounded-xl bg-white border"
                      >
                        Enviar código
                      </button>
                      <button
                        onClick={() => setStep("link")}
                        className="px-3 py-2 rounded-xl bg-white border"
                      >
                        Tengo un link
                      </button>
                    </div>
                  </div>
                )}

                {step === "code" && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex flex-col">
                      <label className="text-sm">Código de 6 dígitos</label>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        className="border rounded-xl p-2 tracking-widest text-center"
                        placeholder="••••••"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      />
                    </div>
                    <button
                      onClick={verifyCode}
                      className="px-3 py-2 rounded-xl bg-white border"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={sendCode}
                      className="px-3 py-2 rounded-xl bg-white border"
                      title="Reenviar código"
                    >
                      Reenviar
                    </button>
                    <button
                      onClick={() => {
                        setStep("email");
                        setCode("");
                      }}
                      className="px-3 py-2 rounded-xl bg-white border"
                    >
                      Cambiar e-mail
                    </button>
                    <button
                      onClick={() => {
                        setStep("link");
                      }}
                      className="px-3 py-2 rounded-xl bg-white border"
                    >
                      Tengo un link
                    </button>
                  </div>
                )}

                {step === "link" && (
                  <div className="flex items-end gap-2 md:w-[640px]">
                    <div className="flex flex-col flex-1">
                      <label className="text-sm">Pegar Magic Link del mail</label>
                      <input
                        className="border rounded-xl p-2"
                        placeholder="Pegá acá el enlace completo del mail"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={importMagicLink}
                      className="px-3 py-2 rounded-xl bg-white border"
                    >
                      Importar link
                    </button>
                    <button
                      onClick={() => {
                        setStep("email");
                        setLink("");
                      }}
                      className="px-3 py-2 rounded-xl bg-white border"
                    >
                      Volver
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={doPull} className="px-3 py-2 rounded-xl bg-white border">
              Pull
            </button>
            <button onClick={doPush} className="px-3 py-2 rounded-xl bg-white border">
              Push
            </button>
            <div className="text-xs text-slate-500">
              Última sync: {lastSync ? lastSync.toLocaleString() : "—"}
            </div>
          </div>
        </section>

        {/* Filtros */}
        <section className="bg-white rounded-2xl shadow p-4 grid gap-3 md:grid-cols-4">
          <div className="flex flex-col">
            <label className="text-sm">Mes</label>
            <div className="flex gap-2">
              <input
                type="month"
                value={filters.month}
                onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
                className="rounded-xl border p-2 w-full"
              />
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, month: "" }))}
                className="px-3 rounded-xl border bg-white"
                title="Buscar en todos los meses"
              >
                Todos
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-sm">Categoría</label>
            <select
              value={filters.categoryId}
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
              className="rounded-xl border p-2"
            >
              <option value="all">Todas</option>
              {db.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col md:col-span-2">
            <label className="text-sm">Buscar nota o ID</label>
            <input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="super, nafta, G000015, etc."
              className="rounded-xl border p-2"
            />
          </div>
        </section>

        {/* Totales rápidos */}
        <section className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-xl border text-center">
            <div className="text-xs text-slate-500">Total del mes</div>
            <div className="text-xl font-bold">{fmt(totals.monthTotal)}</div>
          </div>
          {Object.entries(totals.byCat)
            .slice(0, 3)
            .map(([catId, amt]) => (
              <div className="p-3 rounded-xl border" key={catId}>
                <div className="text-xs text-slate-500">
                  {categoriesById[catId]?.name || catId}
                </div>
                <div className="text-lg font-semibold">{fmt(amt)}</div>
              </div>
            ))}
        </section>

        {/* Gráficos */}
        <section className="bg-white rounded-2xl shadow p-4 grid md:grid-cols-2 gap-6">
          <div className="h-72">
            <h3 className="font-semibold mb-2">
              Gasto por categoría ({filters.month || "todos los meses"})
            </h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataByCategory} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v) => new Intl.NumberFormat().format(v)} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Legend />
                <Bar dataKey="amount" name="Monto" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="h-72">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">
                Gasto por día del mes ({filters.month || "todos los meses"})
              </h3>
              <div className="flex items-center gap-2">
                {Number.isFinite(selectedDay) && (
                  <span className="text-xs text-slate-500">
                    Día seleccionado: {selectedDay}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="px-2 py-1 rounded-lg border text-xs bg-white"
                >
                  Limpiar
                </button>
              </div>
            </div>

            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dataByDay}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                onClick={(state) => {
                  const day = state?.activeLabel;
                  if (Number.isFinite(day)) {
                    setSelectedDay(day);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis tickFormatter={(v) => new Intl.NumberFormat().format(v)} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={(l) => `Día ${l}`} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="amount"
                  name="Monto"
                  strokeWidth={2}
                  dot={{ r: 3, cursor: "pointer" }}
                  activeDot={{ r: 6, cursor: "pointer" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {Number.isFinite(selectedDay) && (
          <section className="bg-white rounded-2xl shadow p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
              <div>
                <h3 className="font-semibold">
                  Detalle del día {selectedDay} ({filters.month || "todos los meses"})
                </h3>
                <p className="text-sm text-slate-500">
                  {expensesOfSelectedDay.length} gasto(s) · Total: {fmt(selectedDayTotal)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="px-3 py-2 rounded-xl bg-white border"
              >
                Cerrar detalle
              </button>
            </div>

            {expensesOfSelectedDay.length === 0 ? (
              <div className="text-sm text-slate-500">
                No hay gastos para ese día con los filtros actuales.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="text-left p-2">ID gasto</th>
                      <th className="text-left p-2">Fecha</th>
                      <th className="text-left p-2">Categoría</th>
                      <th className="text-right p-2">Monto</th>
                      <th className="text-left p-2">Nota</th>
                      <th className="text-right p-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expensesOfSelectedDay.map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="p-2 whitespace-nowrap font-mono">
                          {getDisplayExpenseId(e)}
                        </td>
                        <td className="p-2 whitespace-nowrap">{e.date}</td>
                        <td className="p-2">
                          {categoriesById[e.categoryId]?.name || e.categoryId}
                        </td>
                        <td className="p-2 text-right font-medium">{fmt(e.amount)}</td>
                        <td className="p-2">{e.note}</td>
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-3 whitespace-nowrap">
                            <button
                              onClick={() => editExpense(e)}
                              className="text-slate-700 hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => duplicateExpense(e)}
                              className="text-blue-700 hover:underline"
                            >
                              Duplicar
                            </button>
                            <button
                              onClick={() => removeExpense(e.id)}
                              className="text-red-600 hover:underline"
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Alta / Edición de gasto */}
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <h2 className="font-semibold">
              {editingRecordId ? "Editar gasto" : "Agregar gasto"}
            </h2>

            {editingRecordId && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1">
                  Estás editando un gasto existente
                </span>
                <button
                  type="button"
                  onClick={() => resetForm()}
                  className="px-3 py-2 rounded-xl bg-white border"
                >
                  Cancelar edición
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmitExpense} className="grid md:grid-cols-5 gap-3 items-end">
            <div className="flex flex-col">
              <label className="text-sm">Fecha</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-xl border p-2"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm">Monto ({db.currency})</label>
              <input
                ref={amountRef}
                inputMode="text"
                placeholder="Ej: 1200+350 o 2*1500"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    resolveAmountInForm();
                  }
                }}
                onBlur={() => {
                  if (!String(form.amount || "").trim()) return;
                  try {
                    const result = evaluateAmountExpression(form.amount);
                    setForm((f) => ({ ...f, amount: String(result) }));
                  } catch {
                    // No hacemos nada en blur; se valida al guardar
                  }
                }}
                className="rounded-xl border p-2"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm">Categoría</label>
              <div className="flex gap-2">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                  className="rounded-xl border p-2 w-full"
                >
                  {db.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCategory}
                  title="Agregar categoría"
                  className="px-3 rounded-xl border"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-col md:col-span-2">
              <label className="text-sm">Nota</label>
              <input
                list="note-suggestions"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Detalle opcional"
                className="rounded-xl border p-2"
                autoComplete="off"
              />
              <datalist id="note-suggestions">
                {noteSuggestions.map((note) => (
                  <option key={note} value={note} />
                ))}
              </datalist>
            </div>

            <div className="md:col-span-5 flex gap-2 flex-wrap">
              <button
                type="submit"
                className="px-4 py-2 rounded-2xl bg-slate-900 text-white hover:opacity-90"
              >
                {editingRecordId ? "Guardar cambios" : "Agregar"}
              </button>

              <button
                type="button"
                onClick={() => resetForm()}
                className="px-4 py-2 rounded-2xl bg-white border"
              >
                Limpiar formulario
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!confirm("¿Borrar todos los gastos?")) return;
                  setDb((prev) => ({ ...prev, expenses: [] }));
                  resetForm();
                }}
                className="px-4 py-2 rounded-2xl bg-white border"
              >
                Borrar todo
              </button>
            </div>
          </form>
        </section>

        {/* Lista de gastos */}
        <section className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left p-2">ID gasto</th>
                  <th className="text-left p-2">Fecha</th>
                  <th className="text-left p-2">Categoría</th>
                  <th className="text-right p-2">Monto</th>
                  <th className="text-left p-2">Nota</th>
                  <th className="text-right p-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {expensesFiltered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500">
                      Sin gastos en el período/criterios
                    </td>
                  </tr>
                )}

                {expensesFiltered.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="p-2 whitespace-nowrap font-mono">
                      {getDisplayExpenseId(e)}
                    </td>
                    <td className="p-2 whitespace-nowrap">{e.date}</td>
                    <td className="p-2">
                      {categoriesById[e.categoryId]?.name || e.categoryId}
                    </td>
                    <td className="p-2 text-right font-medium">{fmt(e.amount)}</td>
                    <td className="p-2">{e.note}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-3 whitespace-nowrap">
                        <button
                          onClick={() => editExpense(e)}
                          className="text-slate-700 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => duplicateExpense(e)}
                          className="text-blue-700 hover:underline"
                        >
                          Duplicar
                        </button>
                        <button
                          onClick={() => removeExpense(e.id)}
                          className="text-red-600 hover:underline"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Categorías */}
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Categorías</h2>
            <button onClick={addCategory} className="px-3 py-1 rounded-xl border">
              Agregar
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-2">
            {db.categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between border rounded-xl p-2">
                <div>{c.name}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => renameCategory(c.id)}
                    className="text-slate-700"
                  >
                    Renombrar
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500 mt-2">
            Consejo: mantené pocas categorías y usá la nota para el detalle.
          </p>
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
