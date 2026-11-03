import { useState, type FormEvent, type ReactNode } from 'react';
import { Building2, Boxes, UsersRound, Wrench, WalletCards } from 'lucide-react';
import { Notice, PageHeader, useApiQuery } from '../components/ui';
import { apiMessage, apiRequest, payloadData, payloadList } from '../lib/api';

type Plant = { id: string; name: string; city?: string | null; address?: string | null; currency: string };
type Brick = { id: string; name: string; dimensions: string; unit: string };
type Material = { id: string; name: string; unit: string; active: boolean };
type Category = { id: string; name: string };

export default function SettingsPage() {
  const plants = useApiQuery<unknown>('/api/v1/plants');
  const sizes = useApiQuery<unknown>('/api/v1/brick-sizes');
  const materials = useApiQuery<unknown>('/api/v1/materials');
  const categories = useApiQuery<unknown>('/api/v1/expense-categories');
  const plantRows = plants.data ? payloadList<Plant>(plants.data) : [];
  const brickRows = sizes.data ? payloadList<Brick>(sizes.data) : [];
  const materialRows = materials.data ? payloadList<Material>(materials.data).filter((item) => item.active) : [];
  const categoryRows = categories.data ? payloadList<Category>(categories.data) : [];
  const selectedPlantId = localStorage.getItem('plantflow.plantId') ?? '';
  const currentPlant = plantRows.find((item) => item.id === selectedPlantId) ?? plantRows[0];
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyForm, setBusyForm] = useState('');
  const currency = localStorage.getItem('plantflow.currency') ?? 'XOF';
  const refresh = () => { plants.reload(); sizes.reload(); materials.reload(); categories.reload(); };

  async function submit(kind: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyForm(kind); setError(''); setSuccess('');
    const values = new FormData(event.currentTarget);
    const value = (key: string) => String(values.get(key) ?? '').trim();
    try {
      if (kind === 'plant-profile' && currentPlant) {
        await apiRequest(`/api/v1/plants/${currentPlant.id}`, { method: 'PATCH', body: JSON.stringify({ name: value('name'), city: value('city') || null, address: value('address') || null, currency: value('currency') }) });
        localStorage.setItem('plantflow.currency', value('currency'));
        setSuccess('Profil de l’usine mis à jour.');
      } else if (kind === 'plant-create') {
        await apiRequest('/api/v1/plants', { method: 'POST', body: JSON.stringify({ name: value('name'), city: value('city') || undefined, address: value('address') || undefined, currency }) });
        setSuccess('Usine créée dans le workspace courant.');
      } else if (kind === 'brick') {
        await apiRequest('/api/v1/brick-sizes', { method: 'POST', body: JSON.stringify({ name: value('name'), dimensions: value('dimensions'), unit: value('unit') || 'u' }) });
        setSuccess('Format de brique ajouté.');
      } else if (kind === 'material') {
        await apiRequest('/api/v1/materials', { method: 'POST', body: JSON.stringify({ name: value('name'), category: value('category'), unit: value('unit'), lowStockAt: Number(value('lowStockAt') || 0) }) });
        setSuccess('Matière ajoutée.');
      } else if (kind === 'recipe') {
        await apiRequest('/api/v1/recipes', { method: 'POST', body: JSON.stringify({ name: value('name'), brickSizeId: value('brickSizeId'), items: [{ materialId: value('materialId'), quantity: Number(value('quantity')) }] }) });
        setSuccess('Recette enregistrée avec sa consommation par brique.');
      } else if (kind === 'category') {
        await apiRequest('/api/v1/expense-categories', { method: 'POST', body: JSON.stringify({ name: value('name') }) });
        setSuccess('Catégorie de dépense ajoutée.');
      } else if (kind === 'account') {
        await apiRequest('/api/v1/cashiers', { method: 'POST', body: JSON.stringify({ name: value('name'), openingBalance: Number(value('openingBalance') || 0) }) });
        setSuccess('Compte de caisse ajouté.');
      } else if (kind === 'member') {
        const plantId = value('plantId') || currentPlant?.id;
        if (!plantId) throw new Error('Créez ou sélectionnez une usine avant d’ajouter un membre.');
        await apiRequest(`/api/v1/plants/${plantId}/members`, { method: 'POST', body: JSON.stringify({ email: value('email'), role: value('role') }) });
        setSuccess('Membre ajouté à l’usine. Cette personne doit avoir déjà ouvert une session PlantFlow.');
      }
      event.currentTarget.reset(); refresh();
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setBusyForm(''); }
  }

  return <>
    <PageHeader eyebrow="Configuration" title="Paramètres" description="Configurez les unités, recettes, rôles et comptes qui pilotent les opérations." />
    <Notice error={error} success={success} />
    {(plants.loading || sizes.loading || materials.loading || categories.loading) ? <div className="panel empty-state">Chargement de la configuration…</div> : (plants.error || sizes.error || materials.error || categories.error) ? <Notice error={plants.error || sizes.error || materials.error || categories.error} /> : <>
      <section className="settings-grid-connected">
        <SettingsCard icon={<Building2 size={18} />} title="Profil de l’usine" description="Nom, ville, adresse et devise des rapports."><form onSubmit={(event) => submit('plant-profile', event)}><label>Usine active<input name="name" defaultValue={currentPlant?.name ?? ''} required minLength={2} maxLength={120} /></label><label>Ville<input name="city" defaultValue={currentPlant?.city ?? ''} maxLength={120} /></label><label>Adresse<input name="address" defaultValue={currentPlant?.address ?? ''} maxLength={300} /></label><label>Devise<select name="currency" defaultValue={currentPlant?.currency ?? currency}><option value="XOF">XOF — Franc CFA BCEAO</option></select></label><button className="primary-button" disabled={busyForm === 'plant-profile'}>Enregistrer</button></form></SettingsCard>
        <SettingsCard icon={<Building2 size={18} />} title="Ajouter une usine" description="Une usine supplémentaire dans ce workspace."><form onSubmit={(event) => submit('plant-create', event)}><label>Nom<input name="name" required minLength={2} maxLength={120} /></label><label>Ville<input name="city" maxLength={120} /></label><label>Adresse<input name="address" maxLength={300} /></label><button className="secondary-button" disabled={busyForm === 'plant-create'}>Créer l’usine</button></form>{plantRows.map((plant) => <div className="settings-list-row" key={plant.id}>{plant.name}<span>{plant.city ?? ''}</span></div>)}</SettingsCard>
        <SettingsCard icon={<Boxes size={18} />} title="Formats de briques" description="Les quantités sont suivies par format."><form onSubmit={(event) => submit('brick', event)}><label>Nom<input name="name" required maxLength={80} placeholder="Brique standard" /></label><label>Dimensions<input name="dimensions" required minLength={3} maxLength={80} placeholder="230 × 110 × 75 mm" /></label><label>Unité<input name="unit" defaultValue="u" maxLength={24} /></label><button className="secondary-button" disabled={busyForm === 'brick'}>Ajouter un format</button></form>{brickRows.map((item) => <div className="settings-list-row" key={item.id}>{item.name}<span>{item.dimensions}</span></div>)}</SettingsCard>
        <SettingsCard icon={<Boxes size={18} />} title="Matières premières" description="Définissez unité et seuil avant d’enregistrer achats et recettes."><form onSubmit={(event) => submit('material', event)}><label>Nom<input name="name" required maxLength={100} /></label><label>Catégorie<input name="category" required maxLength={80} placeholder="Argile, liant…" /></label><label>Unité<input name="unit" required maxLength={24} placeholder="kg" /></label><label>Seuil d’alerte<input name="lowStockAt" type="number" min="0" step="0.001" defaultValue="0" /></label><button className="secondary-button" disabled={busyForm === 'material'}>Ajouter une matière</button></form>{materialRows.map((item) => <div className="settings-list-row" key={item.id}>{item.name}<span>{item.unit}</span></div>)}</SettingsCard>
        <SettingsCard icon={<Wrench size={18} />} title="Recette de fabrication" description="Consommation de matière par brique du format sélectionné."><form onSubmit={(event) => submit('recipe', event)}><label>Nom<input name="name" required maxLength={100} /></label><label>Format<select name="brickSizeId" required defaultValue=""><option value="" disabled>Choisir</option>{brickRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Matière<select name="materialId" required defaultValue=""><option value="" disabled>Choisir</option>{materialRows.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label><label>Quantité matière par brique<input name="quantity" type="number" min="0.0001" step="0.0001" required /></label><button className="secondary-button" disabled={busyForm === 'recipe' || !brickRows.length || !materialRows.length}>Ajouter la recette</button></form></SettingsCard>
        <SettingsCard icon={<WalletCards size={18} />} title="Comptes de caisse" description="Les paiements et dépenses peuvent être associés à un compte."><form onSubmit={(event) => submit('account', event)}><label>Nom du compte<input name="name" required maxLength={120} placeholder="Caisse principale" /></label><label>Solde d’ouverture<input name="openingBalance" type="number" min="0" step="0.01" defaultValue="0" /></label><button className="secondary-button" disabled={busyForm === 'account'}>Créer le compte</button></form></SettingsCard>
        <SettingsCard icon={<WalletCards size={18} />} title="Catégories de dépenses" description="Classez les sorties enregistrées pour vos rapports."><form onSubmit={(event) => submit('category', event)}><label>Nom de catégorie<input name="name" required minLength={2} maxLength={80} /></label><button className="secondary-button" disabled={busyForm === 'category'}>Ajouter une catégorie</button></form>{categoryRows.map((item) => <div className="settings-list-row" key={item.id}>{item.name}</div>)}</SettingsCard>
        <SettingsCard icon={<UsersRound size={18} />} title="Membres & rôles" description="Ajoutez une personne déjà connectée à PlantFlow."><form onSubmit={(event) => submit('member', event)}><label>Usine<select name="plantId" defaultValue={currentPlant?.id ?? ''}>{plantRows.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</select></label><label>Courriel du membre<input name="email" type="email" required /></label><label>Rôle<select name="role" defaultValue="STAFF"><option value="MANAGER">Manager</option><option value="CASHIER">Caissier</option><option value="STAFF">Personnel</option><option value="OWNER">Owner</option></select></label><button className="secondary-button" disabled={busyForm === 'member'}>Ajouter à l’usine</button></form></SettingsCard>
      </section>
    </>}
  </>;
}

function SettingsCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <section className="panel settings-card-connected"><div className="settings-card-title"><span className="metric-icon blue">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div>{children}</section>;
}
