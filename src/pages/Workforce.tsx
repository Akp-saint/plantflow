import { useState, type FormEvent } from 'react';
import { UsersRound } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, StatusPill, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { money, quantity, shortDate } from '../lib/format';

const methods = [['CASH', 'Espèces'], ['BANK', 'Banque'], ['MOBILE_MONEY', 'Mobile Money'], ['OTHER', 'Autre']];
type Worker = { id: string; name: string; jobTitle?: string | null; phone?: string | null; outstanding: number };
type Entry = { id: string; workDate: string; amount: number; quantity?: number | null; worker?: Worker | null; workerId?: string | null; teamName?: string | null; production?: { id: string } | null; payments?: Array<{ amount: number }> };
type Production = { id: string; productionDate: string; quantityProduced: number; brickSize: { name: string } };
type Account = { id: string; name: string };

export default function WorkforcePage() {
  const workers = useApiQuery<unknown>('/api/v1/workers');
  const entries = useApiQuery<unknown>('/api/v1/labour-entries');
  const production = useApiQuery<unknown>('/api/v1/production-entries');
  const accounts = useApiQuery<unknown>('/api/v1/cashiers');
  const [dialog, setDialog] = useState<'worker' | 'entry' | 'payment' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const workerRows = workers.data ? payloadList<Worker>(workers.data) : [];
  const entryRows = entries.data ? payloadList<Entry>(entries.data) : [];
  const productionRows = production.data ? payloadList<Production>(production.data) : [];
  const accountRows = accounts.data ? payloadList<Account>(accounts.data) : [];
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  const refresh = () => { workers.reload(); entries.reload(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      if (dialog === 'worker') {
        await apiRequest('/api/v1/workers', { method: 'POST', body: JSON.stringify({ name: values.get('name'), jobTitle: values.get('jobTitle') || null, phone: values.get('phone') || null }) });
        setSuccess('Travailleur ajouté.');
      } else if (dialog === 'entry') {
        const target = values.get('target');
        const body = { ...(target === 'worker' ? { workerId: values.get('workerId') } : { teamName: values.get('teamName') }), workDate: values.get('workDate'), amount: Number(values.get('amount')), quantity: values.get('quantity') ? Number(values.get('quantity')) : undefined, productionId: values.get('productionId') || undefined, notes: values.get('notes') || undefined };
        await apiRequest('/api/v1/labour-entries', { method: 'POST', body: JSON.stringify(body) });
        setSuccess('Entrée de main-d’œuvre enregistrée.');
      } else if (dialog === 'payment') {
        if (!values.get('cashAccountId')) throw new Error('Choisissez le compte de caisse qui finance ce paiement.');
        const target = values.get('target');
        const body = { ...(target === 'worker' ? { workerId: values.get('workerId') } : { labourEntryId: values.get('labourEntryId') }), amount: Number(values.get('amount')), method: values.get('method'), paidAt: values.get('paidAt'), cashAccountId: values.get('cashAccountId') || null, note: values.get('note') || undefined };
        await apiRequest('/api/v1/labour-payments', { method: 'POST', body: JSON.stringify(body) });
        setSuccess('Paiement enregistré et relié au dû sélectionné.');
      }
      form.reset(); setDialog(null); refresh();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Ressources / Main-d’œuvre" title="Main-d’œuvre" description="Suivez le travail effectué, les montants dus et les paiements." action={() => { setError(''); setDialog('entry'); }} actionLabel="Nouvelle entrée" />
    <div className="toolbar-right stock-actions"><button className="secondary-button" onClick={() => { setError(''); setDialog('worker'); }}>Ajouter un travailleur</button><button className="secondary-button" onClick={() => { setError(''); setDialog('payment'); }}>Payer un dû</button></div>
    <Notice error={error} success={success} />
    <section className="metric-grid compact"><div className="metric-card"><div className="metric-icon blue"><UsersRound size={19} /></div><div className="metric-top"><span>Travailleurs actifs</span></div><div className="metric-value">{workerRows.length}</div><div className="metric-helper">Dans l’usine sélectionnée</div></div><div className="metric-card"><div className="metric-top"><span>Montants dus</span></div><div className="metric-value">{money(workerRows.reduce((sum, worker) => sum + Math.max(0, Number(worker.outstanding)), 0), currency)}</div><div className="metric-helper">Calculés à partir des entrées et paiements</div></div><div className="metric-card"><div className="metric-top"><span>Entrées récentes</span></div><div className="metric-value">{entryRows.length}</div><div className="metric-helper">Registre visible pour cette usine</div></div></section>
    <div className="panel table-panel"><div className="table-heading"><div><h2>Entrées de main-d’œuvre</h2><p>Chaque entrée peut être associée à un travailleur, une équipe et une production.</p></div></div><LoadingOrEmpty loading={entries.loading || workers.loading || production.loading || accounts.loading} error={entries.error || workers.error || production.error || accounts.error} empty={!entryRows.length}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Personne / équipe</th><th>Production</th><th>Quantité</th><th>Montant dû</th><th>Réglé</th><th>État</th></tr></thead><tbody>{entryRows.map((entry) => { const paid = entry.payments?.reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0; const due = Math.max(0, Number(entry.amount) - paid); return <tr key={entry.id}><td>{shortDate(entry.workDate)}</td><td><strong>{entry.worker?.name ?? entry.teamName ?? '—'}</strong></td><td>{entry.production?.id ? 'Production associée' : '—'}</td><td>{entry.quantity ? quantity(entry.quantity) : '—'}</td><td className="number-cell">{money(entry.amount, currency)}</td><td className="number-cell">{money(paid, currency)}</td><td><StatusPill tone={due > 0 ? 'warning' : 'success'}>{due > 0 ? `Dû ${money(due, currency)}` : 'Soldé'}</StatusPill></td></tr>; })}</tbody></table></div></LoadingOrEmpty></div>
    {dialog && <Modal title={dialog === 'worker' ? 'Ajouter un travailleur' : dialog === 'payment' ? 'Enregistrer un paiement' : 'Saisir une entrée de travail'} description={dialog === 'entry' ? 'La rémunération reste due jusqu’à la saisie d’un paiement.' : undefined} onClose={() => setDialog(null)}>
      <form onSubmit={submit}>
        {dialog === 'worker' && <div className="form-grid"><label>Nom<input name="name" required minLength={2} maxLength={120} /></label><label>Poste<input name="jobTitle" maxLength={80} /></label><label>Téléphone<input name="phone" maxLength={32} /></label></div>}
        {dialog === 'entry' && <div className="form-grid"><label>Attribuer à<select name="target" defaultValue="worker"><option value="worker">Un travailleur</option><option value="team">Une équipe</option></select></label><label>Travailleur<select name="workerId" defaultValue=""><option value="">Choisir un travailleur</option>{workerRows.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><label>Nom d’équipe<input name="teamName" placeholder="Ex. Équipe moulage" /></label><label>Date de travail<input name="workDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Montant dû<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Quantité (facultative)<input name="quantity" type="number" min="0.001" step="0.001" /></label><label>Production associée<select name="productionId" defaultValue=""><option value="">Aucune</option>{productionRows.map((item) => <option key={item.id} value={item.id}>{shortDate(item.productionDate)} · {item.brickSize?.name} · {quantity(item.quantityProduced)}</option>)}</select></label><label className="form-span">Notes<input name="notes" maxLength={1000} /></label></div>}
        {dialog === 'payment' && <div className="form-grid"><label>Mode de règlement<select name="target" defaultValue="worker"><option value="worker">Paiement travailleur</option><option value="entry">Paiement d’une entrée/équipe</option></select></label><label>Travailleur<select name="workerId" defaultValue=""><option value="">Choisir</option>{workerRows.filter((worker) => Number(worker.outstanding) > 0).map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · dû {money(worker.outstanding, currency)}</option>)}</select></label><label>Entrée de travail<select name="labourEntryId" defaultValue=""><option value="">Choisir une entrée</option>{entryRows.map((entry) => <option key={entry.id} value={entry.id}>{entry.worker?.name ?? entry.teamName} · {shortDate(entry.workDate)} · {money(entry.amount, currency)}</option>)}</select></label><label>Montant payé<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date de paiement<input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Mode<select name="method" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Compte de caisse<select name="cashAccountId" defaultValue=""><option value="">Non affecté</option>{accountRows.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="form-span">Note<input name="note" maxLength={1000} /></label></div>}
        <FormActions onCancel={() => setDialog(null)} saving={saving} />
      </form>
    </Modal>}
  </>;
}
