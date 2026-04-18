'use client';

import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Stats {
  recettesCents: number;
  depensesCents: number;
  soldeCents: number;
  ventesBuvetteCents: number;
  nbVentesBuvette: number;
}

interface Transaction {
  id: number;
  type: 'RECETTE' | 'DEPENSE';
  amountCents: number;
  category: string | null;
  description: string;
  date: string;
  invoiceUrl: string | null;
  createdAt: string;
  createdBy: { id: number; firstName: string; lastName: string };
}

interface BuvetteVenteItem { quantity: number; priceCents: number; stockItem: { id: number; name: string }; }
interface BuvetteVente {
  id: number;
  totalCents: number;
  paymentMethod: 'ESPECES' | 'CB' | 'AVOIR';
  avoirCode: string | null;
  createdAt: string;
  vendeur: { id: number; firstName: string; lastName: string };
  items: BuvetteVenteItem[];
}

const PM_LABELS: Record<string, string> = { ESPECES: 'Espèces', CB: 'Carte', AVOIR: 'Avoir' };
const PM_COLORS: Record<string, string> = { ESPECES: '#16a34a', CB: '#2563eb', AVOIR: '#8b5cf6' };
const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000';

const inp: React.CSSProperties = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' };

type Tab = 'overview' | 'ventes' | 'transactions';

interface TxForm { type: 'RECETTE' | 'DEPENSE'; amountEuros: string; category: string; description: string; date: string; }

