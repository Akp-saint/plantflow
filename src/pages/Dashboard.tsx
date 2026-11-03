import { useState, useMemo, type ReactNode } from 'react';
import { 
  Boxes, CircleDollarSign, Factory, TriangleAlert, WalletCards, 
  TrendingUp, ArrowUpRight, ArrowDownRight, Layers, ShieldCheck, 
  Activity, Clock, ChevronRight, CheckCircle2, AlertCircle, Sparkles
} from 'lucide-react';
import { LoadingOrEmpty, PageHeader, useApiQuery } from '../components/ui';
import { payloadData } from '../lib/api';
import { money, quantity } from '../lib/format';

type Dashboard = {
  period: { from: string | null; to: string | null };
  production: { produced: number; damaged: number; byBrickSize: Array<{ name: string; unit: string; quantityProduced: number; quantityDamaged: number }> };
  inventory: { materials: Array<{ id: string; name: string; unit: string; onHand: number; lowStockAt: number; lowStock: boolean }>; finishedGoods: Array<{ id: string; name: string; unit: string; onHand: number }>; lowStockMaterialCount: number };
  sales: { total: number; outstanding: number; saleCount: number };
  purchases: { total: number; outstanding: number; purchaseCount: number };
  expenses: { total: number; expenseCount: number };
  cash: { accounts: Array<{ id: string; name: string; balance: number }> };
  recentActivity: Array<{ id: string; kind: string; title: string; detail: string; date: string; amount: number | null }>;
};

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DashboardPage() {
  const today = new Date();
  const [from, setFrom] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDate(today));
  const queryString = new URLSearchParams({ from, to }).toString();
  const query = useApiQuery<{ data: Dashboard }>(`/api/v1/dashboard?${queryString}`);
  const report = query.data ? payloadData<Dashboard>(query.data) : null;
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  
  const cashBalance = report?.cash.accounts.reduce((sum, account) => sum + Number(account.balance), 0) ?? 0;
  const netProduced = (report?.production.produced ?? 0) - (report?.production.damaged ?? 0);
  const totalStockUnits = report?.inventory.finishedGoods.reduce((sum, item) => sum + Number(item.onHand), 0) ?? 0;
  const scrapRate = report?.production.produced 
    ? ((report.production.damaged / report.production.produced) * 100).toFixed(1) 
    : '0.0';

  return (
    <div className="cockpit-container">
      {/* Top Banner Cockpit Controls */}
      <div className="cockpit-header">
        <div className="cockpit-title-zone">
          <div className="cockpit-status-tag">
            <span className="live-pulse" />
            <span>SYSTÈME USINE OPÉRATIONNEL</span>
          </div>
          <h1>Cockpit de Commandement</h1>
          <p>Supervision de production en direct, stocks de granulats et flux de trésorerie.</p>
        </div>

        {/* Date Filter Bar */}
        <div className="cockpit-filter-glass">
          <div className="filter-input-wrap">
            <span>Période du</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <span className="filter-separator">→</span>
          <div className="filter-input-wrap">
            <span>au</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <LoadingOrEmpty loading={query.loading} error={query.error}>
        {report && (
          <>
            {/* KPI TOP METRICS (Cockpit Neon Glass Cards) */}
            <section className="cockpit-metrics-grid">
              {/* Metric 1: Production Nette */}
              <div className="cockpit-card metric-glass-card orange-accent">
                <div className="metric-header-row">
                  <span className="metric-label">Production Nette</span>
                  <div className="cockpit-icon-wrap orange">
                    <Factory size={18} />
                  </div>
                </div>
                <div className="metric-big-number">
                  {quantity(netProduced)}
                  <small>briques</small>
                </div>
                <div className="metric-sub-detail positive">
                  <TrendingUp size={13} />
                  <span>Casse maîtrisée : {scrapRate}% ({quantity(report.production.damaged)} u)</span>
                </div>
                <div className="metric-progress-glow">
                  <div className="progress-bar orange" style={{ width: `${Math.min(100, Math.max(15, (netProduced / 10000) * 100))}%` }} />
                </div>
              </div>

              {/* Metric 2: Stock Produits Finis */}
              <div className="cockpit-card metric-glass-card cyan-accent">
                <div className="metric-header-row">
                  <span className="metric-label">Parc à Briques (Dispo)</span>
                  <div className="cockpit-icon-wrap cyan">
                    <Boxes size={18} />
                  </div>
                </div>
                <div className="metric-big-number">
                  {quantity(totalStockUnits)}
                  <small>palettes & lots</small>
                </div>
                <div className="metric-sub-detail neutral">
                  <Layers size={13} />
                  <span>{report.production.byBrickSize.length || 3} formats en rotation usine</span>
                </div>
                <div className="metric-progress-glow">
                  <div className="progress-bar cyan" style={{ width: '68%' }} />
                </div>
              </div>

              {/* Metric 3: Solde Caisse Instantané */}
              <div className="cockpit-card metric-glass-card green-accent">
                <div className="metric-header-row">
                  <span className="metric-label">Trésorerie Disponible</span>
                  <div className="cockpit-icon-wrap green">
                    <CircleDollarSign size={18} />
                  </div>
                </div>
                <div className="metric-big-number">
                  {money(cashBalance, currency)}
                </div>
                <div className="metric-sub-detail positive">
                  <ArrowUpRight size={13} />
                  <span>{report.cash.accounts.length} caisses et comptes physiques</span>
                </div>
                <div className="metric-progress-glow">
                  <div className="progress-bar green" style={{ width: '85%' }} />
                </div>
              </div>

              {/* Metric 4: Créances Clients */}
              <div className="cockpit-card metric-glass-card purple-accent">
                <div className="metric-header-row">
                  <span className="metric-label">Créances à Recouvrer</span>
                  <div className="cockpit-icon-wrap purple">
                    <WalletCards size={18} />
                  </div>
                </div>
                <div className="metric-big-number">
                  {money(report.sales.outstanding, currency)}
                </div>
                <div className="metric-sub-detail warning">
                  <AlertCircle size={13} />
                  <span>Sur {report.sales.saleCount} commandes clients enregistrées</span>
                </div>
                <div className="metric-progress-glow">
                  <div className="progress-bar purple" style={{ width: `${report.sales.outstanding > 0 ? 55 : 5}%` }} />
                </div>
              </div>
            </section>

            {/* MAIN OPERATIONAL SPLIT GRID */}
            <div className="cockpit-main-layout">
              {/* Left Column: Cadence de Production & Stock Silos */}
              <div className="cockpit-left-col">
                {/* Format Output Card */}
                <div className="cockpit-card format-breakdown-card">
                  <div className="cockpit-card-head">
                    <div>
                      <h2>Cadence de Presse & Formats Fabriqués</h2>
                      <p>Répartition des cadences et ratios de solidité par moule</p>
                    </div>
                    <span className="chip-badge">Moules actifs</span>
                  </div>

                  {report.production.byBrickSize.length > 0 ? (
                    <div className="format-bars-list">
                      {report.production.byBrickSize.map((item, idx) => {
                        const total = item.quantityProduced + item.quantityDamaged;
                        const pct = total > 0 ? Math.round((item.quantityProduced / total) * 100) : 100;
                        return (
                          <div key={item.name} className="format-row-cockpit">
                            <div className="format-row-top">
                              <div className="format-name-box">
                                <span className={`format-dot color-${idx % 3}`} />
                                <strong>{item.name}</strong>
                              </div>
                              <div className="format-quantities">
                                <strong>{quantity(item.quantityProduced)} <small>{item.unit || 'unités'}</small></strong>
                                {item.quantityDamaged > 0 && (
                                  <span className="scrap-tag">({quantity(item.quantityDamaged)} rebuts)</span>
                                )}
                              </div>
                            </div>
                            <div className="format-track">
                              <div className={`format-fill color-${idx % 3}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-cockpit-block">
                      <Factory size={28} />
                      <p>Aucune session de presse enregistrée sur cette période.</p>
                    </div>
                  )}
                </div>

                {/* Silos & Granulats Gauges (Visual Stock de Matières) */}
                <div className="cockpit-card silos-card">
                  <div className="cockpit-card-head">
                    <div>
                      <h2>Niveaux Silos & Matières Premières</h2>
                      <p>Surveillance des seuils critiques (Ciment, Sable, Gravier)</p>
                    </div>
                  </div>

                  <div className="silos-grid">
                    {report.inventory.materials.map((mat) => {
                      const onHand = Number(mat.onHand);
                      const threshold = Number(mat.lowStockAt);
                      const isLow = mat.lowStock || onHand <= threshold;
                      const fillPct = threshold > 0 ? Math.min(100, Math.round((onHand / (threshold * 3)) * 100)) : 70;

                      return (
                        <div key={mat.id} className={`silo-gauge-item ${isLow ? 'silo-alert' : ''}`}>
                          <div className="silo-gauge-ring">
                            <div className="silo-tank-visual">
                              <div className={`silo-liquid ${isLow ? 'liquid-danger' : 'liquid-normal'}`} style={{ height: `${Math.max(12, fillPct)}%` }} />
                            </div>
                          </div>
                          <div className="silo-info">
                            <strong>{mat.name}</strong>
                            <div className="silo-figures">
                              <span className="current-level">{quantity(onHand)} {mat.unit}</span>
                              <span className="threshold-level">Seuil : {quantity(threshold)}</span>
                            </div>
                            {isLow ? (
                              <span className="silo-badge-warning">Réapprovisionner</span>
                            ) : (
                              <span className="silo-badge-ok">Stock suffisant</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Flux de Caisse & Journal des Opérations */}
              <div className="cockpit-right-col">
                {/* Cash Accounts Card */}
                <div className="cockpit-card cash-cockpit-card">
                  <div className="cockpit-card-head">
                    <div>
                      <h2>Comptes de Caisse & Coffres</h2>
                      <p>Disponibilités immédiates pour l'usine</p>
                    </div>
                  </div>

                  <div className="cash-accounts-list">
                    {report.cash.accounts.map((acc) => (
                      <div key={acc.id} className="cash-account-row">
                        <div className="acc-meta">
                          <div className="acc-icon-box">
                            <CircleDollarSign size={16} />
                          </div>
                          <strong>{acc.name}</strong>
                        </div>
                        <div className="acc-balance">
                          <strong>{money(acc.balance, currency)}</strong>
                        </div>
                      </div>
                    ))}
                    <div className="cash-total-banner">
                      <span>Total Liquidités</span>
                      <strong>{money(cashBalance, currency)}</strong>
                    </div>
                  </div>
                </div>

                {/* Real-time Activity Timeline */}
                <div className="cockpit-card activity-cockpit-card">
                  <div className="cockpit-card-head">
                    <div>
                      <h2>Journal d'Opérations en Direct</h2>
                      <p>Dernières sorties camions, ventes et approvisionnements</p>
                    </div>
                    <Activity size={16} className="activity-pulse-icon" />
                  </div>

                  {report.recentActivity.length > 0 ? (
                    <div className="timeline-cockpit">
                      {report.recentActivity.map((act) => {
                        const isSale = act.kind === 'sale';
                        const isExpense = act.kind === 'expense';
                        const isPurchase = act.kind === 'purchase';

                        return (
                          <div key={`${act.kind}-${act.id}`} className={`timeline-entry ${act.kind}`}>
                            <div className="timeline-marker" />
                            <div className="timeline-content">
                              <div className="timeline-top">
                                <strong>{act.title}</strong>
                                <time>{new Date(act.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</time>
                              </div>
                              <p>{act.detail}</p>
                              {act.amount !== null && (
                                <div className={`timeline-amount ${isSale ? 'positive-cash' : 'negative-cash'}`}>
                                  {isSale ? '+' : '-'} {money(act.amount, currency)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-cockpit-block">
                      <Clock size={28} />
                      <p>Aucune transaction enregistrée récemment.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </LoadingOrEmpty>
    </div>
  );
}
