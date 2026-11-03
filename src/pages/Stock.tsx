import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, StatusPill, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { quantity, shortDate } from '../lib/format';

type Item = { id: string; name: string; unit: string; category?: string; onHand: number; lowStockAt?: number; lowStock?: boolean };
type Summary = { materials: Item[]; finishedGoods: Item[] };
type Movement = { id: string; type: string; quantity: number; reason: string; createdAt: string; material?: Item | null; brickSize?: Item | null };

export default function StockPage() {
  const summary = useApiQuery<{ data: Summary }>('/api/v1/inventory/summary');
  const movements = useApiQuery<{ data: Movement[] }>('/api/v1/inventory/movements');
  const [dialog, setDialog] = useState<'adjust' | 'material' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const stock = summary.data ? payloadData<Summary>(summary.data) : { materials: [], finishedGoods: [] };
  const rows = movements.data ? payloadList<Movement>(movements.data) : [];
  const refresh = () => { summary.reload(); movements.reload(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    const kind = String(values.get('kind'));
    try {
      if (dialog === 'adjust') {
        await apiRequest('/api/v1/inventory/adjustments', { method: 'POST', body: JSON.stringify({ [kind === 'material' ? 'materialId' : 'brickSizeId']: values.get('itemId'), quantity: Number(values.get('quantity')), reason: values.get('reason') }) });
        setSuccess('Ajustement consigné dans le registre de stock.');
      } else {
        await apiRequest('/api/v1/materials', { method: 'POST', body: JSON.stringify({ name: values.get('name'), category: values.get('category'), unit: values.get('unit'), lowStockAt: Number(values.get('lowStockAt') || 0) }) });
        setSuccess('Matière ajoutée au catalogue.');
      }
      form.reset(); setDialog(null); refresh();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Opérations / Inventaire" title="Stock & matières" description="Les soldes sont calculés depuis les achats, la production, les ventes et les ajustements." action={() => { setError(''); setDialog('adjust'); }} actionLabel="Ajuster le stock" />
    <div className="toolbar-right stock-actions"><button className="secondary-button" onClick={() => { setError(''); setDialog('material'); }}><Plus size={15} /> Ajouter une matière</button></div>
    <Notice error={error} success={success} />
    <LoadingOrEmpty loading={summary.loading} error={summary.error}>
      <section className="inventory-grid"><InventoryTable title="Matières premières" rows={stock.materials} material /><InventoryTable title="Produits finis" rows={stock.finishedGoods} /></section>
    </LoadingOrEmpty>
    <div className="panel table-panel movement-panel"><div className="table-heading"><div><h2>Mouvements de stock</h2><p>Journal immuable des entrées, consommations, ventes et corrections.</p></div></div><LoadingOrEmpty loading={movements.loading} error={movements.error} empty={!rows.length}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Article</th><th>Type</th><th>Quantité</th><th>Motif</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(row.createdAt)}</td><td>{row.material?.name ?? row.brickSize?.name ?? 'Article'}</td><td>{row.type}</td><td className="number-cell">{quantity(row.quantity)} {row.material?.unit ?? row.brickSize?.unit ?? ''}</td><td>{row.reason}</td></tr>)}</tbody></table></div></LoadingOrEmpty></div>
    {dialog && <Modal title={dialog === 'adjust' ? 'Ajuster un stock' : 'Ajouter une matière'} description={dialog === 'adjust' ? 'La correction est ajoutée au registre; un solde ne peut pas être modifié directement.' : 'Définissez l’unité et le seuil de réapprovisionnement.'} onClose={() => setDialog(null)}>
      <form onSubmit={submit}>{dialog === 'adjust' ? <>
        <label>Type d’article<select name="kind" defaultValue="material"><option value="material">Matière première</option><option value="brick">Produit fini</option></select></label>
        <label>Article<select name="itemId" required defaultValue=""><option value="" disabled>Choisir un article</option>{stock.materials.map((item) => <option key={item.id} value={item.id}>{item.name} ({quantity(item.onHand)} {item.unit})</option>)}{stock.finishedGoods.map((item) => <option key={item.id} value={item.id}>{item.name} ({quantity(item.onHand)} {item.unit})</option>)}</select></label>
        <label>Variation (+ entrée, − sortie)<input name="quantity" type="number" step="0.001" required placeholder="Ex. 250 ou -15" /></label>
        <label>Motif<textarea name="reason" rows={3} minLength={4} maxLength={500} required placeholder="Ex. inventaire physique du 3 novembre" /></label>
      </> : <div className="form-grid"><label>Nom<input name="name" required minLength={1} maxLength={100} /></label><label>Catégorie<input name="category" required maxLength={80} placeholder="Matière première" /></label><label>Unité<input name="unit" required maxLength={24} placeholder="kg, tonne…" /></label><label>Seuil minimum<input name="lowStockAt" type="number" min="0" step="0.001" defaultValue="0" /></label></div>}<FormActions onCancel={() => setDialog(null)} saving={saving} /></form>
    </Modal>}
  </>;
}

function InventoryTable({ title, rows, material = false }: { title: string; rows: Item[]; material?: boolean }) {
  return <section className="panel table-panel"><div className="table-heading"><div><h2>{title}</h2><p>{rows.length} référence(s)</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Article</th><th>Catégorie</th><th>Disponible</th><th>Seuil</th><th>État</th></tr></thead><tbody>{rows.length ? rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{material ? item.category ?? 'Matière' : 'Produit fini'}</td><td className="number-cell">{quantity(item.onHand)} {item.unit}</td><td>{material ? `${quantity(item.lowStockAt)} ${item.unit}` : '—'}</td><td>{material && item.lowStock ? <StatusPill tone="warning">À réapprovisionner</StatusPill> : <StatusPill tone="success">Disponible</StatusPill>}</td></tr>) : <tr><td colSpan={5}>Aucune référence configurée.</td></tr>}</tbody></table></div></section>;
}
