"use client";

import React, { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Product, Collection, WearablesOverviewStats, ProductVariant, ProductStatus } from "@/lib/wearables/types";
import { calculateGrossMarginPaise, calculateMarginPercentage } from "@/lib/wearables/validation";

import { DesignStudioView } from "./DesignStudioView";
import { PODMappingView } from "./PODMappingView";
import { FulfillmentView } from "../fulfillment/FulfillmentView";

export function WearablesAdminContainer() {
  const pathname = usePathname();
  const router = useRouter();

  const activeTab = pathname.includes("/design-studio")
    ? "design-studio"
    : pathname.includes("/pod-mapping")
    ? "pod-mapping"
    : pathname.includes("/fulfillment")
    ? "fulfillment"
    : pathname.includes("/collections")
    ? "collections"
    : pathname.includes("/products")
    ? "products"
    : "overview";

  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor modal state
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [editingVariants, setEditingVariants] = useState<Partial<ProductVariant>[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/admin/wearables/products"),
        fetch("/api/admin/wearables/collections"),
      ]);

      if (pRes.ok) {
        const pData = await pRes.json();
        setProducts(pData.products || []);
      }
      if (cRes.ok) {
        const cData = await cRes.json();
        setCollections(cData.collections || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wearables data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const [pRes, cRes] = await Promise.all([
          fetch("/api/admin/wearables/products"),
          fetch("/api/admin/wearables/collections"),
        ]);
        if (!isMounted) return;
        if (pRes.ok) {
          const pData = await pRes.json();
          setProducts(pData.products || []);
        }
        if (cRes.ok) {
          const cData = await cRes.json();
          setCollections(cData.collections || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load wearables data");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const stats: WearablesOverviewStats = {
    publishedProductsCount: products.filter((p) => p.status === "active").length,
    draftProductsCount: products.filter((p) => p.status === "draft").length,
    activeVariantsCount: products.flatMap((p) => p.variants || []).filter((v) => v.isActive).length,
    collectionsCount: collections.length,
    productsMissingVariantsCount: products.filter((p) => (!p.variants || p.variants.length === 0)).length,
    productsMissingImageryCount: products.filter((p) => !p.primaryImageUrl && (!p.galleryJson || p.galleryJson.length === 0)).length,
    productsMissingProviderMappingCount: products.filter((p) => (p.variants || []).some((v) => v.providerCostPaise === 0)).length,
  };

  const openNewProduct = () => {
    setEditingProduct({
      title: "",
      slug: "",
      subtitle: "",
      description: "",
      status: "draft",
      basePricePaise: 0,
      currency: "INR",
      category: "wearables",
      gender: "unisex",
      isFeatured: false,
    });
    setEditingVariants([
      { size: "S", color: "black", colorDisplay: "Obsidian Black", pricePaise: 0, providerCostPaise: 0, availabilityStatus: "available", isActive: true },
      { size: "M", color: "black", colorDisplay: "Obsidian Black", pricePaise: 0, providerCostPaise: 0, availabilityStatus: "available", isActive: true },
      { size: "L", color: "black", colorDisplay: "Obsidian Black", pricePaise: 0, providerCostPaise: 0, availabilityStatus: "available", isActive: true },
    ]);
    setSaveErrors([]);
    setSaveSuccess(null);
  };

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setEditingVariants(p.variants || []);
    setSaveErrors([]);
    setSaveSuccess(null);
  };

  const handleSaveProduct = async () => {
    if (!editingProduct) return;
    setSaveLoading(true);
    setSaveErrors([]);
    setSaveSuccess(null);

    try {
      const payload = {
        ...editingProduct,
        variants: editingVariants,
      };

      const res = await fetch("/api/admin/wearables/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setSaveErrors(data.errors || [data.error || "Failed to save product"]);
      } else {
        setSaveSuccess("Product saved successfully.");
        await fetchData();
        setTimeout(() => {
          setEditingProduct(null);
        }, 1200);
      }
    } catch (err) {
      setSaveErrors([err instanceof Error ? err.message : "Network error"]);
    } finally {
      setSaveLoading(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 text-xs font-mono tracking-wider uppercase bg-white/5 border border-white/15 text-white/70 rounded">
              Wearables HQ
            </span>
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Ascend Catalogue Source of Truth
            </span>
          </div>
          <h1 className="text-2xl font-light tracking-tight text-white mt-2">
            Wearables Catalogue & Product Management
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Manage physical garment specs, active sizes/colors, authoritative prices, gross margins, and drop releases.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openNewProduct}
            className="px-4 py-2 text-xs font-mono tracking-wider uppercase bg-white text-black hover:bg-white/90 transition font-medium rounded"
          >
            + Create New Garment
          </button>
        </div>
      </div>

      {/* HQ Navigation Sub-Tabs */}
      <div className="flex border-b border-white/10 gap-8 text-sm overflow-x-auto">
        <button
          onClick={() => router.push("/admin/wearables")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "overview" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          Catalogue Overview
        </button>
        <button
          onClick={() => router.push("/admin/wearables/products")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "products" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          Master Products ({products.length})
        </button>
        <button
          onClick={() => router.push("/admin/wearables/collections")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "collections" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          Collections & Drops ({collections.length})
        </button>
        <button
          onClick={() => router.push("/admin/wearables/design-studio")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "design-studio" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          Design Studio 🎨
        </button>
        <button
          onClick={() => router.push("/admin/wearables/pod-mapping")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "pod-mapping" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          POD Mapping 🔗
        </button>
        <button
          onClick={() => router.push("/admin/wearables/fulfillment")}
          className={`pb-3 font-mono text-xs uppercase tracking-wider transition border-b-2 whitespace-nowrap ${activeTab === "fulfillment" ? "border-white text-white font-medium" : "border-transparent text-white/40 hover:text-white/70"}`}
        >
          POD Fulfilment 📦
        </button>
      </div>

      {activeTab === "design-studio" ? (
        <DesignStudioView products={products} />
      ) : activeTab === "pod-mapping" ? (
        <PODMappingView products={products} />
      ) : activeTab === "fulfillment" ? (
        <FulfillmentView />
      ) : loading ? (
        <div className="p-12 text-center text-sm font-mono text-white/40 border border-white/10 rounded">
          Loading Ascend Wearables Catalogue...
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded">
          {error}
        </div>
      ) : (
        <>
          {/* Tab 1: Overview Dashboard */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-white/5 border border-white/10 rounded">
                  <div className="text-xs font-mono uppercase tracking-wider text-white/40">Published Products</div>
                  <div className="text-2xl font-light text-white mt-1">{stats.publishedProductsCount}</div>
                </div>
                <div className="p-4 bg-white/5 border border-white/10 rounded">
                  <div className="text-xs font-mono uppercase tracking-wider text-white/40">Draft Products</div>
                  <div className="text-2xl font-light text-amber-400 mt-1">{stats.draftProductsCount}</div>
                </div>
                <div className="p-4 bg-white/5 border border-white/10 rounded">
                  <div className="text-xs font-mono uppercase tracking-wider text-white/40">Active SKUs</div>
                  <div className="text-2xl font-light text-emerald-400 mt-1">{stats.activeVariantsCount}</div>
                </div>
                <div className="p-4 bg-white/5 border border-white/10 rounded">
                  <div className="text-xs font-mono uppercase tracking-wider text-white/40">Collections / Drops</div>
                  <div className="text-2xl font-light text-white mt-1">{stats.collectionsCount}</div>
                </div>
              </div>

              {/* Readiness Checks */}
              <div className="p-6 bg-white/5 border border-white/10 rounded space-y-4">
                <h3 className="text-sm font-mono uppercase tracking-wider text-white/80">Catalogue Readiness Diagnostics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-black/40 border border-white/10 rounded">
                    <div className="text-xs font-mono text-white/50">Products Missing Variants</div>
                    <div className={`text-xl font-light mt-1 ${stats.productsMissingVariantsCount > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {stats.productsMissingVariantsCount}
                    </div>
                  </div>
                  <div className="p-4 bg-black/40 border border-white/10 rounded">
                    <div className="text-xs font-mono text-white/50">Products Missing Imagery</div>
                    <div className={`text-xl font-light mt-1 ${stats.productsMissingImageryCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {stats.productsMissingImageryCount}
                    </div>
                  </div>
                  <div className="p-4 bg-black/40 border border-white/10 rounded">
                    <div className="text-xs font-mono text-white/50">Products Missing Provider Cost Mapping</div>
                    <div className={`text-xl font-light mt-1 ${stats.productsMissingProviderMappingCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {stats.productsMissingProviderMappingCount}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Products List */}
          {activeTab === "products" && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-4 justify-between">
                <input
                  type="text"
                  placeholder="Search products by title or slug..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-4 py-2 bg-black/50 border border-white/15 text-white text-sm focus:outline-none focus:border-white/40 rounded w-full md:w-80"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white/40">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 bg-black border border-white/15 text-white text-xs font-mono rounded"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active / Published</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto border border-white/10 rounded">
                <table className="w-full text-left text-sm text-white/80">
                  <thead className="bg-white/5 text-xs font-mono uppercase tracking-wider text-white/40 border-b border-white/10">
                    <tr>
                      <th className="py-3 px-4">Garment Title</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Base Retail Price</th>
                      <th className="py-3 px-4">Active Variants</th>
                      <th className="py-3 px-4">Est. Gross Margin</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs font-mono text-white/40">
                          No garments matching criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((p) => {
                        const activeVars = (p.variants || []).filter((v) => v.isActive);
                        const sampleVar = activeVars[0] || (p.variants || [])[0];
                        const price = sampleVar ? sampleVar.pricePaise / 100 : p.basePricePaise / 100;
                        const cost = sampleVar ? sampleVar.providerCostPaise / 100 : 0;
                        const marginPct = sampleVar ? calculateMarginPercentage(sampleVar.pricePaise, sampleVar.providerCostPaise) : 0;

                        return (
                          <tr key={p.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4 font-medium text-white">
                              <div>{p.title}</div>
                              <div className="text-xs font-mono text-white/40">/{p.slug}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded ${p.status === "active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : p.status === "draft" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-white/5 text-white/40"}`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-white/60">{p.category}</td>
                            <td className="py-3 px-4 font-mono text-xs">₹{price.toLocaleString("en-IN")}</td>
                            <td className="py-3 px-4 font-mono text-xs">{activeVars.length} active SKUs</td>
                            <td className="py-3 px-4 font-mono text-xs">
                              {sampleVar ? (
                                <span className={marginPct >= 50 ? "text-emerald-400" : "text-amber-400"}>
                                  {marginPct}% (₹{(price - cost).toLocaleString("en-IN")})
                                </span>
                              ) : (
                                <span className="text-white/30">N/A</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => openEditProduct(p)}
                                className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs font-mono rounded transition"
                              >
                                Edit Garment
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Collections List */}
          {activeTab === "collections" && (
            <div className="space-y-6">
              <div className="overflow-x-auto border border-white/10 rounded">
                <table className="w-full text-left text-sm text-white/80">
                  <thead className="bg-white/5 text-xs font-mono uppercase tracking-wider text-white/40 border-b border-white/10">
                    <tr>
                      <th className="py-3 px-4">Collection / Drop Name</th>
                      <th className="py-3 px-4">Slug</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Assigned Products</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {collections.map((c) => {
                      const assigned = products.filter((p) => p.collectionId === c.id);
                      return (
                        <tr key={c.id}>
                          <td className="py-3 px-4 font-medium text-white">{c.name}</td>
                          <td className="py-3 px-4 font-mono text-xs text-white/60">/{c.slug}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                              {c.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs">{assigned.length} Products</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Editor Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-white/15 w-full max-w-3xl rounded p-6 space-y-6 max-h-[90vh] overflow-y-auto text-white">
            <div className="flex justify-between items-center pb-4 border-b border-white/10">
              <h2 className="text-lg font-light tracking-tight">
                {editingProduct.id ? `Edit Garment: ${editingProduct.title}` : "New Garment Product"}
              </h2>
              <button onClick={() => setEditingProduct(null)} className="text-white/40 hover:text-white font-mono text-xs">✕ Close</button>
            </div>

            {saveErrors.length > 0 && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono rounded space-y-1">
                <div className="font-bold uppercase">Validation / Save Errors:</div>
                {saveErrors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            {saveSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono rounded">
                ✓ {saveSuccess}
              </div>
            )}

            {/* General Fields */}
            <div className="space-y-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-white/50">1. Product Core Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1">Title *</label>
                  <input
                    type="text"
                    value={editingProduct.title || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, title: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/15 text-sm rounded"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1">Slug *</label>
                  <input
                    type="text"
                    value={editingProduct.slug || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, slug: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/15 text-sm rounded font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-white/60 mb-1">Description *</label>
                <textarea
                  rows={2}
                  value={editingProduct.description || ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  className="w-full px-3 py-2 bg-black border border-white/15 text-sm rounded"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1">Status</label>
                  <select
                    value={editingProduct.status || "draft"}
                    onChange={(e) => setEditingProduct({ ...editingProduct, status: e.target.value as ProductStatus })}
                    className="w-full px-3 py-2 bg-black border border-white/15 text-xs font-mono rounded"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active (Published)</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1">Category</label>
                  <select
                    value={editingProduct.category || "apparel"}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/15 text-xs font-mono rounded"
                  >
                    <option value="apparel">Apparel</option>
                    <option value="eyewear">Eyewear</option>
                    <option value="accessories">Accessories</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1">Primary Image URL</label>
                  <input
                    type="text"
                    value={editingProduct.primaryImageUrl || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, primaryImageUrl: e.target.value })}
                    className="w-full px-3 py-2 bg-black border border-white/15 text-xs font-mono rounded"
                  />
                </div>
              </div>
            </div>

            {/* Variants Matrix */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-mono uppercase tracking-wider text-white/50">2. Size & Color Variants (SKU Matrix)</h3>
                <button
                  type="button"
                  onClick={() => setEditingVariants([...editingVariants, { size: "M", color: "black", pricePaise: 0, providerCostPaise: 0, isActive: true, availabilityStatus: "available" }])}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white text-xs font-mono rounded"
                >
                  + Add Variant
                </button>
              </div>

              <div className="space-y-3">
                {editingVariants.map((v, idx) => {
                  const price = (v.pricePaise || 0) / 100;
                  const cost = (v.providerCostPaise || 0) / 100;
                  const margin = calculateGrossMarginPaise(v.pricePaise || 0, v.providerCostPaise || 0) / 100;

                  return (
                    <div key={idx} className="p-3 bg-black/40 border border-white/10 rounded grid grid-cols-6 gap-2 items-center text-xs">
                      <div>
                        <span className="text-[10px] text-white/40 block">SKU</span>
                        <input
                          type="text"
                          value={v.sku || ""}
                          placeholder="AUTO-SKU"
                          onChange={(e) => {
                            const copy = [...editingVariants];
                            copy[idx] = { ...copy[idx], sku: e.target.value };
                            setEditingVariants(copy);
                          }}
                          className="w-full px-2 py-1 bg-black border border-white/15 rounded font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 block">Size</span>
                        <input
                          type="text"
                          value={v.size || ""}
                          onChange={(e) => {
                            const copy = [...editingVariants];
                            copy[idx] = { ...copy[idx], size: e.target.value };
                            setEditingVariants(copy);
                          }}
                          className="w-full px-2 py-1 bg-black border border-white/15 rounded font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 block">Price (₹)</span>
                        <input
                          type="number"
                          value={price || 0}
                          onChange={(e) => {
                            const copy = [...editingVariants];
                            copy[idx] = { ...copy[idx], pricePaise: Math.round(Number(e.target.value) * 100) };
                            setEditingVariants(copy);
                          }}
                          className="w-full px-2 py-1 bg-black border border-white/15 rounded font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 block">Cost (₹)</span>
                        <input
                          type="number"
                          value={cost || 0}
                          onChange={(e) => {
                            const copy = [...editingVariants];
                            copy[idx] = { ...copy[idx], providerCostPaise: Math.round(Number(e.target.value) * 100) };
                            setEditingVariants(copy);
                          }}
                          className="w-full px-2 py-1 bg-black border border-white/15 rounded font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-white/40 block">Margin</span>
                        <span className="font-mono text-emerald-400">₹{margin}</span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const copy = editingVariants.filter((_, i) => i !== idx);
                            setEditingVariants(copy);
                          }}
                          className="text-rose-400 hover:text-rose-300 font-mono text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 border border-white/15 text-white/70 hover:text-white text-xs font-mono rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveLoading}
                onClick={handleSaveProduct}
                className="px-6 py-2 bg-white text-black font-medium text-xs font-mono uppercase tracking-wider rounded hover:bg-white/90 transition disabled:opacity-50"
              >
                {saveLoading ? "Saving..." : "Save & Publish Garment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