export default function TresoreriePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invoiceRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('overview');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [txForm, setTxForm] = useState<TxForm>({ type: 'RECETTE', amountEuros: '', category: '', description: '', date: new Date().toISOString().slice(0, 10) });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data: statsData } = useQuery({
    queryKey: ['treso-stats'],
    queryFn: () => api.get<{ stats: Stats }>('/treso/stats'),
    enabled: !!user,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['treso-transactions', typeFilter],
    queryFn: () => api.get<{ transactions: Transaction[] }>(`/treso/transactions${typeFilter ? `?type=${typeFilter}` : ''}`),
    enabled: !!user,
  });

  const { data: ventesData, isLoading: ventesLoading } = useQuery({
    queryKey: ['buvette-ventes'],
    queryFn: () => api.get<{ ventes: BuvetteVente[] }>('/buvette/ventes'),
    enabled: !!user && tab === 'ventes',
  });

  const createMutation = useMutation({
    mutationFn: async (body: FormData) => {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${API_BASE}/api/v1/treso/transactions`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
        credentials: 'include',
      });
      const json = await res.json() as { success: boolean; message?: string; transaction?: Transaction };
      if (!res.ok) throw new Error(json.message ?? 'Erreur');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treso-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['treso-stats'] });
      setShowCreate(false);
      setTxForm({ type: 'RECETTE', amountEuros: '', category: '', description: '', date: new Date().toISOString().slice(0, 10) });
      setInvoiceFile(null);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api.patch<{ transaction: Transaction }>(`/treso/transactions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treso-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['treso-stats'] });
      setEditTx(null); setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<{ success: boolean }>(`/treso/transactions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treso-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['treso-stats'] });
      setEditTx(null);
    },
  });

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!txForm.description || !txForm.amountEuros || !txForm.date) { setError('Tous les champs requis'); return; }
    const fd = new FormData();
    fd.append('type', txForm.type);
    fd.append('amountCents', String(Math.round(parseFloat(txForm.amountEuros) * 100)));
    fd.append('description', txForm.description);
    fd.append('date', txForm.date);
    if (txForm.category) fd.append('category', txForm.category);
    if (invoiceFile) fd.append('invoice', invoiceFile);
    createMutation.mutate(fd);
  }

  async function uploadInvoiceForTx(txId: number, file: File) {
    setUploading(true);
    try {
      const token = localStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('invoice', file);
      const res = await fetch(`${API_BASE}/api/v1/treso/transactions/${txId}/invoice`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd, credentials: 'include',
      });
      if (!res.ok) throw new Error('Erreur upload');
      queryClient.invalidateQueries({ queryKey: ['treso-transactions'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const canManage = user?.role === 'ADMIN' || user?.role === 'POLE_LEAD';
  const isAdmin = user?.role === 'ADMIN';
  const stats = statsData?.stats;
  const transactions = txData?.transactions ?? [];
  const ventes = ventesData?.ventes ?? [];

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: 960 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Trésorerie</h2>
          {canManage && (
            <button onClick={() => { setShowCreate(true); setError(''); }}
              style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
              + Ajouter une transaction
            </button>
          )}
        </div>

        {/* Stats cards */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
            {[
              { label: 'Recettes', value: stats.recettesCents, color: '#16a34a' },
              { label: 'Dépenses', value: stats.depensesCents, color: '#dc2626' },
              { label: 'Solde', value: stats.soldeCents, color: stats.soldeCents >= 0 ? '#1a1a2e' : '#dc2626' },
              { label: `Buvette (${stats.nbVentesBuvette} ventes)`, value: stats.ventesBuvetteCents, color: '#8b5cf6' },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#9ca3af', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</p>
                <p style={{ fontSize: '1.4rem', fontWeight: 700, color: card.color }}>
                  {card.value < 0 ? '-' : ''}{(Math.abs(card.value) / 100).toFixed(2)} €
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', background: '#f3f4f6', borderRadius: 8, padding: '0.25rem' }}>
          {([['overview', 'Vue d\'ensemble'], ['ventes', 'Ventes buvette'], ['transactions', 'Transactions']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex: 1, padding: '0.5rem', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#1a1a2e' : '#6b7280', boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab: Vue d'ensemble */}
        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Dernières recettes */}
              <div>
                <h3 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.75rem', color: '#16a34a' }}>Dernières recettes</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {transactions.filter(t => t.type === 'RECETTE').slice(0, 5).map(t => (
                    <div key={t.id} style={{ background: '#fff', borderRadius: 8, padding: '0.75rem 1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between' }}>
                      <div><p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.description}</p><p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{new Date(t.date).toLocaleDateString('fr-FR')} {t.category && `· ${t.category}`}</p></div>
                      <span style={{ fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>+{(t.amountCents / 100).toFixed(2)} €</span>
                    </div>
                  ))}
                  {transactions.filter(t => t.type === 'RECETTE').length === 0 && <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Aucune recette enregistrée</p>}
                </div>
              </div>
              {/* Dernières dépenses */}
              <div>
                <h3 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.75rem', color: '#dc2626' }}>Dernières dépenses</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {transactions.filter(t => t.type === 'DEPENSE').slice(0, 5).map(t => (
                    <div key={t.id} style={{ background: '#fff', borderRadius: 8, padding: '0.75rem 1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between' }}>
                      <div><p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.description}</p><p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{new Date(t.date).toLocaleDateString('fr-FR')} {t.category && `· ${t.category}`}</p></div>
                      <span style={{ fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap' }}>−{(t.amountCents / 100).toFixed(2)} €</span>
                    </div>
                  ))}
                  {transactions.filter(t => t.type === 'DEPENSE').length === 0 && <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Aucune dépense enregistrée</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Ventes buvette */}
        {tab === 'ventes' && (
          <div>
            {ventesLoading ? <p style={{ color: '#666' }}>Chargement...</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {ventes.map(v => (
                  <div key={v.id} style={{ background: '#fff', borderRadius: 8, padding: '1rem 1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {v.vendeur.firstName} {v.vendeur.lastName}
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: `${PM_COLORS[v.paymentMethod]}18`, color: PM_COLORS[v.paymentMethod], fontWeight: 700 }}>
                            {PM_LABELS[v.paymentMethod]}
                          </span>
                          {v.avoirCode && <span style={{ marginLeft: '0.4rem', fontSize: '0.78rem', color: '#9ca3af', fontFamily: 'monospace' }}>{v.avoirCode}</span>}
                        </p>
                        <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                          {new Date(v.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a1a2e' }}>{(v.totalCents / 100).toFixed(2)} €</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {v.items.map((item, i) => (
                        <span key={i} style={{ fontSize: '0.78rem', padding: '0.15rem 0.5rem', background: '#f3f4f6', borderRadius: 10, color: '#555' }}>
                          {item.stockItem.name} ×{item.quantity}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {ventes.length === 0 && <p style={{ color: '#9ca3af' }}>Aucune vente enregistrée</p>}
              </div>
            )}
          </div>
        )}

        {/* Tab: Transactions */}
        {tab === 'transactions' && (
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {([['', 'Tous'], ['RECETTE', 'Recettes'], ['DEPENSE', 'Dépenses']] as const).map(([val, label]) => (
                <button key={val} onClick={() => setTypeFilter(val)}
                  style={{ padding: '0.375rem 0.875rem', borderRadius: 20, border: '1px solid #ddd', fontSize: '0.85rem', cursor: 'pointer', background: typeFilter === val ? '#1a1a2e' : '#fff', color: typeFilter === val ? '#fff' : '#333' }}>
                  {label}
                </button>
              ))}
            </div>

            {txLoading ? <p style={{ color: '#666' }}>Chargement...</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {transactions.map(t => (
                  <div key={t.id} style={{ background: '#fff', borderRadius: 8, padding: '1rem 1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: t.type === 'RECETTE' ? '#16a34a' : '#dc2626', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.description}</p>
                      <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                        {new Date(t.date).toLocaleDateString('fr-FR')} {t.category && `· ${t.category}`} · {t.createdBy.firstName} {t.createdBy.lastName}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {t.invoiceUrl ? (
                        <a href={`${API_BASE}${t.invoiceUrl}`} target="_blank" rel="noopener" title="Voir la facture"
                          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 5, textDecoration: 'none' }}>
                          📄 Facture
                        </a>
                      ) : canManage ? (
                        <label style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: '#f3f4f6', color: '#9ca3af', border: '1px dashed #d1d5db', borderRadius: 5, cursor: 'pointer' }}>
                          + Facture
                          <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={async e => { const f = e.target.files?.[0]; if (f) await uploadInvoiceForTx(t.id, f); e.target.value = ''; }} />
                        </label>
                      ) : null}
                      <span style={{ fontWeight: 700, fontSize: '1rem', color: t.type === 'RECETTE' ? '#16a34a' : '#dc2626', whiteSpace: 'nowrap' }}>
                        {t.type === 'RECETTE' ? '+' : '−'}{(t.amountCents / 100).toFixed(2)} €
                      </span>
                      {canManage && (
                        <button onClick={() => {
                          setEditTx(t);
                          setTxForm({ type: t.type, amountEuros: String(t.amountCents / 100), category: t.category ?? '', description: t.description, date: t.date.slice(0, 10) });
                          setError('');
                        }}
                          style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer' }}>
                          Modifier
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && <p style={{ color: '#9ca3af' }}>Aucune transaction</p>}
              </div>
            )}
          </div>
        )}

        {/* Modal création */}
        {showCreate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Nouvelle transaction</h3>
              <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['RECETTE', 'DEPENSE'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTxForm(f => ({ ...f, type: t }))}
                      style={{ flex: 1, padding: '0.5rem', border: '2px solid', borderColor: txForm.type === t ? (t === 'RECETTE' ? '#16a34a' : '#dc2626') : '#e5e7eb', borderRadius: 8, fontWeight: 700, cursor: 'pointer', background: txForm.type === t ? (t === 'RECETTE' ? '#f0fdf4' : '#fef2f2') : '#fff', color: txForm.type === t ? (t === 'RECETTE' ? '#16a34a' : '#dc2626') : '#6b7280' }}>
                      {t === 'RECETTE' ? '+ Recette' : '− Dépense'}
                    </button>
                  ))}
                </div>
                <div><label style={lbl}>Description *</label><input style={inp} value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} required /></div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Montant (€) *</label><input type="number" step="0.01" min="0.01" style={inp} value={txForm.amountEuros} onChange={e => setTxForm(f => ({ ...f, amountEuros: e.target.value }))} required /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Date *</label><input type="date" style={inp} value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} required /></div>
                </div>
                <div><label style={lbl}>Catégorie</label><input style={inp} placeholder="ex: Achat matériel, Subvention…" value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))} /></div>
                <div>
                  <label style={lbl}>Facture / justificatif (optionnel)</label>
                  <input type="file" accept="image/*,.pdf" onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)} style={{ fontSize: '0.85rem' }} />
                  {invoiceFile && <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.25rem' }}>{invoiceFile.name}</p>}
                </div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setShowCreate(false); setError(''); setInvoiceFile(null); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                  <button type="submit" disabled={createMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                    {createMutation.isPending ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal édition transaction */}
        {editTx && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ fontWeight: 700, marginBottom: '1.5rem' }}>Modifier la transaction</h3>
              <form onSubmit={e => { e.preventDefault(); updateMutation.mutate({ id: editTx.id, body: { type: txForm.type, amountCents: Math.round(parseFloat(txForm.amountEuros) * 100), category: txForm.category || undefined, description: txForm.description, date: txForm.date } }); }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['RECETTE', 'DEPENSE'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTxForm(f => ({ ...f, type: t }))}
                      style={{ flex: 1, padding: '0.5rem', border: '2px solid', borderColor: txForm.type === t ? (t === 'RECETTE' ? '#16a34a' : '#dc2626') : '#e5e7eb', borderRadius: 8, fontWeight: 700, cursor: 'pointer', background: txForm.type === t ? (t === 'RECETTE' ? '#f0fdf4' : '#fef2f2') : '#fff', color: txForm.type === t ? (t === 'RECETTE' ? '#16a34a' : '#dc2626') : '#6b7280' }}>
                      {t === 'RECETTE' ? '+ Recette' : '− Dépense'}
                    </button>
                  ))}
                </div>
                <div><label style={lbl}>Description</label><input style={inp} value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} /></div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}><label style={lbl}>Montant (€)</label><input type="number" step="0.01" min="0.01" style={inp} value={txForm.amountEuros} onChange={e => setTxForm(f => ({ ...f, amountEuros: e.target.value }))} /></div>
                  <div style={{ flex: 1 }}><label style={lbl}>Date</label><input type="date" style={inp} value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} /></div>
                </div>
                <div><label style={lbl}>Catégorie</label><input style={inp} value={txForm.category} onChange={e => setTxForm(f => ({ ...f, category: e.target.value }))} /></div>
                {error && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  {isAdmin && (
                    <button type="button" onClick={() => { if (confirm('Supprimer cette transaction ?')) deleteMutation.mutate(editTx.id); }}
                      style={{ padding: '0.5rem 1rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                      Supprimer
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem', marginLeft: 'auto' }}>
                    <button type="button" onClick={() => { setEditTx(null); setError(''); }} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Annuler</button>
                    <button type="submit" disabled={updateMutation.isPending} style={{ padding: '0.5rem 1.25rem', background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                      {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
