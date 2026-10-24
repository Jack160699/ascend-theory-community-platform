-- Qikink Unisex Terry Oversized Tee (UT27): 260 GSM terry, 90% cotton / 10% polyester, drop shoulder.
-- Chosen as the house tee for embroidery; first in the list, so the studio uses it by default.
-- Qikink lists DTG, DTF, puff and embroidery for this style.
INSERT INTO public.pod_garments (key, name, qikink_style, sku_prefix, sku_confirmed, colours, sizes, base_cost_inr, weight_grams, print_types, sort_order)
VALUES ('terry_tee', 'Terry oversized tee · 260 GSM', 'UT27', 'UT27', false,
  '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"}]',
  '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
  300, 350, ARRAY['dtg','dtf','embroidery','puff'], -2)
ON CONFLICT (key) DO NOTHING;
