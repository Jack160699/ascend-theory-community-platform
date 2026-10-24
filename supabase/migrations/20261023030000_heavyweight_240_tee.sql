-- Qikink Unisex Cotton Stretch T-Shirt (UC48): 240 GSM, 95% cotton / 5% elastane, Lycra rib neck,
-- regular (not oversized) fit, takes embroidery. First in the list, so the studio uses it by default.
-- sku_prefix is a placeholder until a real Qikink SKU is pasted in HQ → Qikink garments.
INSERT INTO public.pod_garments (key, name, qikink_style, sku_prefix, sku_confirmed, colours, sizes, base_cost_inr, weight_grams, print_types, sort_order)
VALUES ('heavy_tee', 'Heavyweight tee · 240 GSM', 'UC48', 'UC48', false,
  '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"}]',
  '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
  260, 300, ARRAY['dtg','dtf','embroidery','puff','vinyl_gold','vinyl_silver','glow','vinyl_reflective'], -1)
ON CONFLICT (key) DO NOTHING;
