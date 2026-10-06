function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type EducationLogPrint = {
  courseName: string;
  educationLabel: string;
  heldOn: string;
  hours: number;
  instructor: string | null;
  place: string | null;
  outline: string;
  photoUrls: string[];
  attendees: Array<{ name: string; company: string; signature: string | null }>;
};

export function educationLogHtml(log: EducationLogPrint): string {
  const rows = log.attendees
    .map((a, i) => {
      const sign = a.signature
        ? `<img alt="" src="${esc(a.signature)}" style="height:28px" />`
        : "미서명";
      return `<tr><td>${i + 1}</td><td>${esc(a.company)}</td><td>${esc(a.name)}</td><td>${sign}</td></tr>`;
    })
    .join("");
  const photos = log.photoUrls
    .map((url) => `<img alt="" src="${esc(url)}" style="max-width:180px;max-height:140px;margin:4px" />`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(log.courseName)}</title>
<style>
  body { font-family: sans-serif; color: #111; margin: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  td, th { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; vertical-align: middle; }
  .outline { white-space: pre-wrap; font-size: 13px; }
</style></head><body>
<h1>안전보건교육 일지</h1>
<table>
  <tr><th>교육명</th><td>${esc(log.courseName)}</td><th>종류</th><td>${esc(log.educationLabel)}</td></tr>
  <tr><th>일자</th><td>${esc(log.heldOn)}</td><th>시간</th><td>${esc(String(log.hours))}시간</td></tr>
  <tr><th>강사</th><td>${esc(log.instructor || "-")}</td><th>장소</th><td>${esc(log.place || "-")}</td></tr>
</table>
<h2 style="font-size:14px">교육 내용</h2>
<div class="outline">${esc(log.outline)}</div>
<h2 style="font-size:14px">교육 사진</h2>
<div>${photos || "-"}</div>
<h2 style="font-size:14px">참석·서명</h2>
<table><thead><tr><th>번호</th><th>회사</th><th>이름</th><th>서명</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

export function printEducationLog(log: EducationLogPrint) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(educationLogHtml(log));
  win.document.close();
  win.focus();
  win.print();
}
