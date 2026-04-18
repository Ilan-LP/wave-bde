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
  priceCents: number;
}

interface SaleEntry { item: StockItem; qty: number; }

type PaymentMethod = 'ESPECES' | 'CB' | 'AVOIR';

const PM_LABELS: Record<PaymentMethod, string> = { ESPECES: 'Espèces', CB: 'Carte', AVOIR: 'Avoir' };
const PM_COLORS: Record<PaymentMethod, string> = { ESPECES: '#16a34a', CB: '#2563eb', AVOIR: '#8b5cf6' };

export default function BuvettePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<Map<number, SaleEntry>>(new Map());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ESPECES');
  const [avoirCode, setAvoirCode] = useState('');
  const [saleSuccess, setSaleSuccess] = useState('');
  const [saleError, setSaleError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['buvette-items'],
    queryFn: () => api.get<{ items: StockItem[] }>('/buvette/items'),
    enabled: !!user,
  });

  const sellMutation = useMutation({
    mutationFn: (body: object) => api.post<{ success: boolean }>('/buvette/sell', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buvette-items'] });
    },
  });

  const items = data?.items ?? [];

  function addToCart(item: StockItem) {
    setCart(prev => {
      const next = new Map(prev);
      const entry = next.get(item.id);
      const newQty = (entry?.qty ?? 0) + 1;
      if (newQty > item.quantity) return prev;
      next.set(item.id, { item, qty: newQty });
      return next;
    });
  }

  function removeFromCart(itemId: number) {
    setCart(prev => {
      const next = new Map(prev);
      const entry = next.get(itemId);
      if (!entry) return prev;
      if (entry.qty <= 1) next.delete(itemId);
      else next.set(itemId, { ...entry, qty: entry.qty - 1 });
      return next;
    });
  }

  async function confirmSale() {
    setSaleError('');
    setSaleSuccess('');
    if (paymentMethod === 'AVOIR' && !avoirCode.trim()) {
      setSaleError('Saisissez le code avoir');
      return;
    }
    try {
      const entries = Array.from(cart.values());
      await sellMutation.mutateAsync({
        items: entries.map(e => ({ stockItemId: e.item.id, quantity: e.qty })),
        paymentMethod,
        avoirCode: paymentMethod === 'AVOIR' ? avoirCode.trim().toUpperCase() : undefined,
      });
      const total = entries.reduce((s, e) => s + e.item.priceCents * e.qty, 0);
      setSaleSuccess(`Vente validée — ${PM_LABELS[paymentMethod]} — Total : ${(total / 100).toFixed(2)} €`);
      setCart(new Map());
      setAvoirCode('');
      queryClient.invalidateQueries({ queryKey: ['buvette-items'] });
    } catch (err) {
      setSaleError((err as Error).message);
    }
  }

  const cartTotal = Array.from(cart.values()).reduce((s, e) => s + e.item.priceCents * e.qty, 0);
  const cartCount = Array.from(cart.values()).reduce((s, e) => s + e.qty, 0);

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>

        {/* Catalogue */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Buvette</h2>

          {saleSuccess && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '0.875rem 1rem', marginBottom: '1rem', color: '#16a34a', fontWeight: 600 }}>
              {saleSuccess}
            </div>
          )}

          {isLoading ? (
            <p style={{ color: '#666' }}>Chargement...</p>
          ) : items.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: 10, padding: '2rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', textAlign: 'center', color: '#9ca3af' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Aucun article disponible</p>
              <p style={{ fontSize: '0.85rem' }}>Marquez des articles comme "buvette" dans la section Stock.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
              {items.map(item => {
                const inCart = cart.get(item.id)?.qty ?? 0;
                const available = item.quantity - inCart;
                return (
                  <div key={item.id} style={{ background: '#fff', borderRadius: 12, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: available === 0 ? 0.5 : 1 }}>
                    <p style={{ fontWeight: 700, fontSize: '1rem' }}>{item.name}</p>
                    {item.description && <p style={{ fontSize: '0.8rem', color: '#888' }}>{item.description}</p>}
                    <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e94560' }}>
                      {item.priceCents > 0 ? `${(item.priceCents / 100).toFixed(2)} €` : 'Gratuit'}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: available <= 3 ? '#dc2626' : '#6b7280' }}>
                      Stock : {available} {item.unit}
                    </p>

                    {inCart > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 'auto' }}>
                        <button onClick={() => removeFromCart(item.id)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '1.1rem' }}>−</button>
                        <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{inCart}</span>
                        <button onClick={() => addToCart(item)} disabled={available === 0} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: '#e94560', color: '#fff', cursor: available === 0 ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '1.1rem' }}>+</button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(item)} disabled={available === 0}
                        style={{ marginTop: 'auto', padding: '0.5rem', background: available === 0 ? '#f3f4f6' : '#1a1a2e', color: available === 0 ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: available === 0 ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>
                        {available === 0 ? 'Rupture' : 'Ajouter'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Panier */}
        <div style={{ width: 300, background: '#fff', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', position: 'sticky', top: '2rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '1.1rem' }}>Panier</h3>

          {cart.size === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Aucun article sélectionné</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                {Array.from(cart.values()).map(entry => (
                  <div key={entry.item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span>{entry.item.name} × {entry.qty}</span>
                    <span style={{ fontWeight: 600 }}>{((entry.item.priceCents * entry.qty) / 100).toFixed(2)} €</span>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Total ({cartCount} article{cartCount > 1 ? 's' : ''})</span>
                  <span style={{ color: '#e94560' }}>{(cartTotal / 100).toFixed(2)} €</span>
                </div>
              </div>

              {/* Mode de paiement */}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>Mode de paiement</p>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {(['ESPECES', 'CB', 'AVOIR'] as PaymentMethod[]).map(pm => (
                    <button key={pm} onClick={() => setPaymentMethod(pm)}
                      style={{
                        flex: 1, padding: '0.4rem 0.2rem', fontSize: '0.75rem', fontWeight: 700, border: '2px solid',
                        borderColor: paymentMethod === pm ? PM_COLORS[pm] : '#e5e7eb',
                        background: paymentMethod === pm ? `${PM_COLORS[pm]}15` : '#fff',
                        color: paymentMethod === pm ? PM_COLORS[pm] : '#6b7280',
                        borderRadius: 8, cursor: 'pointer',
                      }}>
                      {PM_LABELS[pm]}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'AVOIR' && (
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.4rem' }}>Code avoir</p>
                  <input
                    type="text"
                    value={avoirCode}
                    onChange={e => setAvoirCode(e.target.value.toUpperCase())}
                    placeholder="AV-XXXXXXXX"
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'monospace', letterSpacing: '0.05em', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {saleError && <p style={{ color: '#dc2626', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{saleError}</p>}

              <button onClick={confirmSale} disabled={sellMutation.isPending}
                style={{ width: '100%', padding: '0.75rem', background: PM_COLORS[paymentMethod], color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '1rem' }}>
                {sellMutation.isPending ? 'Validation...' : `Valider — ${PM_LABELS[paymentMethod]}`}
              </button>

              <button onClick={() => setCart(new Map())}
                style={{ width: '100%', marginTop: '0.5rem', padding: '0.5rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.85rem' }}>
                Vider le panier
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
