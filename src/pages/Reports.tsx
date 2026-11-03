import { useState, type ReactNode } from 'react';
import { Boxes, CircleDollarSign, Factory, WalletCards } from 'lucide-react';
import { LoadingOrEmpty, PageHeader, useApiQuery } from '../components/ui';
import { payloadData } from '../lib/api';
import { money, quantity } from '../lib/format';

type Production = { produced: number; damaged: number; byBrickSize: Array<{ name: string; quantityProduced: number; quantityDamaged: number }> };
type Inventory = { materials: Array<{ name: string; onHand: number; unit: string; lowStock: boolean }>; finishedGoods: Array<{ name: string; onHand: number; unit: string }> };
type Sales = { total: number; outstanding: number; saleCount: number };
type Expenses = { total: number; expenseCount: number; byCategory: Array<{ category: string; amount: number }> };

export default function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const suffix = from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : '';
  const production = useApiQuery<{ data: Production }>(`/api/v1/reports/production${suffix}`);
  const inventory = useApiQuery<{ data: Inventory }>(`/api/v1/reports/inventory${suffix}`);
  const sales = useApiQuery<{ data: Sales }>(`/api/v1/reports/sales${suffix}`);
  const expenses = useApiQuery<{ data: Expenses }>(`/api/v1/reports/expenses${suffix}`);
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  const prod = production.data ? payloadData<Production>(production.data) : null;
  const inv = inventory.data ? payloadData<Inventory>(inventory.data) : null;
  const sale = sales.data ? payloadData<Sales>(sales.data) : null;
  const spend = expenses.data ? payloadData<Expenses>(expenses.data) : null;
  const loading = production.loading || inventory.loading || sales.loading || expenses.loading;
  const error = production.error || inventory.error || sales.error || expenses.error;
  function exportCsv() {
    const rows = [['Domaine', 'Indicateur', 'Valeur'], ['Production', 'Briques produites', String(prod?.produced ?? 0)], ['Production', 'Briques endommagées', String(prod?.damaged ?? 0)], ['Ventes', 'Total', String(sale?.total ?? 0)], ['Ventes', 'Créances', String(sale?.outstanding ?? 0)], ['Dépenses', 'Total', String(spend?.total ?? 0)]];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'plantflow-rapport.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <>
    <PageHeader eyebrow="Pilotage" title="Rapports" description="Les chiffres sont issus de l’usine et de la période choisies." action={exportCsv} actionLabel="Exporter CSV" />
    <div className="panel report-filter"><div className="form-grid"><label>Du<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Au<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><div className="filter-hint">Les dates filtrent ventes, dépenses et production. Le stock reflète les mouvements jusqu’à la date de fin.</div></div></div>
    <LoadingOrEmpty loading={loading} error={error}>
      <section className="report-grid real-report-grid">
        <ReportCard title="Production" icon={<Factory size={18} />} values={[[`Produites`, quantity(prod?.produced)], ['Endommagées', quantity(prod?.damaged)], ['Formats suivis', String(prod?.byBrickSize.length ?? 0)]]} />
        <ReportCard title="Inventaire" icon={<Boxes size={18} />} values={[[`Matières`, String(inv?.materials.length ?? 0)], ['Matières sous seuil', String(inv?.materials.filter((item) => item.lowStock).length ?? 0)], ['Formats finis', String(inv?.finishedGoods.length ?? 0)]]} />
        <ReportCard title="Ventes" icon={<CircleDollarSign size={18} />} values={[[`Chiffre d’affaires`, money(sale?.total, currency)], ['Créances', money(sale?.outstanding, currency)], ['Factures', String(sale?.saleCount ?? 0)]]} />
        <ReportCard title="Dépenses" icon={<WalletCards size={18} />} values={[[`Total`, money(spend?.total, currency)], ['Écritures', String(spend?.expenseCount ?? 0)], ['Catégories', String(spend?.byCategory.length ?? 0)]]} />
      </section>
      <div className="panel table-panel report-breakdown"><div className="table-heading"><div><h2>Détail par format et catégorie</h2><p>Résumé issu des agrégats de l’API.</p></div></div><div className="simple-table">{prod?.byBrickSize.map((item) => <div key={item.name}><span>Production · {item.name}</span><strong>{quantity(item.quantityProduced)} produites</strong><span>{quantity(item.quantityDamaged)} endommagées</span></div>)}{spend?.byCategory.map((item) => <div key={item.category}><span>Dépenses · {item.category}</span><strong>{money(item.amount, currency)}</strong><span>Catégorie</span></div>)}{!prod?.byBrickSize.length && !spend?.byCategory.length && <div className="panel-empty">Aucun détail disponible pour cette période.</div>}</div></div>
    </LoadingOrEmpty>
  </>;
}

function ReportCard({ title, icon, values }: { title: string; icon: ReactNode; values: string[][] }) {
  return <section className="panel report-card-real"><span className="report-icon blue">{icon}</span><h2>{title}</h2>{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>;
}
