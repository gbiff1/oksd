import React, { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Plus, UserPlus, Edit3, Users, Wallet, Calendar, Search, X, CheckCircle2, Undo2, Trash2, Sun, Moon, Download } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ===== Utils
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const today = () => new Date().toISOString().slice(0, 10);
const ym = (d) => (d || today()).slice(0, 7);
const monthName = (ymStr) => {
  const [y, m] = ymStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};
const clamp2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const id = () => uuidv4();
const PIE_COLORS = [
  "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4",
  "#84CC16", "#F97316", "#EC4899", "#0EA5E9", "#22D3EE", "#A78BFA"
];

// helpers de mês
const ymAdd = (ymStr, delta) => {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return d.toISOString().slice(0, 7);
};
const startYmOf = (dueYm, installmentNumber) => ymAdd(dueYm, -((Number(installmentNumber || 1)) - 1));

// ===== Local Storage
const LS_KEY = "contas-a-receber-data-v1";
const THEME_KEY = "contas-a-receber-dark";
const loadLS = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};
const saveLS = (data) => localStorage.setItem(LS_KEY, JSON.stringify(data));

// ===== Default seed (empty)
const defaultData = {
  people: [
    { id: id(), name: "Amigo 1" },
    { id: id(), name: "Amiga 2" },
  ],
  transactions: [],
};

