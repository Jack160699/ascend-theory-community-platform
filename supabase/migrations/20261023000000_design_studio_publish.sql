-- Design → product studio: Qikink garment catalogue, extra Qikink print methods,
-- studio metadata on products, and storage for uploads and storefront media.

-- 1. Qikink print methods beyond DTG/DTF/embroidery (from Qikink's API print_type_id list)
ALTER TABLE public.design_placements DROP CONSTRAINT IF EXISTS design_placements_print_method_check;
ALTER TABLE public.design_placements ADD CONSTRAINT design_placements_print_method_check
  CHECK (print_method = ANY (ARRAY[
    'dtf', 'dtg', 'screen_print', 'embroidery', 'sublimation', 'other',
    'puff', 'glow', 'vinyl_gold', 'vinyl_silver', 'vinyl_rainbow', 'vinyl_reflective'
  ]));

-- 2. Studio metadata (garment, print type, source photo) for products made in the studio
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS studio_json jsonb;

-- 3. Qikink garment catalogue — SKU = sku_prefix-colourCode-sizeCode
CREATE TABLE IF NOT EXISTS public.pod_garments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  qikink_style text,
  sku_prefix text NOT NULL,
  sku_confirmed boolean NOT NULL DEFAULT false,
  colours jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ "name": "Black", "code": "Bk", "hex": "#111111" }]
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{ "size": "S", "code": "S", "extraCostInr": 0 }]
  base_cost_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (base_cost_inr >= 0),
  weight_grams integer NOT NULL DEFAULT 300 CHECK (weight_grams > 0),
  print_types text[] NOT NULL DEFAULT ARRAY['dtg','dtf']::text[],
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pod_garments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pod_garments FROM anon, authenticated;

-- Prices: Qikink Pricing 2026 (qikink.com/help/payments-pricing/pricing). The hoodie prefix
-- "UPuHd" and colour codes "Wh"/"Nb" appear in Qikink's API docs; the rest must be confirmed
-- once against Qikink → Products before orders can be sent automatically.
INSERT INTO public.pod_garments (key, name, qikink_style, sku_prefix, sku_confirmed, colours, sizes, base_cost_inr, weight_grams, print_types, sort_order)
VALUES
  ('oversized_tee', 'Oversized tee', 'US22', 'UOsHs', false,
    '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"},{"name":"Navy Blue","code":"Nb","hex":"#1d2740"}]',
    '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
    235, 300, ARRAY['dtg','dtf','embroidery','puff','vinyl_gold','vinyl_silver','glow','vinyl_reflective'], 1),
  ('tee', 'Classic tee', 'UC21', 'MRnHs', false,
    '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"},{"name":"Navy Blue","code":"Nb","hex":"#1d2740"}]',
    '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
    190, 250, ARRAY['dtg','dtf','embroidery','puff','vinyl_gold','vinyl_silver','glow','vinyl_reflective','sublimation'], 2),
  ('hoodie', 'Pullover hoodie', 'UH83', 'UPuHd', false,
    '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"},{"name":"Navy Blue","code":"Nb","hex":"#1d2740"}]',
    '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
    480, 650, ARRAY['dtg','dtf','embroidery','puff','vinyl_gold','vinyl_silver','glow','vinyl_reflective'], 3),
  ('sweatshirt', 'Sweatshirt', 'UH26', 'USwFs', false,
    '[{"name":"Black","code":"Bk","hex":"#151515"},{"name":"White","code":"Wh","hex":"#f4f4f2"},{"name":"Navy Blue","code":"Nb","hex":"#1d2740"}]',
    '[{"size":"S","code":"S"},{"size":"M","code":"M"},{"size":"L","code":"L"},{"size":"XL","code":"XL"},{"size":"XXL","code":"XXL"}]',
    410, 550, ARRAY['dtg','dtf','embroidery','puff','vinyl_gold','vinyl_silver','glow','vinyl_reflective'], 4)
ON CONFLICT (key) DO NOTHING;

-- 4. Storage: private raw uploads, public storefront media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('studio-uploads', 'studio-uploads', false, 26214400, ARRAY['image/png','image/jpeg','image/webp']),
  ('product-media', 'product-media', true, 10485760, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;
