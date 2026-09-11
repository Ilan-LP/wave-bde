import { useEffect, useState, type FormEvent } from "react";
import type { ProductAdmin } from "@wave/api-types";
import type { UseAuthResult } from "@wave/auth-client";
import { Banner, Button, Modal } from "@wave/ui";
import { createProduct, fetchAllProducts, setProductActive, updateProduct } from "../lib/products";

interface ProductsScreenProps {
  auth: UseAuthResult;
}

interface Outcome {
  variant: "success" | "error";
  message: string;
}

export function ProductsScreen({ auth }: ProductsScreenProps) {
  const [products, setProducts] = useState<ProductAdmin[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const [createName, setCreateName] = useState("");
  const [createPrice, setCreatePrice] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [editingProduct, setEditingProduct] = useState<ProductAdmin | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  function loadProducts() {
    fetchAllProducts()
      .then((loaded) => {
        setProducts(loaded);
        setLoadError(null);
      })
      .catch(() => setLoadError("Failed to load products."));
  }

  useEffect(loadProducts, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setIsCreating(true);
    setOutcome(null);
    try {
      await createProduct({ name: createName, pricePoints: Number(createPrice) });
      setCreateName("");
      setCreatePrice("");
      setOutcome({ variant: "success", message: "Product created." });
      loadProducts();
    } catch (err) {
      setOutcome({ variant: "error", message: err instanceof Error ? err.message : "request failed" });
    } finally {
      setIsCreating(false);
    }
  }

  function openEdit(product: ProductAdmin) {
    setOutcome(null);
    setEditingProduct(product);
    setEditName(product.name);
    setEditPrice(String(product.pricePoints));
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingProduct) {
      return;
    }
    setIsSavingEdit(true);
    try {
      await updateProduct(editingProduct.id, { name: editName, pricePoints: Number(editPrice) });
      setOutcome({ variant: "success", message: "Product updated." });
      setEditingProduct(null);
      loadProducts();
    } catch (err) {
      setOutcome({ variant: "error", message: err instanceof Error ? err.message : "request failed" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleToggleActive(product: ProductAdmin) {
    setTogglingId(product.id);
    setOutcome(null);
    try {
      await setProductActive(product.id, { isActive: !product.isActive });
      setOutcome({
        variant: "success",
        message: `${product.name} ${product.isActive ? "deactivated" : "activated"}.`,
      });
      loadProducts();
    } catch (err) {
      setOutcome({ variant: "error", message: err instanceof Error ? err.message : "request failed" });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-white p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-wave">Wave — Bureau — Products</h1>
        <Button variant="secondary" onClick={() => void auth.logout()}>
          Log out
        </Button>
      </header>

      {outcome && <Banner variant={outcome.variant}>{outcome.message}</Banner>}

      <form onSubmit={(e) => void handleCreate(e)} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="create-name">
            Name
          </label>
          <input
            id="create-name"
            type="text"
            required
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="create-price">
            Price (pts)
          </label>
          <input
            id="create-price"
            type="number"
            min={1}
            required
            value={createPrice}
            onChange={(e) => setCreatePrice(e.target.value)}
            className="mt-1 w-32 rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <Button type="submit" disabled={isCreating}>
          {isCreating ? "Adding…" : "Add product"}
        </Button>
      </form>

      {loadError && <Banner variant="error">{loadError}</Banner>}

      {products && (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {products.map((product) => (
            <li
              key={product.id}
              className={`flex items-center justify-between gap-3 p-4 ${product.isActive ? "" : "bg-gray-50"}`}
            >
              <div className={product.isActive ? "" : "text-gray-400"}>
                <p className="font-semibold">
                  {product.name}
                  {!product.isActive && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Inactive
                    </span>
                  )}
                </p>
                <p className="text-sm">{product.pricePoints} pts</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => openEdit(product)}>
                  Edit
                </Button>
                <Button
                  variant={product.isActive ? "danger" : "primary"}
                  disabled={togglingId === product.id}
                  onClick={() => void handleToggleActive(product)}
                >
                  {product.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingProduct && (
        <Modal title="Edit product" onClose={() => setEditingProduct(null)}>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="edit-name">
                Name
              </label>
              <input
                id="edit-name"
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="edit-price">
                Price (pts)
              </label>
              <input
                id="edit-price"
                type="number"
                min={1}
                required
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditingProduct(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
