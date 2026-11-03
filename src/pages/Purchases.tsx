import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, StatusPill, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { money, quantity, shortDate } from '../lib/format';

const methods = [['CASH', 'Espèces'], ['BANK', 'Banque'], ['MOBILE_MONEY', 'Mobile Money'], ['OTHER', 'Autre']];
type Contact = { id: string; name: string; phone?: string | null; email?: string | null };
type Material = { id: string; name: string; unit: string; active: boolean };
type Account = { id: string; name: string };
type Purchase = { id: string; reference: string; purchaseDate: string; totalAmount: number; paidAmount: number; balanceDue: number; vendor: Contact; items: Array<{ material: Material; quantity: number }> };

export default function PurchasesPage() {
  const purchases = useApiQuery<unknown>('/api/v1/purchases');
  const vendors = useApiQuery<unknown>('/api/v1/vendors');
  const materials = useApiQuery<unknown>('/api/v1/materials');
  const accounts = useApiQuery<unknown>('/api/v1/cashiers');
  const [dialog, setDialog] = useState<'purchase' | 'vendor' | 'payment' | null>(null);
  const [activePurchase, setActivePurchase] = useState<Purchase | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const rows = purchases.data ? payloadList<Purchase>(purchases.data) : [];
  const vendorRows = vendors.data ? payloadList<Contact>(vendors.data) : [];
  const materialRows = materials.data ? payloadList<Material>(materials.data).filter((item) => item.active) : [];
  const accountRows = accounts.data ? payloadList<Account>(accounts.data) : [];
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  const refresh = () => { purchases.reload(); vendors.reload(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      if (dialog === 'vendor') {
        await apiRequest('/api/v1/vendors', { method: 'POST', body: JSON.stringify({ name: values.get('name'), phone: values.get('phone') || null, email: values.get('email') || null, address: values.get('address') || null }) });
        setSuccess('Fournisseur ajouté.');
      } else if (dialog === 'purchase') {
        const initialAmount = Number(values.get('initialPayment') || 0);
        if (initialAmount > 0 && !values.get('cashAccountId')) throw new Error('Choisissez le compte utilisé pour le paiement initial.');
        await apiRequest('/api/v1/purchases', { method: 'POST', body: JSON.stringify({ vendorId: values.get('vendorId'), reference: values.get('reference'), purchaseDate: values.get('purchaseDate'), notes: values.get('notes') || undefined, items: [{ materialId: values.get('materialId'), quantity: Number(values.get('quantity')), unitCost: Number(values.get('unitCost')) }], ...(initialAmount > 0 ? { initialPayment: { amount: initialAmount, method: values.get('method'), cashAccountId: values.get('cashAccountId') || null } } : {}) }) });
        setSuccess('Achat enregistré; les matières ont été ajoutées au stock.');
      } else if (dialog === 'payment' && activePurchase) {
        if (!values.get('cashAccountId')) throw new Error('Choisissez le compte utilisé pour ce paiement.');
        await apiRequest(`/api/v1/purchases/${activePurchase.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number(values.get('amount')), method: values.get('method'), cashAccountId: values.get('cashAccountId') || null, note: values.get('note') || undefined }) });
        setSuccess('Paiement fournisseur ajouté.');
      }
      form.reset(); setDialog(null); setActivePurchase(null); refresh();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Approvisionnement" title="Achats & fournisseurs" description="Enregistrez les matières reçues et suivez les dettes fournisseur." action={() => { setError(''); setDialog('purchase'); }} actionLabel="Nouvel achat" />
    <div className="toolbar-right stock-actions"><button className="secondary-button" onClick={() => { setError(''); setDialog('vendor'); }}><Plus size={15} /> Nouveau fournisseur</button></div>
    <Notice error={error} success={success} />
    <div className="panel table-panel"><div className="table-heading"><div><h2>Registre des achats</h2><p>Les montants réglés et les soldes proviennent des paiements enregistrés.</p></div><span className="record-count">{rows.length} achat(s)</span></div>
      <LoadingOrEmpty loading={purchases.loading || vendors.loading || materials.loading || accounts.loading} error={purchases.error || vendors.error || materials.error || accounts.error} empty={!rows.length}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Référence</th><th>Fournisseur</th><th>Date</th><th>Matières reçues</th><th>Total</th><th>Réglé</th><th>Solde</th><th>Action</th></tr></thead><tbody>{rows.map((purchase) => <tr key={purchase.id}><td><strong className="mono">{purchase.reference}</strong></td><td>{purchase.vendor?.name}</td><td>{shortDate(purchase.purchaseDate)}</td><td>{purchase.items?.map((item) => `${item.material?.name} · ${quantity(item.quantity)} ${item.material?.unit}`).join(', ')}</td><td className="number-cell">{money(purchase.totalAmount, currency)}</td><td className="number-cell">{money(purchase.paidAmount, currency)}</td><td><StatusPill tone={purchase.balanceDue > 0 ? 'warning' : 'success'}>{money(purchase.balanceDue, currency)}</StatusPill></td><td>{purchase.balanceDue > 0 && <button className="secondary-button compact-button" onClick={() => { setActivePurchase(purchase); setDialog('payment'); setError(''); }}>Régler</button>}</td></tr>)}</tbody></table></div></LoadingOrEmpty>
    </div>
    {dialog && <Modal title={dialog === 'vendor' ? 'Ajouter un fournisseur' : dialog === 'payment' ? 'Payer un solde fournisseur' : 'Enregistrer un achat'} description={dialog === 'purchase' ? 'La réception matière est ajoutée au stock dans la même transaction que l’achat.' : undefined} onClose={() => { setDialog(null); setActivePurchase(null); }} wide={dialog === 'purchase'}>
      <form onSubmit={submit}>
        {dialog === 'vendor' && <div className="form-grid"><label>Nom<input name="name" required minLength={2} maxLength={120} /></label><label>Téléphone<input name="phone" maxLength={32} /></label><label>Courriel<input type="email" name="email" /></label><label>Adresse<input name="address" maxLength={300} /></label></div>}
        {dialog === 'purchase' && <div className="form-grid"><label>Fournisseur<select name="vendorId" required defaultValue=""><option value="" disabled>Choisir un fournisseur</option>{vendorRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Référence<input name="reference" required maxLength={100} placeholder="Facture ou bon" /></label><label>Date<input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Matière<select name="materialId" required defaultValue=""><option value="" disabled>Choisir une matière</option>{materialRows.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label><label>Quantité reçue<input name="quantity" type="number" min="0.001" step="0.001" required /></label><label>Coût unitaire<input name="unitCost" type="number" min="0" step="0.01" required /></label><label>Paiement initial (facultatif)<input name="initialPayment" type="number" min="0" step="0.01" /></label><label>Compte de paiement<select name="cashAccountId" defaultValue=""><option value="">Non affecté</option>{accountRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Mode<select name="method" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Notes<input name="notes" maxLength={1000} /></label></div>}
        {dialog === 'payment' && <div className="form-grid"><label>Solde restant<input readOnly value={money(activePurchase?.balanceDue, currency)} /></label><label>Montant payé<input name="amount" type="number" min="0.01" max={activePurchase?.balanceDue} step="0.01" required /></label><label>Mode<select name="method" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Compte de paiement<select name="cashAccountId" defaultValue=""><option value="">Non affecté</option>{accountRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-span">Note<input name="note" maxLength={1000} /></label></div>}
        <FormActions onCancel={() => { setDialog(null); setActivePurchase(null); }} saving={saving} />
      </form>
    </Modal>}
  </>;
}
