ALTER TABLE public.safety_cost_items
ADD COLUMN IF NOT EXISTS transaction_date date,
ADD COLUMN IF NOT EXISTS maker text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS supply_amount numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_amount numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS supplier_name text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_safety_cost_items_transaction_date
ON public.safety_cost_items(transaction_date);

CREATE INDEX IF NOT EXISTS idx_safety_cost_items_supplier_name
ON public.safety_cost_items(supplier_name);