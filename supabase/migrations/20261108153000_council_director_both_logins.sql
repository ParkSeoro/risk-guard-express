-- The daily login is seoro.park@airliquide.com. psr1579@gmail.com has never signed in.
-- Both accounts already belong to the same director elsewhere in the app.

CREATE OR REPLACE FUNCTION public.is_council_director(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = _user_id
      AND (
        (id = '51c291bd-b434-4872-8995-e78f495b2e01'::uuid AND lower(email) = 'seoro.park@airliquide.com')
        OR
        (id = '5e780ffb-81c8-42ef-8eed-b27815785fd1'::uuid AND lower(email) = 'psr1579@gmail.com')
      )
  );
$$;
