-- One product can be sold on several garments ("fits": classic crew, heavyweight, terry oversized…).
-- Each variant records which garment it is made on, plus the customer-facing name of that fit.
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS style TEXT, ADD COLUMN IF NOT EXISTS style_label TEXT;
COMMENT ON COLUMN public.product_variants.style IS 'Studio fit / garment key (pod_garments.key) when a product is sold on several garments';
COMMENT ON COLUMN public.product_variants.style_label IS 'Customer-facing fit name, e.g. "Terry oversized"';
CREATE INDEX IF NOT EXISTS idx_product_variants_style ON public.product_variants (product_id, style);
