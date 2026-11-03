import { useState, type FormEvent } from 'react';
import { WalletCards } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { money, shortDate } from '../lib/format';

const methods = [['CASH', 'Espèces'], ['BANK', 'Banque'], ['MOBILE_MONEY', 'Mobile Money'], ['OTHER', 'Autre']];
type Category = { id: string; name: string };
type Account = { id: string; name: string };
type Expense = { id: string; description: string; amount: number; expenseDate: string; paymentMethod: string; notes?: string | null; category: Category; cashAccount: Account };
type Report = { total: number; expenseCount: number; byCategory: Array<{ category: string; amount: number; expenseCount: number }> };

export default function ExpensesPage() {
  const expenses = useApiQuery<unknown>('/api/v1/expenses');
  const categories = useApiQuery<unknown>('/api/v1/expense-categories');
  const accounts = useApiQuery<unknown>('/api/v1/cashiers');
  const report = useApiQuery<{ data: Report }>('/api/v1/reports/expenses');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const rows = expenses.data ? payloadList<Expense>(expenses.data) : [];
  const categoryRows = categories.data ? payloadList<Category>(categories.data) : [];
  const accountRows = accounts.data ? payloadList<Account>(accounts.data) : [];
  const totals = report.data ? payloadData<Report>(report.data) : null;
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest('/api/v1/expenses', { method: 'POST', body: JSON.stringify({ categoryId: values.get('categoryId'), cashAccountId: values.get('cashAccountId'), description: values.get('description'), amount: Number(values.get('amount')), paymentMethod: values.get('paymentMethod'), expenseDate: values.get('expenseDate'), notes: values.get('notes') || undefined }) });
      setOpen(false); setSuccess('Dépense enregistrée et mouvement de caisse associé.'); form.reset(); expenses.reload(); report.reload();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Finance / Sorties" title="Dépenses" description="Chaque sortie est datée, catégorisée et reliée à un compte de l’usine." action={() => { setError(''); setOpen(true); }} actionLabel="Nouvelle dépense" />
    <Notice error={error} success={success} />
    <section className="expense-banner real-expense-banner"><div><span>Dépenses enregistrées</span><strong>{money(totals?.total ?? 0, currency)}</strong><p>{totals?.expenseCount ?? 0} écriture(s) · période actuelle</p></div><div className="expense-category-list">{totals?.byCategory?.length ? totals.byCategory.map((item) => <div key={item.category}><span>{item.category}</span><b>{money(item.amount, currency)}</b></div>) : <span>Les totaux par catégorie apparaîtront avec les premières écritures.</span>}</div></section>
    <div className="panel table-panel"><div className="table-heading"><div><h2>Journal des dépenses</h2><p>Les écritures sont persistées dans PostgreSQL et auditables.</p></div></div><LoadingOrEmpty loading={expenses.loading || categories.loading || accounts.loading || report.loading} error={expenses.error || categories.error || accounts.error || report.error} empty={!rows.length}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th>Catégorie</th><th>Compte</th><th>Mode</th><th>Montant</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{shortDate(item.expenseDate)}</td><td><strong>{item.description}</strong></td><td>{item.category?.name}</td><td>{item.cashAccount?.name}</td><td>{item.paymentMethod}</td><td className="number-cell">{money(item.amount, currency)}</td></tr>)}</tbody></table></div></LoadingOrEmpty></div>
    {open && <Modal title="Enregistrer une dépense" description="Le montant sera comptabilisé comme sortie du compte sélectionné." onClose={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><label>Date<input name="expenseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Catégorie<select name="categoryId" required defaultValue=""><option value="" disabled>Choisir</option>{categoryRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-span">Description<input name="description" required minLength={1} maxLength={240} /></label><label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Compte de sortie<select name="cashAccountId" required defaultValue=""><option value="" disabled>Choisir un compte</option>{accountRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Mode de paiement<select name="paymentMethod" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-span">Notes<textarea name="notes" rows={2} maxLength={1000} /></label></div><FormActions onCancel={() => setOpen(false)} saving={saving} /></form></Modal>}
  </>;
}
