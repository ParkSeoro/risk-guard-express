UPDATE auth.users
SET email = split_part(email, '@', 1) || '@airliquide.com',
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', split_part(email, '@', 1) || '@airliquide.com')
WHERE id IN (
  '40648e88-53a1-4658-88f7-9d384362a2e9',
  '7f846eda-b721-4ac4-a639-28d855d2a7ca',
  '60cf7ecf-a7f5-4633-be19-c327638b4708'
) AND email LIKE '%@dig-airgas.com';