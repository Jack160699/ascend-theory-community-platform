-- A studio product sold in several fits has one Qikink provider_products row per garment,
-- and many products share the same Qikink garment (e.g. UT27). The old constraints allowed only
-- one provider row per product and one product per garment code, which blocked publishing.
ALTER TABLE public.provider_products DROP CONSTRAINT IF EXISTS provider_products_provider_external_id_key;
DROP INDEX IF EXISTS public.idx_unique_provider_product_per_provider;
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_products_product_garment
  ON public.provider_products (provider_id, product_id, external_product_id) WHERE product_id IS NOT NULL;
