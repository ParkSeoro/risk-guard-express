-- Hazard-keyword legal pack for RA fill / remediation.
-- legal_references was created empty; process-keyed library match cannot
-- supply 법적근거 when the row's 공종·세부작업 is not in the library.
-- Keywords only (no process_mappings='전체') so a 추락 row does not get every article.

INSERT INTO public.legal_references (law_name, article, description, keywords, process_mappings, needs_review)
SELECT v.law_name, v.article, v.description, v.keywords, ARRAY[]::text[], false
FROM (
  VALUES
    ('산안기준규칙', '제32조', '보호구의 지급 등', ARRAY['보호구','안전모','안전대','안전화']),
    ('산안기준규칙', '제42조', '추락의 방지', ARRAY['추락','고소','비계','안전대']),
    ('산안기준규칙', '제24조', '사다리식 통로의 구조', ARRAY['사다리']),
    ('산안기준규칙', '제14조', '낙하물에 의한 위험의 방지', ARRAY['낙하','비래']),
    ('산안기준규칙', '제3조', '전도의 방지', ARRAY['전도','전선','정리정돈']),
    ('산안기준규칙', '제8조', '조도', ARRAY['조도','조명','투광등']),
    ('산안기준규칙', '제86조', '원동기·회전축 등의 위험방지', ARRAY['협착','끼임','회전부']),
    ('산안기준규칙', '제302조', '전기 기계·기구의 접지', ARRAY['감전','접지']),
    ('산안기준규칙', '제313조', '배선 등의 절연조치', ARRAY['전선','배선','활선']),
    ('산안기준규칙', '제321조', '충전부 접근 방지', ARRAY['감전','활선','충전부']),
    ('산안기준규칙', '제232조', '소화설비', ARRAY['화재','소화기']),
    ('산안기준규칙', '제241조', '화재위험작업 시의 준수사항', ARRAY['화재','폭발','화기','용접']),
    ('산안기준규칙', '제619조', '밀폐공간 작업 프로그램', ARRAY['질식','밀폐','산소']),
    ('산안기준규칙', '제422조', '환기', ARRAY['중독','화학','유기용제','흄']),
    ('산안기준규칙', '제338조', '지반 등의 굴착 시 위험 방지', ARRAY['붕괴','매몰','굴착']),
    ('산안기준규칙', '제171조', '전도 등의 방지', ARRAY['충돌','차량','크레인']),
    ('산안기준규칙', '제656조', '중량물 취급에 따른 위험 예방', ARRAY['근골격','중량물'])
) AS v(law_name, article, description, keywords)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.legal_references r
  WHERE r.law_name = v.law_name
    AND r.article = v.article
);
