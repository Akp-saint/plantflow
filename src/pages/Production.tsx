import { useState, type FormEvent } from 'react';
import { Check, Factory } from 'lucide-react';
import { FormActions, LoadingOrEmpty, Modal, Notice, PageHeader, StatusPill, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';
import { dateForInput, quantity, shortDate } from '../lib/format';

type BrickSize = { id: string; name: string; dimensions: string; unit: string; active: boolean };
type Recipe = { id: string; name: string; brickSizeId: string; active: boolean };
type Entry = { id: string; productionDate: string; quantityProduced: number; quantityDamaged: number; status: string; brickSize: BrickSize; recipe?: Recipe | null; notes?: string | null };

export default function ProductionPage({ canCreate = true, canRecordCosts = true }: { canCreate?: boolean; canRecordCosts?: boolean } = {}) {
  const entries = useApiQuery<{ data: Entry[] }>('/api/v1/production-entries');
  const sizes = useApiQuery<{ data: BrickSize[] }>('/api/v1/brick-sizes');
  const recipes = useApiQuery<{ data: Recipe[] }>('/api/v1/recipes');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const rows = entries.data ? payloadList<Entry>(entries.data) : [];
  const sizeRows = sizes.data ? payloadList<BrickSize>(sizes.data).filter((item) => item.active) : [];
  const recipeRows = recipes.data ? payloadList<Recipe>(recipes.data).filter((item) => item.active) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const values = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      productionDate: values.get('productionDate'),
      brickSizeId: values.get('brickSizeId'),
      recipeId: values.get('recipeId') || null,
      quantityProduced: Number(values.get('quantityProduced')),
      quantityDamaged: Number(values.get('quantityDamaged') || 0),
      ...(canRecordCosts && values.get('labourCost') ? { labourCost: Number(values.get('labourCost')) } : {}),
      notes: values.get('notes') || undefined,
    };
    try {
      await apiRequest('/api/v1/production-entries', { method: 'POST', body: JSON.stringify(body) });
      setOpen(false); setSuccess('Production enregistrée; les mouvements de matières et de briques ont été comptabilisés.');
      entries.reload();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeader eyebrow="Opérations / Production" title="Production quotidienne" description="Enregistrez la cadence, les pertes et la recette consommée." action={canCreate ? () => { setError(''); setOpen(true); } : undefined} actionLabel={canCreate ? 'Nouvelle production' : undefined} />
    <Notice error={error} success={success} />
    <div className="panel table-panel"><div className="table-heading"><div><h2>Registre de production</h2><p>Entrées et quantités issues de PostgreSQL.</p></div><span className="record-count">{rows.length} entrée(s)</span></div>
      <LoadingOrEmpty loading={entries.loading || sizes.loading || recipes.loading} error={entries.error || sizes.error || recipes.error} empty={!rows.length}>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Format</th><th>Recette</th><th>Produites</th><th>Endommagées</th><th>État</th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}><td>{shortDate(entry.productionDate)}</td><td><strong>{entry.brickSize?.name}</strong><small className="cell-detail">{entry.brickSize?.dimensions}</small></td><td>{entry.recipe?.name ?? 'Sans recette'}</td><td className="number-cell">{quantity(entry.quantityProduced)}</td><td className="number-cell">{quantity(entry.quantityDamaged)}</td><td><StatusPill tone="success">{entry.status === 'VALIDATED' ? 'Validée' : entry.status}</StatusPill></td></tr>)}</tbody></table></div>
      </LoadingOrEmpty>
    </div>
    {open && <Modal title="Enregistrer la production" description="La production, les briques endommagées et la consommation de recette sont enregistrées dans une transaction." onClose={() => setOpen(false)}>
      {sizeRows.length === 0 && <Notice error="Ajoutez d’abord un format de brique dans Paramètres." />}
      <form onSubmit={submit}><div className="form-grid"><label>Date de production<input type="date" name="productionDate" defaultValue={dateForInput()} required /></label><label>Format de brique<select name="brickSizeId" required defaultValue=""><option value="" disabled>Choisir un format</option>{sizeRows.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.dimensions}</option>)}</select></label><label>Quantité produite<input type="number" name="quantityProduced" min="1" step="1" required placeholder="Ex. 12500" /></label><label>Quantité endommagée<input type="number" name="quantityDamaged" min="0" step="1" defaultValue="0" /></label><label>Recette (facultative)<select name="recipeId" defaultValue=""><option value="">Aucune recette</option>{recipeRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{canRecordCosts && <label>Coût de main-d’œuvre (facultatif)<input type="number" name="labourCost" min="0" step="0.01" /></label>}</div><label>Notes<textarea name="notes" rows={3} maxLength={1000} placeholder="Équipe, ligne, remarques…" /></label><FormActions onCancel={() => setOpen(false)} saving={saving} /></form>
    </Modal>}
  </>;
}
