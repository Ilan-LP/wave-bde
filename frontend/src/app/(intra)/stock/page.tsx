'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface StockItem {
  id: number;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  alertThreshold: number;
  category: string | null;
  isBuvette: boolean;
  priceCents: number;
}

interface StockMovement {
  id: number;
  delta: number;
  reason: string | null;
  createdAt: string;
  user: { id: number; firstName: string; lastName: string };
}

const inp: React.CSSProperties = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' };

interface ItemForm {
  name: string; description: string; quantity: string; unit: string;
  alertThreshold: string; category: string; isBuvette: boolean; priceCents: string;
}

const emptyForm: ItemForm = { name: '', description: '', quantity: '0', unit: '', alertThreshold: '0', category: '', isBuvette: false, priceCents: '0' };

export default function StockPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [movementItem, setMovementItem] = useState<StockItem | null>(null);
  const [createForm, setCreateForm] = useState<ItemForm>(emptyForm);
  const [editForm, setEditForm] = useState<Omit<ItemForm, 'quantity'>>({ name: '', description: '', unit: '', alertThreshold: '0', category: '', isBuvette: false, priceCents: '0' });
  const [movementDelta, setMovementDelta] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.get<{ items: StockItem[] }>('/stock'),
    enabled: !!user,
  });

  const { data: movementsData } = useQuery({
    queryKey: ['stock-movements', movementItem?.id],
    queryFn: () => api.get<{ movements: StockMovement[] }>(`/stock/${movementItem!.id}/movements`),
    enabled: !!movementItem,
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post<{ item: StockItem }>('/stock', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stock'] }); setShowCreate(false); setCreateForm(emptyForm); setError(''); },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.patch<{ item: StockItem }>(`/stock/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stock'] }); setEditItem(null); setError(''); },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<{ success: boolean }>(`/stock/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stock'] }); setEditItem(null); setError(''); },
    onError: (err: Error) => setError(err.message),
  });

  const movementMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.post<{ item: StockItem }>(`/stock/${id}/movements`, body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', movementItem?.id] });
      if (movementItem) setMovementItem(data.item);
      setMovementDelta(''); setMovementReason(''); setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const canManage = user?.role === 'ADMIN' || user?.role === 'POLE_LEAD';
  const isAdmin = user?.role === 'ADMIN';

  function openEdit(item: StockItem) {
    setEditItem(item);
    setEditForm({ name: item.name, description: item.description ?? '', unit: item.unit, alertThreshold: String(item.alertThreshold), category: item.category ?? '', isBuvette: item.isBuvette, priceCents: String(item.priceCents / 100) });
    setError('');
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name || !createForm.unit) { setError('Nom et unité requis'); return; }
    createMutation.mutate({ name: createForm.name, description: createForm.description || undefined, quantity: parseInt(createForm.quantity) || 0, unit: createForm.unit, alertThreshold: parseInt(createForm.alertThreshold) || 0, category: createForm.category || undefined, isBuvette: createForm.isBuvette, priceCents: Math.round(parseFloat(createForm.priceCents) * 100) || 0 });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    updateMutation.mutate({ id: editItem.id, body: { name: editForm.name, description: editForm.description || undefined, unit: editForm.unit, alertThreshold: parseInt(editForm.alertThreshold) || 0, category: editForm.category || undefined, isBuvette: editForm.isBuvette, priceCents: Math.round(parseFloat(editForm.priceCents) * 100) || 0 } });
  }

  function submitMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!movementItem || !movementDelta) { setError('Quantité requise'); return; }
    const delta = parseInt(movementDelta);
    if (isNaN(delta) || delta === 0) { setError('Quantité invalide'); return; }
    movementMutation.mutate({ id: movementItem.id, body: { delta, reason: movementReason || undefined } });
  }

  if (authLoading) return null;

  const items = data?.items ?? [];
  const lowStock = items.filter(i => i.quantity <= i.alertThreshold);

  const ItemFormFields = ({ form, setForm }: { form: any; setForm: any }) => (
    <>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 2 }}><label style={lbl}>Nom *</label><input style={inp} value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, name: e.target.value }))} required /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Unité *</label><input style={inp} placeholder="ex: boîtes" value={form.unit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, unit: e.target.value }))} required /></div>
      </div>
      <div><label style={lbl}>Description</label><input style={inp} value={form.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, description: e.target.value }))} /></div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}><label style={lbl}>Seuil d'alerte</label><input type="number" min="0" style={inp} value={form.alertThreshold} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, alertThreshold: e.target.value }))} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Catégorie</label><input style={inp} value={form.category} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, category: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><label style={lbl}>Prix buvette (€)</label><input type="number" step="0.01" min="0" style={inp} value={form.priceCents} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, priceCents: e.target.value }))} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', paddingBottom: '0.5rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.isBuvette} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f: any) => ({ ...f, isBuvette: e.target.checked }))} />
          Disponible buvette
        </label>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 960 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Stock</h2>
          {canManage && (
            <button onClick={() => { setShowCreate(true); setError(''); }} style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
              + Ajouter un article
            </button>
          )}
        </div>

        {lowStock.length > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.875rem 1.25rem', marginBottom: '1.5rem' }}>
            <p style={{ color: '#dc2626', fontWeight: 600, fontSize: '0.9rem' }}>
              {lowStock.length} article(s) en alerte : {lowStock.map(i => i.name).join(', ')}
            </p>
          </div>
        )}

        {isLoading ? <p style={{ color: '#666' }}>Chargement...</p> : (
          <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Nom', 'Catégorie', 'Quantité', 'Unité', 'Prix', 'Buvette', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.8rem', fontWeight: 600, color: '#6b7280' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: idx < items.length - 1 ? '1px solid #f3f4f6' : 'none', background: item.quantity <= item.alertThreshold ? '#fef2f2' : '#fff' }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>{item.name}{item.description && <span style={{ display: 'block', fontSize: '0.75rem', color: '#9ca3af', fontWeight: 400 }}>{item.description}</span>}</td>
                    <td style={{ padding: '0.875rem 1rem', color: '#666', fontSize: '0.875rem' }}>{item.category ?? '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 700, color: item.quantity <= item.alertThreshold ? '#dc2626' : '#1a1a2e' }}>{item.quantity}</td>
                    <td style={{ padding: '0.875rem 1rem', color: '#666', fontSize: '0.875rem' }}>{item.unit}</td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem' }}>{item.priceCents > 0 ? `${(item.priceCents / 100).toFixed(2)} €` : '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem' }}>{item.isBuvette ? <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {canManage && (
                          <>
                            <button onClick={() => { setMovementItem(item); setMovementDelta(''); setMovementReason(''); setError(''); }}
                              style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                              Mouvement
                            </button>
                            <button onClick={() => openEdit(item)}
                              style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer' }}>
                              Modifier
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal création */}
        {showCreate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Nouvel article</h3>
              <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <ItemFormFields form={createForm} setForm={setCreateForm} />
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Quantité initiale</label><input type="number" min="0" style={inp} value={createForm.quantity} onChange={e => setCreateForm(f => ({ ...f, quantity: e.target.value }))} /></div>
                </div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setShowCreate(false); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                  <button type="submit" disabled={createMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {createMutation.isPending ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal édition */}
        {editItem && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Modifier l'article</h3>
              <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '1.5rem' }}>Stock actuel : <strong>{editItem.quantity} {editItem.unit}</strong> — pour modifier la quantité, utilise "Mouvement"</p>
              <form onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <ItemFormFields form={editForm} setForm={setEditForm} />
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  {isAdmin && (
                    <button type="button"
                      onClick={() => { if (confirm(`Archiver "${editItem.name}" ?`)) deleteMutation.mutate(editItem.id); }}
                      disabled={deleteMutation.isPending}
                      style={{ padding: '0.5rem 1rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                      Supprimer
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem', marginLeft: 'auto' }}>
                    <button type="button" onClick={() => { setEditItem(null); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                    <button type="submit" disabled={updateMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                      {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal mouvement */}
        {movementItem && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h3 style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{movementItem.name}</h3>
                  <p style={{ fontSize: '0.85rem', color: '#666' }}>Stock : <strong>{movementItem.quantity} {movementItem.unit}</strong></p>
                </div>
              </div>

              <form onSubmit={submitMovement} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={lbl}>Quantité (+ entrée / − sortie)</label>
                  <input type="number" style={inp} placeholder="ex: 10 ou -5" value={movementDelta} onChange={e => setMovementDelta(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Motif</label>
                  <input style={inp} placeholder="ex: Livraison, Vente événement…" value={movementReason} onChange={e => setMovementReason(e.target.value)} />
                </div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setMovementItem(null); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Fermer</button>
                  <button type="submit" disabled={movementMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {movementMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </form>

              <h4 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem', color: '#374151' }}>Historique</h4>
              {movementsData?.movements.length === 0 && <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Aucun mouvement</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 200, overflowY: 'auto' }}>
                {(movementsData?.movements ?? []).map(mv => (
                  <div key={mv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: mv.delta > 0 ? '#f0fdf4' : '#fef2f2', borderRadius: 6, fontSize: '0.82rem' }}>
                    <span style={{ color: mv.delta > 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{mv.delta > 0 ? '+' : ''}{mv.delta}</span>
                    <span style={{ color: '#555', flex: 1, marginLeft: '0.75rem' }}>{mv.reason ?? '—'}</span>
                    <span style={{ color: '#9ca3af', whiteSpace: 'nowrap' }}>{mv.user.firstName} · {new Date(mv.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
