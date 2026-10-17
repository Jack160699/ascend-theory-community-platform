"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { Product } from "@/lib/wearables/types";
import type {
  PODProvider,
  ProviderProduct,
  ProviderVariant,
  MappingStatus,
  PrintMethod,
  PrintableAreaSpec,
  PlacementLocation,
} from "@/lib/wearables/design-types";

type PODMappingViewProps = {
  products: Product[];
};

export function PODMappingView({ products }: PODMappingViewProps) {
  const [providers, setProviders] = useState<PODProvider[]>([]);
  const [providerProducts, setProviderProducts] = useState<ProviderProduct[]>([]);
  const [providerVariants, setProviderVariants] = useState<ProviderVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || "");

  // Form inputs
  const [existingProviderProductId, setExistingProviderProductId] = useState<string | undefined>(undefined);
  const [extProductId, setExtProductId] = useState("");
  const [providerProdTitle, setProviderProdTitle] = useState("");
  const [mappingStatus, setMappingStatus] = useState<MappingStatus>("mapped");
  const [notes, setNotes] = useState("");

  // Print Methods & Printable Areas Configuration (Req #9 & #10)
  const [printMethods, setPrintMethods] = useState<PrintMethod[]>(["dtf"]);
  const [printableAreas, setPrintableAreas] = useState<PrintableAreaSpec[]>([]);

  // Add new printable area input state
  const [newAreaLocation, setNewAreaLocation] = useState<PlacementLocation>("front");
  const [newAreaMethod, setNewAreaMethod] = useState<PrintMethod>("dtf");
  const [newAreaWidthMm, setNewAreaWidthMm] = useState<number>(300);
  const [newAreaHeightMm, setNewAreaHeightMm] = useState<number>(400);

  // Variant mappings dictionary: productVariantId -> { id?, externalVariantId, externalSku, mappingStatus } (Req #3)
  const [variantMappings, setVariantMappings] = useState<
    Record<string, { id?: string; externalVariantId: string; externalSku: string; mappingStatus: MappingStatus }>
  >({});

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchMappingData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/wearables/pod-mappings");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
        setProviderProducts(data.providerProducts || []);
        setProviderVariants(data.providerVariants || []);
      } else {
        setError("Failed to fetch POD provider mappings");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/admin/wearables/pod-mappings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data) {
          setProviders(data.providers || []);
          setProviderProducts(data.providerProducts || []);
          setProviderVariants(data.providerVariants || []);
          if (data.providers && data.providers.length > 0) {
            setSelectedProviderId(data.providers[0].id);
          }
        }
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0],
    [products, selectedProductId],
  );

  const syncFormState = useCallback(
    (prodId: string, provId: string) => {
      const existingPP = providerProducts.find(
        (pp) => pp.productId === prodId && pp.providerId === provId,
      );

      if (existingPP) {
        setExistingProviderProductId(existingPP.id);
        setExtProductId(existingPP.externalProductId || "");
        setProviderProdTitle(existingPP.title || existingPP.name || "");
        setMappingStatus(existingPP.mappingStatus || "mapped");
        setNotes(existingPP.notes || "");
        setPrintMethods(existingPP.printMethodsJson && existingPP.printMethodsJson.length > 0 ? existingPP.printMethodsJson : ["dtf"]);
        setPrintableAreas(existingPP.printableAreasJson || []);

        const mappedVars = providerVariants.filter((pv) => pv.providerProductId === existingPP.id);
        const mapDict: Record<string, { id?: string; externalVariantId: string; externalSku: string; mappingStatus: MappingStatus }> = {};
        mappedVars.forEach((v) => {
          if (v.productVariantId) {
            mapDict[v.productVariantId] = {
              id: v.id,
              externalVariantId: v.externalVariantId,
              externalSku: v.externalSku || v.sku || "",
              mappingStatus: v.mappingStatus || "unmapped",
            };
          }
        });
        setVariantMappings(mapDict);
      } else {
        setExistingProviderProductId(undefined);
        setExtProductId("");
        setProviderProdTitle("");
        setMappingStatus("unmapped");
        setNotes("");
        setPrintMethods(["dtf"]);
        setPrintableAreas([]);
        setVariantMappings({});
      }
    },
    [providerProducts, providerVariants],
  );

  const handleProviderSelect = (provId: string) => {
    setSelectedProviderId(provId);
    syncFormState(selectedProductId, provId);
  };

  const handleProductSelect = (prodId: string) => {
    setSelectedProductId(prodId);
    syncFormState(prodId, selectedProviderId);
  };

  const handleAddPrintableArea = () => {
    if (newAreaWidthMm <= 0 || newAreaHeightMm <= 0) return;
    const newSpec: PrintableAreaSpec = {
      location: newAreaLocation,
      maxWidthMm: newAreaWidthMm,
      maxHeightMm: newAreaHeightMm,
      printMethod: newAreaMethod,
    };
    setPrintableAreas((prev) => {
      const filtered = prev.filter(
        (s) =>
          (s.location || (s as unknown as { placementLocation?: string }).placementLocation) !== newAreaLocation ||
          s.printMethod !== newAreaMethod,
      );
      return [...filtered, newSpec];
    });
  };

  const handleRemovePrintableArea = (index: number) => {
    setPrintableAreas((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId || !selectedProductId || !extProductId.trim()) return;

    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(null);

    const variantsPayload = Object.entries(variantMappings).map(([pVarId, vData]) => ({
      id: vData.id,
      productVariantId: pVarId,
      externalVariantId: vData.externalVariantId,
      externalSku: vData.externalSku,
      mappingStatus: vData.mappingStatus || "unmapped", // Independent per variant (Req #3 & #4)
    }));

    try {
      const res = await fetch("/api/admin/wearables/pod-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerProduct: {
            id: existingProviderProductId,
            providerId: selectedProviderId,
            productId: selectedProductId,
            externalProductId: extProductId.trim(),
            title: providerProdTitle.trim() || undefined,
            printMethodsJson: printMethods,
            printableAreasJson: printableAreas,
            mappingStatus,
            notes: notes.trim() || undefined,
          },
          providerVariants: variantsPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSaveError(data.error || "Failed to save POD mapping");
      } else {
        setSaveSuccess("POD provider product & variant mappings saved successfully.");
        await fetchMappingData();
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-sm font-mono text-white/50">Loading POD Provider Mappings...</div>;
  }

  const allPrintMethodsList: PrintMethod[] = ["dtf", "dtg", "screen_print", "embroidery", "sublimation", "other"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900/60 p-6 rounded-lg border border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded uppercase">
              Operational Metadata
            </span>
            <h2 className="text-xl font-bold tracking-tight text-white">Print-on-Demand Provider Mapping</h2>
          </div>
          <p className="text-xs text-white/60 mt-1">
            Map internal Ascend garments & exact variant SKUs to external provider identifiers (Qikink, Printrove). Strictly internal operational data.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/80 border border-red-500/40 rounded-md text-red-200 text-xs font-mono">
          🚨 {error}
        </div>
      )}
      {saveError && (
        <div className="p-4 bg-red-950/80 border border-red-500/40 rounded-md text-red-200 text-xs font-mono">
          🚨 {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-md text-emerald-200 text-xs font-mono">
          ✓ {saveSuccess}
        </div>
      )}

      {/* Mapping Configuration Form */}
      <form onSubmit={handleSaveMapping} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Provider & Garment Selection */}
          <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
            <h3 className="text-sm font-bold font-mono text-white uppercase border-b border-white/10 pb-2">
              1. Provider & Ascend Garment Selection
            </h3>

            <div>
              <label className="text-xs font-mono text-white/60 block mb-1">POD Provider *</label>
              <select
                value={selectedProviderId}
                onChange={(e) => handleProviderSelect(e.target.value)}
                className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-mono text-white/60 block mb-1">Ascend Garment Product *</label>
              <select
                value={selectedProductId}
                onChange={(e) => handleProductSelect(e.target.value)}
                className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.slug})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono text-white/60 block mb-1">Provider Ext Product ID *</label>
                <input
                  type="text"
                  required
                  value={extProductId}
                  onChange={(e) => setExtProductId(e.target.value)}
                  className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
                  placeholder="e.g. QIK-HOOD-100"
                />
              </div>
              <div>
                <label className="text-xs font-mono text-white/60 block mb-1">Product Mapping Status</label>
                <select
                  value={mappingStatus}
                  onChange={(e) => setMappingStatus(e.target.value as MappingStatus)}
                  className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
                >
                  <option value="unmapped">Unmapped</option>
                  <option value="draft">Draft</option>
                  <option value="mapped">Mapped</option>
                  <option value="verified">Verified (Approved for Production)</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-mono text-white/60 block mb-1">Provider Product Title / Catalog Name</label>
              <input
                type="text"
                value={providerProdTitle}
                onChange={(e) => setProviderProdTitle(e.target.value)}
                className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
                placeholder="e.g. Heavyweight Unisex Hoodie 350GSM"
              />
            </div>

            {/* HQ Print Method Configuration */}
            <div className="p-3 bg-black/40 border border-white/10 rounded-md space-y-2">
              <label className="text-xs font-mono text-white/80 block">Supported Print Methods *</label>
              <div className="grid grid-cols-3 gap-2">
                {allPrintMethodsList.map((method) => (
                  <label key={method} className="flex items-center space-x-2 text-xs font-mono text-white/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={printMethods.includes(method)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPrintMethods((prev) => [...prev, method]);
                        } else {
                          setPrintMethods((prev) => prev.filter((m) => m !== method));
                        }
                      }}
                      className="rounded bg-black border-white/20"
                    />
                    <span className="uppercase">{method}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Printable Area Specs Configuration Editor */}
          <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
            <h3 className="text-sm font-bold font-mono text-white uppercase border-b border-white/10 pb-2">
              2. Provider Printable Area Specifications
            </h3>

            {/* Existing printable areas list */}
            <div className="space-y-2 max-h-36 overflow-y-auto">
              {printableAreas.length === 0 ? (
                <p className="text-xs font-mono text-white/40 italic">No printable area specs defined for this provider product.</p>
              ) : (
                printableAreas.map((spec, idx) => (
                  <div key={idx} className="p-2 bg-black/40 border border-white/10 rounded flex justify-between items-center text-xs font-mono text-white">
                    <span>
                      <strong className="uppercase text-amber-300">{spec.location || (spec as unknown as { placementLocation?: string }).placementLocation}</strong> ({spec.printMethod.toUpperCase()}): {spec.maxWidthMm}mm × {spec.maxHeightMm}mm max
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePrintableArea(idx)}
                      className="text-red-400 hover:text-red-300 text-[10px]"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add Printable Area Spec Input Row */}
            <div className="p-3 bg-black/40 border border-white/10 rounded-md space-y-3">
              <span className="text-xs font-mono text-white/80 block font-bold">+ Add Printable Area Spec</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-white/60 block">Location</label>
                  <select
                    value={newAreaLocation}
                    onChange={(e) => setNewAreaLocation(e.target.value as PlacementLocation)}
                    className="w-full bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white"
                  >
                    <option value="front">Front</option>
                    <option value="back">Back</option>
                    <option value="left_chest">Left Chest</option>
                    <option value="right_chest">Right Chest</option>
                    <option value="left_sleeve">Left Sleeve</option>
                    <option value="right_sleeve">Right Sleeve</option>
                    <option value="neck">Neck Label</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-white/60 block">Technique</label>
                  <select
                    value={newAreaMethod}
                    onChange={(e) => setNewAreaMethod(e.target.value as PrintMethod)}
                    className="w-full bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white"
                  >
                    <option value="dtf">DTF</option>
                    <option value="dtg">DTG</option>
                    <option value="screen_print">Screen Print</option>
                    <option value="embroidery">Embroidery</option>
                    <option value="sublimation">Sublimation</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-white/60 block">Max Width (mm)</label>
                  <input
                    type="number"
                    min={1}
                    value={newAreaWidthMm}
                    onChange={(e) => setNewAreaWidthMm(parseInt(e.target.value) || 0)}
                    className="w-full bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-white/60 block">Max Height (mm)</label>
                  <input
                    type="number"
                    min={1}
                    value={newAreaHeightMm}
                    onChange={(e) => setNewAreaHeightMm(parseInt(e.target.value) || 0)}
                    className="w-full bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddPrintableArea}
                className="w-full py-1 bg-white/20 hover:bg-white/30 text-white font-mono text-xs rounded transition"
              >
                Add Area Spec
              </button>
            </div>

            <div>
              <label className="text-xs font-mono text-white/60 block mb-1">Operational Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-black/60 border border-white/20 rounded p-2 text-xs font-mono text-white"
                placeholder="Internal mapping notes, fabric blend restrictions, setup charges."
              />
            </div>
          </div>
        </div>

        {/* Variant SKU Mappings */}
        <div className="bg-zinc-900/40 border border-white/10 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-bold font-mono text-white uppercase border-b border-white/10 pb-2">
            3. Variant SKU Identifiers Mapping ({selectedProduct?.variants?.length || 0} Variants)
          </h3>

          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {(selectedProduct?.variants || []).map((v) => {
              const currentVal = variantMappings[v.id] || { externalVariantId: "", externalSku: "", mappingStatus: "unmapped" };
              return (
                <div key={v.id} className="p-3 bg-black/30 border border-white/10 rounded flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs">
                  <div>
                    <span className="font-bold text-white">
                      {v.size} / {v.color}
                    </span>
                    <span className="text-white/40 block text-[11px]">Ascend SKU: {v.sku}</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div>
                      <label className="text-[10px] text-white/50 block">Provider Ext Variant ID</label>
                      <input
                        type="text"
                        value={currentVal.externalVariantId}
                        onChange={(e) =>
                          setVariantMappings({
                            ...variantMappings,
                            [v.id]: { ...currentVal, externalVariantId: e.target.value },
                          })
                        }
                        className="bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white w-36"
                        placeholder="e.g. QIK-VAR-BLK-M"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 block">Provider Ext SKU</label>
                      <input
                        type="text"
                        value={currentVal.externalSku}
                        onChange={(e) =>
                          setVariantMappings({
                            ...variantMappings,
                            [v.id]: { ...currentVal, externalSku: e.target.value },
                          })
                        }
                        className="bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white w-36"
                        placeholder="e.g. QIK-SKU-BLK-M"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 block">Variant Status</label>
                      <select
                        value={currentVal.mappingStatus}
                        onChange={(e) =>
                          setVariantMappings({
                            ...variantMappings,
                            [v.id]: { ...currentVal, mappingStatus: e.target.value as MappingStatus },
                          })
                        }
                        className="bg-black/60 border border-white/20 rounded p-1.5 text-xs font-mono text-white w-28"
                      >
                        <option value="unmapped">Unmapped</option>
                        <option value="draft">Draft</option>
                        <option value="mapped">Mapped</option>
                        <option value="verified">Verified</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-white/10">
          <button
            type="submit"
            disabled={saveLoading}
            className="px-6 py-2.5 bg-white text-black font-mono font-bold text-xs rounded hover:bg-white/90 transition"
          >
            {saveLoading ? "Saving Mapping..." : "Save Provider Product & Variant Mappings"}
          </button>
        </div>
      </form>
    </div>
  );
}