// ===== Components
export default function App() {
  const [data, setData] = useState(() => loadLS() || defaultData);
  const [selectedPerson, setSelectedPerson] = useState(data.people[0]?.id || null);
  const [selectedMonth, setSelectedMonth] = useState(ym(today()));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // transaction being edited
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [editingPersonName, setEditingPersonName] = useState("");
  const [dark, setDark] = useState(() => {
    try { return JSON.parse(localStorage.getItem(THEME_KEY) || "false"); } catch { return false; }
  });

  // ===== MIGRAÇÃO: atribui seriesId às parcelas antigas que não têm
  useEffect(() => {
    const txs = data.transactions;
    let changed = false;
    const keyToSeries = new Map();
    const migrated = txs.map((t) => {
      if (t.type === "parcelado" && !t.seriesId && t.installmentNumber && t.dueYm) {
        const start = startYmOf(t.dueYm, t.installmentNumber);
        const key = \`\${t.personId}|\${t.description}|\${clamp2(t.amount)}|\${start}\`;
        let sid = keyToSeries.get(key);
        if (!sid) { sid = id(); keyToSeries.set(key, sid); }
        changed = true;
        return { ...t, seriesId: sid };
      }
      return t;
    });
    if (changed) setData((prev) => ({ ...prev, transactions: migrated }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => saveLS(data), [data]);
  useEffect(() => { localStorage.setItem(THEME_KEY, JSON.stringify(dark)); }, [dark]);

  // Derived lists
  const people = data.people;
  const tx = data.transactions;

  const person = useMemo(() => people.find((p) => p.id === selectedPerson) || null, [selectedPerson, people]);

  // Filters
  const filteredTx = useMemo(() => {
    return tx.filter((t) => {
      const matchesPerson = selectedPerson ? t.personId === selectedPerson : true;
      const matchesMonth = t.dueYm === selectedMonth;
      const matchesQuery = query
        ? [t.description, t.type, t.status]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())
        : true;
      return matchesPerson && matchesMonth && matchesQuery;
    });
  }, [tx, selectedPerson, selectedMonth, query]);

  // Stats
  const { totalMesAberto, totalMesPago, totalFuturo, totalAtrasado } = useMemo(() => {
    let aberto = 0, pago = 0, futuro = 0, atrasado = 0;
    const todayStr = today();
    for (const t of tx) {
      const val = Number(t.amount) || 0;
      const isFuturo = t.dueYm > selectedMonth;
      const isMes = t.dueYm === selectedMonth;
      const isPast = t.dueYm < ym(todayStr);
      if (isMes) {
        if (t.status === "pago") pago += val; else aberto += val;
      }
      if (isFuturo) futuro += t.status === "pago" ? 0 : val;
      if (isPast && t.status !== "pago") atrasado += val;
    }
    return {
      totalMesAberto: clamp2(aberto),
      totalMesPago: clamp2(pago),
      totalFuturo: clamp2(futuro),
      totalAtrasado: clamp2(atrasado),
    };
  }, [tx, selectedMonth]);

  // Next 6 months projection for selected person
  const monthsAhead = useMemo(() => {
    const out = [];
    const base = new Date(selectedMonth + "-01");
    for (let i = 0; i < 6; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  }, [selectedMonth]);

  const chartData = useMemo(() => {
    return monthsAhead.map((m) => {
      const open = tx
        .filter((t) => (!selectedPerson || t.personId === selectedPerson) && t.dueYm === m && t.status !== "pago")
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      const paid = tx
        .filter((t) => (!selectedPerson || t.personId === selectedPerson) && t.dueYm === m && t.status === "pago")
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      return { month: m, Aberto: clamp2(open), Pago: clamp2(paid) };
    });
  }, [monthsAhead, tx, selectedPerson]);

  const pieData = useMemo(() => {
    // Total aberto por pessoa no mês selecionado
    const map = new Map();
    for (const t of tx) {
      if (t.dueYm !== selectedMonth || t.status === "pago") continue;
      map.set(t.personId, (map.get(t.personId) || 0) + Number(t.amount || 0));
    }
    const arr = [...map.entries()].map(([pid, val]) => ({ name: people.find((p) => p.id === pid)?.name || "-", value: clamp2(val) }));
    return arr.length ? arr : [{ name: "Sem aberto", value: 1 }];
  }, [tx, selectedMonth, people]);

  // ===== Handlers
  const addPerson = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newP = { id: id(), name: trimmed };
    const newPeople = [...people, newP];
    setData({ ...data, people: newPeople });
    setSelectedPerson(newP.id);
  };

  const removePerson = (pid) => {
    if (!confirm("Remover esta pessoa e todas as transações relacionadas?")) return;
    const remaining = people.filter((p) => p.id !== pid);
    setData({
      people: remaining,
      transactions: tx.filter((t) => t.personId !== pid),
    });
    setSelectedPerson((prev) => (prev === pid ? (remaining[0]?.id || null) : prev));
  };

  const updatePerson = (pid, newName) => {
    setData({ ...data, people: people.map((p) => (p.id === pid ? { ...p, name: newName } : p)) });
  };

  // encontra/gera seriesId para uma parcela
  const getSeriesIdFor = (payload) => {
    const current = Math.max(1, Number(payload.currentInstallment || payload.installmentNumber || 1));
    const start = startYmOf(payload.dueYm, current);
    // Procura série existente pelo mesmo início + pessoa + descrição
    const sibling = tx.find((t) => t.type === "parcelado" && t.personId === payload.personId && t.description === payload.description && startYmOf(t.dueYm, t.installmentNumber || 1) === start && t.seriesId);
    return sibling?.seriesId || id();
  };

  const addTransaction = (payload, autoGenerate = true) => {
    const entries = [];
    if (payload.type === "parcelado") {
      const current = Math.max(1, Number(payload.currentInstallment || 1));
      const total = Math.max(current, Number(payload.totalInstallments || current));
      const start = startYmOf(payload.dueYm, current);
      const sid = getSeriesIdFor(payload);

      if (autoGenerate) {
        // Gera a parcela atual e as próximas, numerando a partir da parcela atual
        for (let num = current; num <= total; num++) {
          const ymStr = ymAdd(start, num - 1);
          entries.push({
            ...payload,
            id: id(),
            seriesId: sid,
            installmentNumber: num,
            totalInstallments: total,
            dueYm: ymStr,
            date: payload.date || today(),
            status: payload.status || "aberto",
          });
        }
      } else {
        // Cria somente a parcela atual
        entries.push({
          ...payload,
          id: id(),
          seriesId: sid,
          installmentNumber: current,
          totalInstallments: total,
          date: payload.date || today(),
          status: payload.status || "aberto",
        });
      }
    } else {
      // À vista (1x)
      entries.push({ ...payload, id: id(), date: payload.date || today(), status: payload.status || "aberto" });
    }
    setData({ ...data, transactions: [...tx, ...entries] });
  };

  const updateTransaction = (tid, patch) => {
    setData({ ...data, transactions: tx.map((t) => (t.id === tid ? { ...t, ...patch } : t)) });
  };

  // Atualiza toda a série (total, valor, descrição) e corta/extrapola parcelas
  const updateTransactionCascade = (tid, patch) => {
    const src = tx.find((t) => t.id === tid);
    if (!src) return;

    if (src.type === "parcelado" && src.seriesId) {
      const seriesId = src.seriesId;
      const currentItems = tx.filter((t) => t.seriesId === seriesId).sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0));
      const prevMax = currentItems.reduce((m, t) => Math.max(m, t.installmentNumber || 0), 0);
      const newTotal = Number(patch.totalInstallments ?? src.totalInstallments ?? prevMax);
      const baseStart = startYmOf(src.dueYm, src.installmentNumber || 1);

      // 1) remove excedentes se novo total < atual
      let newTx = tx.filter((t) => !(t.seriesId === seriesId && (t.installmentNumber || 0) > newTotal));

      // 2) atualiza campos comuns na série
      newTx = newTx.map((t) => {
        if (t.seriesId !== seriesId) return t;
        const upd = { ...t, totalInstallments: newTotal };
        if (patch.amount !== undefined) upd.amount = patch.amount;
        if (patch.description !== undefined) upd.description = patch.description;
        return upd;
      });

      // 3) se novo total > quantidade existente, cria faltantes
      const afterItems = newTx.filter((t) => t.seriesId === seriesId);
      const afterMax = afterItems.reduce((m, t) => Math.max(m, t.installmentNumber || 0), 0);
      if (newTotal > afterMax) {
        const base = { ...src, ...patch };
        for (let num = afterMax + 1; num <= newTotal; num++) {
          newTx.push({
            id: id(),
            personId: src.personId,
            description: base.description || src.description || "",
            amount: Number(base.amount ?? src.amount),
            type: "parcelado",
            installmentNumber: num,
            totalInstallments: newTotal,
            dueYm: ymAdd(baseStart, num - 1),
            date: src.date || today(),
            status: "aberto",
            seriesId,
          });
        }
      }

      setData({ ...data, transactions: newTx });
    } else {
      // não parcelado: apenas atualiza o item
      updateTransaction(tid, patch);
    }
  };

  const deleteTransaction = (tid) => setData({ ...data, transactions: tx.filter((t) => t.id !== tid) });

  // UI helpers
  const [personNameInput, setPersonNameInput] = useState("");

  const [form, setForm] = useState({
    description: "",
    amount: "",
    type: "vista",
    totalInstallments: 2,
    currentInstallment: 1,
    autoGenerateRemaining: true,
    dueYm: ym(),
    date: today(),
  });

  const resetForm = () => setForm({ description: "", amount: "", type: "vista", totalInstallments: 2, currentInstallment: 1, autoGenerateRemaining: true, dueYm: ym(), date: today() });

  const startEdit = (t) => {
    setEditing(t.id);
    setForm({
      description: t.description || "",
      amount: String(t.amount),
      type: t.type,
      totalInstallments: t.totalInstallments || 2,
      currentInstallment: t.installmentNumber || 1,
      autoGenerateRemaining: true,
      dueYm: t.dueYm,
      date: t.date || today(),
    });
  };

  const submitForm = (e) => {
    e.preventDefault();
    const amt = clamp2(form.amount);
    if (!amt || !selectedPerson) return;
    const safeTotal = Math.max(1, Number(form.totalInstallments || 1));
    const safeCurrent = Math.min(Math.max(1, Number(form.currentInstallment || 1)), safeTotal);

    if (editing) {
      const patch = {
        description: form.description,
        amount: amt,
        type: form.type,
        totalInstallments: form.type === "parcelado" ? safeTotal : undefined,
        installmentNumber: form.type === "parcelado" ? safeCurrent : undefined,
        dueYm: form.dueYm,
        date: form.date,
      };
      // aplica em toda a série quando for parcelado
      updateTransactionCascade(editing, patch);
      setEditing(null);
      resetForm();
      return;
    }

    addTransaction({
      personId: selectedPerson,
      date: form.date,
      dueYm: form.dueYm,
      description: form.description,
      amount: amt,
      type: form.type,
      currentInstallment: form.type === "parcelado" ? safeCurrent : undefined,
      totalInstallments: form.type === "parcelado" ? safeTotal : undefined,
      status: "aberto",
    }, form.type === "parcelado" ? Boolean(form.autoGenerateRemaining) : false);
    resetForm();
  };

  const exportPdf = () => {
    try {
      if (!filteredTx.length) {
        alert("Não há lançamentos no mês atual para exportar.");
        return;
      }

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const title = \`Contas a Receber — \${monthName(selectedMonth)}\${person ? \` — \${person.name}\` : ""}\`;
      doc.setFontSize(16);
      doc.text(title, 40, 40);

      const rows = filteredTx.map((t) => [
        t.date,
        person ? (person.name) : (people.find((p) => p.id === t.personId)?.name || "-"),
        t.description || "",
        t.type === "parcelado" ? \`\${t.installmentNumber}/\${t.totalInstallments}\` : "À vista",
        BRL.format(Number(t.amount || 0)),
        t.status === "pago" ? "Pago" : "Em aberto",
      ]);

      const tableOptions = {
        head: [["Data", "Pessoa", "Descrição", "Parcela", "Valor", "Status"]],
        body: rows,
        startY: 60,
        styles: { fontSize: 10 },
        theme: "grid",
        headStyles: { fillColor: [15, 23, 42], textColor: 255 },
      };

      // Compatibilidade com diferentes formas de usar o autotable
      try {
        if (typeof autoTable === 'function') {
          autoTable(doc, tableOptions);
        } else if (typeof doc.autoTable === 'function') {
          doc.autoTable(tableOptions);
        }
      } catch (e) {
        // Se o plugin falhar, continua sem tabela (pelo menos exporta o cabeçalho)
        console.error('Falha no jspdf-autotable:', e);
      }

      const aberto = filteredTx.reduce((s, t) => s + (t.status !== "pago" ? Number(t.amount || 0) : 0), 0);
      const pago = filteredTx.reduce((s, t) => s + (t.status === "pago" ? Number(t.amount || 0) : 0), 0);
      const total = filteredTx.reduce((s, t) => s + Number(t.amount || 0), 0);

      // @ts-ignore
      const y = (doc.lastAutoTable?.finalY || 60) + 28;
      doc.setFontSize(12);
      doc.text(\`Aberto: \${BRL.format(aberto)}\`, 40, y);
      doc.text(\`Pago: \${BRL.format(pago)}\`, 200, y);
      doc.text(\`Total: \${BRL.format(total)}\`, 360, y);

      const file = \`contas-\${selectedMonth}\${person ? \`-\${person.name.replace(/\s+/g, "_")}\` : ""}.pdf\`;

      // Estratégia robusta: tenta baixar e também abre em nova aba como fallback visível
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      // Tenta forçar download
      const link = document.createElement('a');
      link.href = url;
      link.download = file;
      document.body.appendChild(link);
      link.click();
      // Abre em nova aba para garantir feedback visual mesmo se o download for bloqueado
      window.open(url, '_blank');
      setTimeout(() => { try { URL.revokeObjectURL(url); link.remove(); } catch {} }, 15000);
    } catch (err) {
      console.error(err);
      alert("Não consegui gerar o PDF aqui. Tenta desativar bloqueador de pop‑ups/ads ou me avisa o navegador/dispositivo que está usando.");
    }
  };

  return (
    <div className={dark ? "dark" : ""}>
      {/* CSS vars for light/dark */}
      <style>{`
        :root{--bg:#f8fafc;--card:#ffffff;--text:#0f172a;--muted:#475569;--border:#e2e8f0}
        .dark{--bg:#0b1220;--card:#0f172a;--text:#e2e8f0;--muted:#94a3b8;--border:#1f2937}
        .theme-bg{background:var(--bg)}
        .theme-card{background:var(--card)}
        .theme-text{color:var(--text)}
        .theme-muted{color:var(--muted)}
        .theme-border{border-color:var(--border)}
      `}</style>

      <div className="min-h-screen w-full theme-bg theme-text">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b theme-border" style={{ background: "var(--card)" }}>
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Wallet className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Contas a Receber</h1>
            <span className="ml-auto text-sm theme-muted">Armazena no seu navegador</span>
            <button
              onClick={() => setDark((d) => !d)}
              className="ml-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl border theme-border"
              title={dark ? "Mudar para claro" : "Mudar para escuro"}
              style={{ color: "var(--text)" }}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{dark ? "Claro" : "Escuro"}</span>
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Sidebar */}
          <aside className="lg:col-span-3 rounded-2xl shadow p-4 theme-card theme-text border theme-border space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <h2 className="font-semibold">Pessoas</h2>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
              {people.map((p) => (
                <div
                  key={p.id}
                  className={\`w-full px-3 py-2 rounded-xl border theme-border flex items-center justify-between \${ 
                    selectedPerson === p.id ? "bg-slate-900 text-white" : "hover:opacity-80"
                  }\`}
                  style={selectedPerson === p.id ? undefined : { background: "var(--card)", color: "var(--text)" }}
                >
                  <button className="flex-1 text-left truncate" onClick={() => setSelectedPerson(p.id)}>
                    {editingPersonId === p.id ? (
                      <input
                        value={editingPersonName}
                        onChange={(e) => setEditingPersonName(e.target.value)}
                        onBlur={() => { updatePerson(p.id, editingPersonName); setEditingPersonId(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { updatePerson(p.id, editingPersonName); setEditingPersonId(null); }}}
                        className="px-2 py-1 rounded border theme-border"
                        style={{ color: "var(--text)", background: "var(--card)" }}
                        autoFocus
                      />
                    ) : (
                      <span>{p.name}</span>
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingPersonId(p.id); setEditingPersonName(p.name); }}
                      className="p-1 rounded-full hover:opacity-80"
                      title="Editar nome"
                      style={{ background: "transparent" }}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removePerson(p.id)}
                      className="p-1 rounded-full hover:opacity-80"
                      title="Remover pessoa"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); addPerson(personNameInput); setPersonNameInput(""); }}
            >
              <input
                value={personNameInput}
                onChange={(e) => setPersonNameInput(e.target.value)}
                placeholder="Adicionar pessoa"
                className="flex-1 px-3 py-2 rounded-xl border theme-border"
                style={{ background: "var(--card)", color: "var(--text)" }}
              />
              <button className="px-3 py-2 rounded-xl text-white" style={{ background: "var(--text)" }}>
                <span className="inline-flex items-center gap-1">
                  <UserPlus className="w-4 h-4" /> Adicionar
                </span>
              </button>
            </form>

            <div className="pt-2 border-t theme-border space-y-2">
              <div className="text-sm theme-muted font-medium">Mês</div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border theme-border"
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Search className="w-4 h-4" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar descrição/status"
                  className="flex-1 px-3 py-2 rounded-xl border theme-border"
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />
              </div>
            </div>
          </aside>

          {/* Main */}
          <section className="lg:col-span-9 space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KPI label={\`Aberto — \${monthName(selectedMonth)}\`} value={BRL.format(totalMesAberto)} />
              <KPI label={\`Pago — \${monthName(selectedMonth)}\`} value={BRL.format(totalMesPago)} />
              <KPI label="Atrasado" value={BRL.format(totalAtrasado)} />
              <KPI label="Futuro (aberto)" value={BRL.format(totalFuturo)} />
            </div>

            {/* Form Novo/Editar */}
            <div className="rounded-2xl shadow p-4 border theme-border theme-card">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-5 h-5" />
                <h3 className="font-semibold">{editing ? "Editar lançamento" : "Novo lançamento"}</h3>
                {person && <span className="ml-auto text-sm theme-muted">Pessoa: <b style={{ color: "var(--text)" }}>{person.name}</b></span>}
              </div>
              <form onSubmit={submitForm} className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <input
                  className="md:col-span-2 px-3 py-2 rounded-xl border theme-border"
                  placeholder="Descrição (ex: Supermercado)"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />
                <input
                  type="number" step="0.01" min="0"
                  className="px-3 py-2 rounded-xl border theme-border"
                  placeholder="Valor (parcela)"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />
                <select
                  className="px-3 py-2 rounded-xl border theme-border"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  style={{ background: "var(--card)", color: "var(--text)" }}
                >
                  <option value="vista">À vista (1x)</option>
                  <option value="parcelado">Parcelado</option>
                </select>
                {form.type === "parcelado" && (
                  <>
                    <input
                      type="number" min="2"
                      className="px-3 py-2 rounded-xl border theme-border"
                      placeholder="Total parcelas"
                      value={form.totalInstallments}
                      onChange={(e) => {
                        const total = Math.max(2, Number(e.target.value || 2));
                        const current = Math.min(Math.max(1, Number(form.currentInstallment || 1)), total);
                        setForm({ ...form, totalInstallments: total, currentInstallment: current });
                      }}
                      style={{ background: "var(--card)", color: "var(--text)" }}
                    />
                    <input
                      type="number" min="1"
                      className="px-3 py-2 rounded-xl border theme-border"
                      placeholder="Parcela atual (ex: 4)"
                      value={form.currentInstallment}
                      onChange={(e) => {
                        const current = Math.max(1, Number(e.target.value || 1));
                        const safe = Math.min(current, Number(form.totalInstallments || current));
                        setForm({ ...form, currentInstallment: safe });
                      }}
                      style={{ background: "var(--card)", color: "var(--text)" }}
                    />
                  </>
                )}
                <input
                  type="month"
                  className="px-3 py-2 rounded-xl border theme-border"
                  value={form.dueYm}
                  onChange={(e) => setForm({ ...form, dueYm: e.target.value })}
                  title="Competência / vencimento"
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />
                <input
                  type="date"
                  className="px-3 py-2 rounded-xl border theme-border"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  title="Data do lançamento"
                  style={{ background: "var(--card)", color: "var(--text)" }}
                />

                {form.type === "parcelado" && (
                  <div className="md:col-span-6 flex items-center gap-2">
                    <input
                      id="auto-gen"
                      type="checkbox"
                      checked={form.autoGenerateRemaining}
                      onChange={(e) => setForm({ ...form, autoGenerateRemaining: e.target.checked })}
                    />
                    <label htmlFor="auto-gen" className="text-sm">Gerar automaticamente as <b>próximas parcelas</b> a partir deste mês</label>
                  </div>
                )}

                <div className="md:col-span-6 flex gap-2 justify-end">
                  {editing && (
                    <button type="button" className="px-3 py-2 rounded-xl border theme-border" onClick={() => { setEditing(null); resetForm(); }}>
                      Cancelar edição
                    </button>
                  )}
                  <button className="px-3 py-2 rounded-xl text-white" style={{ background: "var(--text)" }}>{editing ? "Salvar" : "Adicionar"}</button>
                </div>
              </form>
            </div>

            {/* Lista de lançamentos */}
            <div className="rounded-2xl shadow border theme-border theme-card">
              <div className="px-4 py-3 border-b theme-border font-medium flex items-center">
                <span>Lançamentos de {monthName(selectedMonth)}</span>
                <button onClick={exportPdf} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl border theme-border" title="Exportar mês atual para PDF">
                  <Download className="w-4 h-4" /> Exportar PDF
                </button>
              </div>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead style={{ background: "var(--bg)" }}>
                    <tr>
                      <th className="text-left px-4 py-2">Data</th>
                      <th className="text-left px-4 py-2">Descrição</th>
                      <th className="text-left px-4 py-2">Tipo</th>
                      <th className="text-right px-4 py-2">Valor</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center theme-muted" colSpan={6}>Sem lançamentos para este filtro.</td>
                      </tr>
                    )}
                    {filteredTx.map((t) => (
                      <tr key={t.id} className="border-t theme-border">
                        <td className="px-4 py-2">{t.date}</td>
                        <td className="px-4 py-2">{t.description}</td>
                        <td className="px-4 py-2">{t.type === 'parcelado' ? `${t.installmentNumber}/${t.totalInstallments}` : 'À vista'}</td>
                        <td className="px-4 py-2 text-right">{BRL.format(Number(t.amount || 0))}</td>
                        <td className="px-4 py-2">
                          <span className={\`px-2 py-1 rounded text-xs \${t.status === 'pago' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}\`}>
                            {t.status === 'pago' ? 'Pago' : 'Em aberto'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {t.status !== 'pago' ? (
                            <button className="inline-flex items-center gap-1 px-2 py-1 rounded border theme-border mr-2" onClick={() => updateTransaction(t.id, { status: 'pago' })}>
                              <CheckCircle2 className="w-4 h-4" /> Pagar
                            </button>
                          ) : (
                            <button className="inline-flex items-center gap-1 px-2 py-1 rounded border theme-border mr-2" onClick={() => updateTransaction(t.id, { status: 'aberto' })}>
                              <Undo2 className="w-4 h-4" /> Reabrir
                            </button>
                          )}
                          <button className="inline-flex items-center gap-1 px-2 py-1 rounded border theme-border mr-2" onClick={() => startEdit(t)}>
                            <Edit3 className="w-4 h-4" /> Editar
                          </button>
                          <button className="inline-flex items-center gap-1 px-2 py-1 rounded border theme-border" onClick={() => deleteTransaction(t.id)}>
                            <Trash2 className="w-4 h-4" /> Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl shadow p-4 theme-card border theme-border">
                <div className="font-medium mb-2">Projeção (próx. 6 meses)</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(v) => BRL.format(v)} />
                      <Legend />
                      <Bar dataKey="Aberto" />
                      <Bar dataKey="Pago" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl shadow p-4 theme-card border theme-border">
                <div className="font-medium mb-2">Aberto por pessoa ({monthName(selectedMonth)})</div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label>
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => BRL.format(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div className="rounded-2xl shadow p-4 border theme-border theme-card">
      <div className="text-xs theme-muted mb-1">{label}</div>
      <div className="text-lg font-semibold" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}
