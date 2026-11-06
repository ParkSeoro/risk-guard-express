import { supabase } from '@/integrations/supabase/client';
import type { OfficialLetter } from '@/components/owner-safety/types';
import { INITIAL_LETTERS } from '@/components/owner-safety/sampleData';

const LOCAL_KEY = 'safenex_owner_official_letters';
const IMPORTED_KEY = 'safenex_owner_official_letters_db_v1';
const SAMPLE_IDS = new Set(INITIAL_LETTERS.map((letter) => letter.id));

type DbError = { message: string; code?: string } | null;

type LetterRecord = {
  id: string;
  project_id: string | null;
  doc_number: string;
  direction: '발신' | '수신';
  letter: Partial<OfficialLetter>;
  source: 'system' | 'upload' | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ocr_status: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
};

function table() {
  return (supabase as unknown as { from: (name: string) => any }).from('owner_official_letters');
}

function isUuid(value: string | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

export function toOfficialLetter(row: LetterRecord): OfficialLetter {
  const body = row.letter || {};
  return {
    ...body,
    id: row.id,
    project_id: row.project_id ?? body.project_id,
    doc_number: row.doc_number,
    direction: row.direction,
    subject: body.subject || '',
    recipient: body.recipient || '',
    reference: body.reference || '',
    sender: body.sender || '',
    dispatch_date: body.dispatch_date || '',
    status: body.status || (row.direction === '수신' ? '접수완료' : '작성중'),
    content_paragraphs: body.content_paragraphs || [],
    sub_items: body.sub_items || [],
    source: row.source === 'upload' ? 'upload' : 'system',
    ocr_text: row.ocr_text ?? body.ocr_text,
    ocr_confidence: row.ocr_confidence ?? body.ocr_confidence,
    ocr_status: row.ocr_status ?? body.ocr_status,
    file_path: row.file_path ?? body.file_path,
    created_at: body.created_at || row.created_at,
    updated_at: row.updated_at || body.updated_at || row.created_at,
  };
}

function letterPayload(letter: OfficialLetter): Record<string, unknown> {
  const { id: _id, ...rest } = letter;
  return rest;
}

function duplicateMessage(error: { message: string; code?: string }): Error {
  if (error.code === '23505' || /duplicate|owner_official_letters_doc_number/i.test(error.message)) {
    return new Error('같은 공문번호가 이미 대장에 있습니다. 다음 채번은 그 번호를 건너뜁니다.');
  }
  return new Error(error.message);
}

export async function loadOwnerLetters(): Promise<OfficialLetter[]> {
  const { data, error } = await table().select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const remote = (data || []).map(toOfficialLetter);
  const imported = await importLocalLettersOnce(remote);
  return [...imported, ...remote].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

async function importLocalLettersOnce(remote: OfficialLetter[]): Promise<OfficialLetter[]> {
  try {
    if (localStorage.getItem(IMPORTED_KEY) === '1') return [];
  } catch {
    return [];
  }
  let stored: OfficialLetter[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = [];
  }
  const known = new Set(remote.map((letter) => letter.doc_number));
  const pending = (Array.isArray(stored) ? stored : []).filter((letter) => {
    if (!letter || SAMPLE_IDS.has(letter.id)) return false;
    if (!letter.doc_number || known.has(letter.doc_number)) return false;
    known.add(letter.doc_number);
    return letter.direction === '발신' || letter.direction === '수신';
  });
  const imported: OfficialLetter[] = [];
  let failed = false;
  for (const letter of pending) {
    try {
      imported.push(await saveOwnerLetter({ ...letter, id: `local-${letter.id}` }));
    } catch {
      failed = true;
    }
  }
  if (!failed) {
    try {
      localStorage.setItem(IMPORTED_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  return imported;
}

export async function saveOwnerLetter(letter: OfficialLetter): Promise<OfficialLetter> {
  const { data: auth } = await supabase.auth.getUser();
  const row = {
    project_id: letter.project_id || null,
    doc_number: letter.doc_number.trim(),
    direction: letter.direction,
    letter: letterPayload(letter),
    source: letter.source === 'upload' ? 'upload' : 'system',
    ocr_text: letter.ocr_text ?? null,
    ocr_confidence: letter.ocr_confidence ?? null,
    ocr_status: letter.ocr_status ?? null,
    file_path: letter.file_path ?? null,
    updated_at: new Date().toISOString(),
  };
  if (isUuid(letter.id)) {
    const { error } = await table().update(row).eq('id', letter.id);
    if (error) throw duplicateMessage(error as DbError & { message: string });
    return { ...letter, id: letter.id };
  }
  const { data, error } = await table()
    .insert({ ...row, created_by: auth.user?.id ?? null })
    .select('id')
    .single();
  if (error || !data) throw duplicateMessage(error || { message: '공문을 저장하지 못했습니다.' });
  return { ...letter, id: data.id as string };
}

export async function deleteOwnerLetter(id: string): Promise<void> {
  if (!isUuid(id)) return;
  const { error } = await table().delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function uploadOfficialLetterFile(file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('로그인이 필요합니다.');
  const safe = file.name.replace(/[^\w.\-가-힣]+/g, '_').slice(0, 80);
  const path = `${auth.user.id}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('official-letters').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function readOfficialLetterImage(fileBase64: string, mimeType: string): Promise<{
  text: string;
  confidence: number | null;
  status: string;
  warning?: string;
}> {
  if (fileBase64.length > 1_800_000) {
    throw new Error('공문 이미지가 너무 큽니다. 첫 장만 다시 올려 주세요.');
  }
  const { data, error } = await supabase.functions.invoke('read-official-letter', {
    body: { fileBase64, mimeType },
  });
  if (error) throw new Error(error.message);
  const payload = data as { error?: string; text?: string; confidence?: number | null; status?: string; warning?: string };
  if (payload?.error) throw new Error(payload.error);
  return {
    text: payload?.text || '',
    confidence: payload?.confidence ?? null,
    status: payload?.status || 'no_vision',
    warning: payload?.warning,
  };
}
