import { useState, type FormEvent } from 'react';
import { Plus, Printer, ReceiptText } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, StatusPill, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { money, quantity, shortDate } from '../lib/format';

const methods = [['CASH', 'Espèces'], ['BANK', 'Banque'], ['MOBILE_MONEY', 'Mobile Money'], ['OTHER', 'Autre']];
type Contact = { id: string; name: string; phone?: string | null; email?: string | null; address?: string | null };
type Brick = { id: string; name: string; dimensions: string; unit: string; active: boolean };
type CashAccount = { id: string; name: string };
type SaleItem = { id: string; brickSizeId: string; quantity: number; unitPrice: number; lineTotal: number; brickSize: Brick };
type SalePayment = { id: string; amount: number; method: string; paidAt: string; note?: string | null };
type Sale = { id: string; invoiceNumber: string; saleDate: string; totalAmount: number; paidAmount: number; balance: number; customer: Contact; status: string; items?: SaleItem[]; payments?: SalePayment[]; notes?: string | null };

export default function SalesPage() {
  const sales = useApiQuery<unknown>('/api/v1/sales');
  const customers = useApiQuery<unknown>('/api/v1/customers');
  const sizes = useApiQuery<unknown>('/api/v1/brick-sizes');
  const accounts = useApiQuery<unknown>('/api/v1/cashiers');
  const [dialog, setDialog] = useState<'sale' | 'customer' | 'payment' | 'invoice' | null>(null);
  const [activeSale, setActiveSale] = useState<Sale | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const rows = sales.data ? payloadList<Sale>(sales.data) : [];
  const customerRows = customers.data ? payloadList<Contact>(customers.data) : [];
  const brickRows = sizes.data ? payloadList<Brick>(sizes.data).filter((item) => item.active) : [];
  const accountRows = accounts.data ? payloadList<CashAccount>(accounts.data) : [];
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  const refresh = () => { sales.reload(); customers.reload(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      if (dialog === 'customer') {
        await apiRequest('/api/v1/customers', { method: 'POST', body: JSON.stringify({ name: values.get('name'), phone: values.get('phone') || null, email: values.get('email') || null, address: values.get('address') || null }) });
        setSuccess('Client ajouté.');
      } else if (dialog === 'sale') {
        const amount = Number(values.get('initialPayment') || 0);
        if (amount > 0 && !values.get('cashAccountId')) throw new Error('Choisissez le compte qui reçoit le paiement initial.');
        const body = { customerId: values.get('customerId'), saleDate: values.get('saleDate'), notes: values.get('notes') || undefined, items: [{ brickSizeId: values.get('brickSizeId'), quantity: Number(values.get('quantity')), unitPrice: Number(values.get('unitPrice')) }], ...(amount > 0 ? { initialPayment: { amount, method: values.get('method'), cashAccountId: values.get('cashAccountId') || null } } : {}) };
        await apiRequest('/api/v1/sales', { method: 'POST', body: JSON.stringify(body) });
        setSuccess('Vente enregistrée; le stock de briques et le solde client sont à jour.');
      } else if (dialog === 'payment' && activeSale) {
        if (!values.get('cashAccountId')) throw new Error('Choisissez le compte qui reçoit l’encaissement.');
        await apiRequest(`/api/v1/sales/${activeSale.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number(values.get('amount')), method: values.get('method'), cashAccountId: values.get('cashAccountId') || null, note: values.get('note') || undefined }) });
        setSuccess('Encaissement ajouté à la vente.');
      }
      form.reset(); setDialog(null); setActiveSale(null); refresh();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Finance / Ventes" title="Ventes & clients" description="Créez les factures, suivez les encaissements partiels et les créances restantes." action={() => { setError(''); setDialog('sale'); }} actionLabel="Nouvelle vente" />
    <div className="toolbar-right stock-actions"><button className="secondary-button" onClick={() => { setError(''); setDialog('customer'); }}><Plus size={15} /> Nouveau client</button></div>
    <Notice error={error} success={success} />
    <div className="panel table-panel"><div className="table-heading"><div><h2>Registre des ventes</h2><p>Le total, les paiements et le solde sont calculés côté serveur.</p></div><span className="record-count">{rows.length} vente(s)</span></div>
      <LoadingOrEmpty loading={sales.loading || customers.loading || sizes.loading || accounts.loading} error={sales.error || customers.error || sizes.error || accounts.error} empty={!rows.length}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Facture</th><th>Client</th><th>Date</th><th>Total</th><th>Encaissé</th><th>Solde</th><th>Actions</th></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id}><td><strong className="mono">{sale.invoiceNumber}</strong></td><td><strong>{sale.customer?.name}</strong></td><td>{shortDate(sale.saleDate)}</td><td className="number-cell">{money(sale.totalAmount, currency)}</td><td className="number-cell">{money(sale.paidAmount, currency)}</td><td><StatusPill tone={sale.balance > 0 ? 'warning' : 'success'}>{money(sale.balance, currency)} {sale.balance > 0 ? 'dû' : 'soldé'}</StatusPill></td><td style={{ display: 'flex', gap: '6px' }}><button className="secondary-button compact-button" onClick={() => { setActiveSale(sale); setDialog('invoice'); }} title="Imprimer Facture / Bon de livraison"><Printer size={14} /> Facture</button>{sale.balance > 0 && <button className="secondary-button compact-button" onClick={() => { setActiveSale(sale); setDialog('payment'); setError(''); }}><ReceiptText size={14} /> Encaisser</button>}</td></tr>)}</tbody></table></div></LoadingOrEmpty>
    </div>
    {dialog && dialog !== 'invoice' && <Modal title={dialog === 'customer' ? 'Ajouter un client' : dialog === 'payment' ? 'Enregistrer un encaissement' : 'Créer une vente'} description={dialog === 'sale' ? 'Le stock disponible est vérifié avant validation. Le paiement initial peut être partiel.' : undefined} onClose={() => { setDialog(null); setActiveSale(null); }} wide={dialog === 'sale'}>
      <form onSubmit={submit}>
        {dialog === 'customer' && <div className="form-grid"><label>Nom du client<input name="name" required minLength={2} maxLength={120} /></label><label>Téléphone<input name="phone" maxLength={32} /></label><label>Courriel<input type="email" name="email" /></label><label>Adresse<input name="address" maxLength={300} /></label></div>}
        {dialog === 'sale' && <div className="form-grid"><label>Client<select name="customerId" required defaultValue=""><option value="" disabled>Choisir un client</option>{customerRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Date<input type="date" name="saleDate" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>Format de brique<select name="brickSizeId" required defaultValue=""><option value="" disabled>Choisir un format</option>{brickRows.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.dimensions}</option>)}</select></label><label>Quantité<input name="quantity" type="number" min="1" step="1" required /></label><label>Prix unitaire<input name="unitPrice" type="number" min="0" step="0.01" required /></label><label>Paiement initial (facultatif)<input name="initialPayment" type="number" min="0" step="0.01" /></label><label>Compte d’encaissement<select name="cashAccountId" defaultValue=""><option value="">Non affecté</option>{accountRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Mode de paiement<select name="method" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="form-span">Notes<input name="notes" maxLength={2000} /></label></div>}
        {dialog === 'payment' && <div className="form-grid"><label>Solde à encaisser<input value={money(activeSale?.balance, currency)} readOnly /></label><label>Montant reçu<input name="amount" type="number" min="0.01" max={activeSale?.balance} step="0.01" required /></label><label>Mode de paiement<select name="method" defaultValue="CASH">{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Compte d’encaissement<select name="cashAccountId" defaultValue=""><option value="">Non affecté</option>{accountRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-span">Note<input name="note" maxLength={1000} /></label></div>}
        <FormActions onCancel={() => { setDialog(null); setActiveSale(null); }} saving={saving} />
      </form>
    </Modal>}

    {dialog === 'invoice' && activeSale && (
      <Modal title={`Facture & Bon de Livraison — ${activeSale.invoiceNumber}`} onClose={() => { setDialog(null); setActiveSale(null); }} wide>
        <div className="printable-invoice-area">
          <div className="invoice-actions-bar no-print">
            <button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Imprimer ou Enregistrer en PDF</button>
          </div>
          <div className="invoice-print-view">
            <div className="invoice-print-header">
              <div className="invoice-print-brand">
                <h2>PlantFlow — Usine de Briques</h2>
                <p>Gestion de production & Matériaux de construction</p>
                <p>Briqueterie Industrielle</p>
              </div>
              <div className="invoice-print-meta">
                <span className="invoice-badge">FACTURE / BON DE LIVRAISON</span>
                <p><strong>N° :</strong> {activeSale.invoiceNumber}</p>
                <p><strong>Date d'émission :</strong> {shortDate(activeSale.saleDate)}</p>
                <p><strong>Statut :</strong> {activeSale.balance <= 0 ? 'PAYÉ / SOLDÉ' : 'RÈGLEMENT PARTIEL'}</p>
              </div>
            </div>

            <div className="invoice-print-parties">
              <div className="party-block">
                <span>Émetteur (Usine)</span>
                <strong>Briqueterie du Faso</strong>
                <p>Zone Industrielle de Kossodo</p>
                <p>Ouagadougou, Burkina Faso</p>
              </div>
              <div className="party-block">
                <span>Client & Facturation</span>
                <strong>{activeSale.customer?.name}</strong>
                {activeSale.customer?.phone && <p>Tél : {activeSale.customer.phone}</p>}
                {activeSale.customer?.address && <p>Adresse : {activeSale.customer.address}</p>}
                {activeSale.customer?.email && <p>Email : {activeSale.customer.email}</p>}
              </div>
            </div>

            <table className="invoice-items-table">
              <thead>
                <tr>
                  <th>Désignation de l'article</th>
                  <th style={{ textAlign: 'right' }}>Quantité</th>
                  <th style={{ textAlign: 'right' }}>Prix Unitaire</th>
                  <th style={{ textAlign: 'right' }}>Montant Total</th>
                </tr>
              </thead>
              <tbody>
                {activeSale.items && activeSale.items.length > 0 ? (
                  activeSale.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.brickSize?.name || 'Brique standard'}</strong>
                        {item.brickSize?.dimensions && <small style={{ display: 'block', color: '#77878b' }}>Dim : {item.brickSize.dimensions}</small>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{quantity(item.quantity)} {item.brickSize?.unit || 'u'}</td>
                      <td style={{ textAlign: 'right' }}>{money(item.unitPrice, currency)}</td>
                      <td style={{ textAlign: 'right' }}><strong>{money(item.lineTotal, currency)}</strong></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td><strong>Briques (Lot commande)</strong></td>
                    <td style={{ textAlign: 'right' }}>1 lot</td>
                    <td style={{ textAlign: 'right' }}>{money(activeSale.totalAmount, currency)}</td>
                    <td style={{ textAlign: 'right' }}><strong>{money(activeSale.totalAmount, currency)}</strong></td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="invoice-summary-box">
              <div className="invoice-summary-table">
                <div className="invoice-summary-row">
                  <span>Sous-total HT :</span>
                  <strong>{money(activeSale.totalAmount, currency)}</strong>
                </div>
                <div className="invoice-summary-row total-row">
                  <span>Net à Payer :</span>
                  <strong>{money(activeSale.totalAmount, currency)}</strong>
                </div>
                <div className="invoice-summary-row">
                  <span>Montant Déjà Encaissé :</span>
                  <span>{money(activeSale.paidAmount, currency)}</span>
                </div>
                <div className={`invoice-summary-row ${activeSale.balance > 0 ? 'balance-due' : ''}`}>
                  <span>Solde Restant Dû :</span>
                  <strong>{money(activeSale.balance, currency)}</strong>
                </div>
              </div>
            </div>

            {activeSale.notes && (
              <div style={{ marginTop: '16px', padding: '10px 14px', background: '#f8faf9', borderRadius: '6px', fontSize: '11px', color: '#637a7d' }}>
                <strong>Notes / Instructions de livraison :</strong> {activeSale.notes}
              </div>
            )}

            <div className="invoice-print-footer">
              <div className="signature-box">
                Signature & Cachet Client
              </div>
              <div className="signature-box">
                Responsable Expédition & Caisse
              </div>
            </div>
          </div>
        </div>
      </Modal>
    )}
  </>;
}
