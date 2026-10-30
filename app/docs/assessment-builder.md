# Dynamic Assessment Form Builder

Formulir asesmen dinamis berjalan **berdampingan** dengan modul lama A/B/C/W.
Modul lama tidak diubah: pertanyaannya tetap di kode, hash dan alur
persetujuannya tetap sama, dan analisis AI serta case-chat lama tidak membaca
jawaban formulir dinamis.

> Semua template builder/AI diberi label
> `Formulir intake psikososial belum tervalidasi. Persetujuan konten bukan validasi psikometrik. Tidak menghasilkan skor atau diagnosis.`
> Persetujuan psikolog adalah persetujuan **konten operasional**, bukan validasi
> psikometrik. Tidak ada skor otomatis, cut-off, rumus, atau diagnosis.

## 1. Letak kode

| Lapisan | Berkas |
| --- | --- |
| Definisi, kompilasi, evaluasi aturan, validasi jawaban | `src/lib/assessment-builder/definition.ts` |
| Schema keluaran AI + prompt terkunci | `src/lib/assessment-builder/ai-output.ts` |
| Skema tabel | `src/lib/db/template-schema.ts`, `response-schema.ts`, `question-ai-schema.ts` |
| Service | `src/server/services/template.service.ts`, `response.service.ts`, `response-media.service.ts`, `question-ai.service.ts` |
| Adapter model lokal | `src/lib/ai/question-generator.ts` |
| Router API | `src/app/api/[...domain]/route.ts` |
| UI builder | `src/components/assessment-builder/` |
| Halaman staf | `src/app/(staff)/assessment-templates/`, `template-versions/[id]/`, `assessment-responses/` |
| Renderer peserta | `src/app/intake/dynamic-questionnaire.tsx` |

`src/lib/assessment-builder/*` adalah modul murni: tanpa database, tanpa
jaringan, dan tanpa eksekusi kode dari admin. Modul ini dipakai frontend dan
backend sehingga visibilitas dan validasi identik di kedua sisi.

## 2. Skema dan relasi

```
assessment_templates ──1:N──> assessment_template_versions
                      │            ├─1:N─> assessment_sections
   active_publication  │            ├─1:N─> assessment_questions ─1:N─> assessment_question_options
   ────────────────────┘            ├─1:N─> assessment_conditional_rules
                                    ├─1:N─> assessment_template_reviews   (append-only)
                                    └─1:N─> assessment_publications

assessment_template_versions ──1:N──> assessment_responses   (pin version_id + content_hash)
                                           ├─1:N─> assessment_answers
                                           ├─1:N─> assessment_response_sessions
                                           └─1:N─> assessment_response_attachments ─1:N─> ..._attachment_events

assessment_template_versions ──1:N──> ai_question_jobs ─1:N─> ai_question_candidates ─1:N─> ..._candidate_decisions
```

Catatan penting:

- `assessment_templates` menyimpan identitas stabil dan referensi publikasi
  aktif. Metadata yang diberi versi ada di `assessment_template_versions`.
- ID pertanyaan dan opsi **unik di dalam satu versi**, bukan global. Saat
  sebuah versi di-clone, ID dipertahankan agar diff antarversi bermakna.
  Duplikasi pertanyaan/template membuat identitas baru dan memetakan ulang
  aturan internalnya.
- `assessment_audit_logs` adalah **VIEW read-only** di atas `audit_logs` yang
  sudah ada, difilter ke prefix aksi domain ini. Tidak ada jejak audit kedua.
- Trigger SQL menolak: mengubah/menghapus definisi yang sudah frozen,
  memindahkan pertanyaan/opsi antarversi, mengubah pemilik organisasi,
  menurunkan status versi terpublikasi, menulis ulang review/publikasi, serta
  mengubah/menghapus jawaban yang sudah terkirim. Pengujian menembak trigger ini
  lewat SQL langsung, bukan hanya lewat service.
- Definisi formulir dan jawaban responden berada di tabel terpisah. Setiap
  response menyematkan `template_version_id` **dan** `content_hash` saat dibuat,
  sehingga hasil dapat direproduksi walaupun versi baru diterbitkan.

### Migrasi

| Migrasi | Isi |
| --- | --- |
| `0007_assessment_templates.sql` | template, versi, section, pertanyaan, opsi, aturan, review, publikasi, view audit |
| `0008_dynamic_assessment_responses.sql` | response, jawaban, sesi peserta, lampiran, event lampiran |
| `0009_ai_question_drafts.sql` | job AI, kandidat, riwayat keputusan kandidat |

Migrasi hanya **ditambahkan**; SQL yang sudah diterapkan tidak pernah ditulis
ulang.

## 3. Definisi formulir

Satu dokumen versi (`definitionSchema`, `schemaVersion: 1`) berisi metadata,
`sections`, dan `questions`. Batas: 20 section, 100 pertanyaan, 50 opsi per
pertanyaan, payload maksimal 512 KiB (`DEFINITION_MAX_BYTES`).

Jenis input yang didukung (`QUESTION_TYPES`) dan validasinya:

| Jenis | Validasi |
| --- | --- |
| `short_text`, `long_text` | `minLength` / `maxLength`; teks biasa yang di-escape, bukan HTML |
| `single_choice`, `dropdown` | nilai harus salah satu `option.id` milik pertanyaan tersebut |
| `multiple_choice` | array `option.id` unik, `minSelections` / `maxSelections` |
| `yes_no` | boolean |
| `number`, `scale` | `min`, `max`, `step`, `integer`, nilai harus finite |
| `date` | `YYYY-MM-DD` kalender valid, `minDate` / `maxDate`, tanpa konversi zona waktu |
| `information` | tanpa nilai jawaban, tidak bisa `required`, tidak bisa jadi sumber kondisi |
| `file` | hanya bila `allowImages` aktif pada versi; PNG/JPEG/WebP, 5 MB, normalisasi + pelepasan metadata |

`option.value` adalah **nilai tersimpan, bukan bobot skor**.

Wajib vs dilewati: `required` berarti harus ada jawaban **atau** pelewatan
eksplisit yang diizinkan. Pertanyaan `personal`/`sensitive` selalu memiliki opsi
dilewati, dan tidak ada opsi dilewati yang terpilih otomatis.

## 4. Conditional logic

Aturan adalah pohon JSON bertipe, bukan ekspresi yang dieksekusi:

```json
{ "op": "all", "rules": [
  { "questionId": "…uuid…", "operator": "equals",   "value": false },
  { "questionId": "…uuid…", "operator": "contains", "value": "…optionId…" }
]}
```

- Grup: `all` (AND) dan `any` (OR). Leaf: `equals`, `not_equals`, `contains`.
- `equals` / `not_equals` memakai kesetaraan skalar bertipe. `contains` berarti
  keanggotaan opsi untuk `multiple_choice`, atau pencocokan substring yang
  dinormalisasi untuk teks. Operator/operand yang tidak cocok ditolak.
- Validasi: referensi harus ada di versi yang sama dan aktif, graf harus DAG,
  kedalaman maksimal 4, total maksimal 200 node.
- Evaluasi dilakukan topologis di frontend **dan** backend. Urutan tampilan
  tetap bisa diatur terpisah dari urutan ketergantungan.

### Semantik jawaban tersembunyi

Ini bagian yang paling mudah salah dipahami, jadi aturannya eksplisit:

1. Sumber yang **hilang, dilewati, atau tersembunyi** membuat leaf bernilai
   `false` — termasuk `not_equals`. Pertanyaan lanjutan tidak pernah muncul
   karena kebetulan.
2. Begitu sebuah pertanyaan menjadi tersembunyi, nilainya dihapus dan disimpan
   sebagai `not_applicable` beserta alasan visibilitas.
3. Bila nanti muncul kembali, jawaban harus diisi ulang. Nilai lama tidak
   dipulihkan diam-diam.
4. Server menghitung visibilitas dan jawaban aktif **sendiri**. Nilai
   tersembunyi yang dikirim klien basi/dimanipulasi dibuang dan tidak dapat
   mempengaruhi aturan hilir, ringkasan, atau ekspor.
5. Tampilan hasil hanya menampilkan item tersembunyi sebagai *tidak berlaku*,
   tanpa nilai yang sudah dibuang.

## 5. RBAC dan transisi status

Kapabilitas ditambahkan ke matriks izin yang sudah ada (`src/lib/permissions.ts`):

| Kapabilitas | Peran |
| --- | --- |
| `form.read` (baca definisi terpublikasi, tugaskan, baca response) | pengasuh, ketua, psikolog, admin |
| `form.draft.read` (pratinjau draft, riwayat, panel AI) | psikolog, admin |
| `form.write` (sunting draft, ajukan review, arsipkan) | admin |
| `form.review` (setujui / minta perubahan) | psikolog |
| `form.publish` | admin |
| `form.revoke` (cabut persetujuan) | ketua, psikolog |
| `form.ai` (hasilkan draf AI) | admin |

Peserta hanya mengakses response yang ditugaskan kepadanya melalui sesi intake
bercakupan — tanpa katalog template, builder, riwayat, AI, atau API staf.
Otorisasi diperiksa di **service** maupun di halaman/handler API.

```
draft ──submit-review──> in_review ──review:approved──> (siap publish)
  ^                          │                                │
  │                          └──review:changes_requested───────┘
  │                                                            │
  └────────────── sunting draft (membatalkan persetujuan) ──────┘
                                                               │
                                                        publish ▼
                                                           published ──> archived
```

Aturan yang ditegakkan:

1. `draft → in_review` membekukan penyuntingan.
2. Psikolog menyetujui **revisi dan hash yang tepat**. Psikolog harus memiliki
   kredensial terverifikasi saat ini, dan tidak boleh orang yang sama dengan
   penerbit.
3. Admin hanya dapat publish dengan persetujuan valid **dan** revisi/hash yang
   cocok. Publikasi, pergantian versi aktif, dan audit terjadi atomik; dua
   publikasi serentak hanya menyisakan satu yang berhasil.
4. Menerbitkan versi baru mengarsipkan versi aktif sebelumnya untuk penugasan
   baru; response yang sedang berjalan tetap pada versi yang disematkan.
5. Arsip biasa menghalangi penugasan baru, bukan penyelesaian response yang
   sudah ditugaskan. Pencabutan persetujuan menghentikan pengumpulan segera,
   sementara kiriman historis tetap immutable dan tetap dapat dibaca staf.
6. Menyunting versi terpublikasi **selalu** meng-clone draft baru. Nomor versi
   naik monoton per template.
7. Setiap penyuntingan draft setelah persetujuan membatalkan persetujuan itu.
   Snapshot + hash yang dilihat peninjau disimpan dan tidak bisa ditulis ulang.

## 6. API

Semua lewat router catch-all yang sudah ada (`/api/[...domain]`), maksimal empat
segmen, dengan pemeriksaan origin, pemisahan peserta/staf, dan envelope
`{ data }` / `{ error }` yang sama seperti domain lain.

| Metode & path | Fungsi |
| --- | --- |
| `GET/POST /api/assessment-templates` | katalog (q/status/page) dan buat template |
| `GET /api/assessment-templates/:id` | detail + daftar versi |
| `POST /api/assessment-templates/:id/versions` | clone draft dari `sourceVersionId` |
| `GET /api/assessment-templates/:id/active` | versi aktif yang eligible |
| `GET /api/assessment-templates/:id/history` \| `/audit` | riwayat versi, audit tersanitasi |
| `GET/PATCH /api/template-versions/:id` | baca / simpan dokumen versi dengan `revision` |
| `POST /api/template-versions/:id/validate` \| `/preview` | kompilasi + peringatan, tanpa menyimpan |
| `POST /api/template-versions/:id/submit-review` \| `/review` \| `/publish` \| `/archive` \| `/revoke` | transisi status |
| `POST/GET /api/template-versions/:id/ai-drafts` | mulai / daftar job AI |
| `GET /api/ai-question-jobs/:id` | status job + kandidat |
| `POST /api/ai-question-candidates/:id/decision` | `accepted` / `edited_accepted` / `rejected` |
| `GET/POST /api/assessment-responses` | daftar / tugaskan response |
| `GET/PATCH /api/assessment-responses/:id` | detail / autosave dengan `revision` |
| `POST /api/assessment-responses/:id/submit` \| `/sessions` \| `/withdraw` \| `/corrections` | kirim, buat sesi peserta, tarik, koreksi |
| `POST /api/response-sessions/:id/revoke` | cabut sesi |
| `POST /api/response-attachments`, `GET /api/response-attachments/:id/content` | unggah / baca gambar privat (`no-store`) |
| `GET/PATCH /api/intake/current`, `POST /api/intake/current/submit` \| `/end` | endpoint peserta, didispatch adapter sesi |

Contoh — simpan draft:

```bash
curl -X PATCH http://127.0.0.1:3000/api/template-versions/$VERSION_ID \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"revision":3,"definition":{"schemaVersion":1,"name":"Dukungan keluarga","sections":[…],"questions":[…]}}'
```

Contoh — psikolog menyetujui revisi tertentu:

```bash
curl -X POST http://127.0.0.1:3000/api/template-versions/$VERSION_ID/review \
  -H 'content-type: application/json' -b psych-cookies.txt \
  -d '{"revision":4,"decision":"approved","note":"Bahasa sudah sesuai usia"}'
```

Kode kesalahan yang konsisten: `422` validasi (dengan path field), `409`
konflik revisi, `403` izin/gate, `404` path/metode tak dikenal, `429` kuota AI.

Endpoint peserta **tidak pernah** menerima target template-version atau response
dari klien; targetnya diturunkan dari sesi yang terautentikasi. Cookie
`panti.intake` dipakai bersama alur lama, dengan diskriminator token dinamis
berversi yang hanya memilih cara resolusi — bukan memberi otoritas.

## 7. AI Question Generator

- Masukan: instruksi admin, audiens yang dituju, jumlah 1–20, dan definisi
  pertanyaan yang **dipilih eksplisit** dari organisasi ini. Tidak ada akses ke
  jawaban responden, profil kasus, observasi, riwayat chat, atau lampiran.
- Prompt dan schema terkunci: `QUESTION_PROMPT_VERSION` = `question-draft-p1`,
  `QUESTION_SCHEMA_VERSION` = `question-draft-s1`. Prompt analisis kasus dan
  chatbot tidak dipakai ulang.
- Keluaran wajib satu objek JSON yang cocok schema ketat (domain, kunci
  sementara, jenis, tujuan, sensitivitas, opsi, aturan lanjutan opsional,
  peringatan duplikasi/ambiguitas, referensi sumber), maksimal 128 KiB.
  Kunci tak dikenal, konten eksekutabel, field skoring, referensi sumber yang
  dikarang, atau keluaran terpotong **menggugurkan seluruh job** — tidak ada
  penerimaan sebagian dan tidak ada retry otomatis.
- ID stabil diberikan server, referensi dipetakan ulang, lalu graf hasil
  dikompilasi dan divalidasi ulang.
- Kandidat tetap terpisah dari template sampai admin memutuskan. Keputusan
  bersifat append-only dan final; penerimaan berjalan di bawah kontrol revisi
  draft. Ketergantungan lanjutan yang menggantung ditolak, bukan disisipkan
  diam-diam bersama pertanyaan yang sudah ditolak.
- Provenance immutable: job, model, versi prompt/schema, hash sumber, kandidat
  asli, dan keputusan manusia. Penyuntingan manusia tidak menghapus provenance.
- Kuota: reservasi harian yang sudah ada **plus** 5 percobaan per aktor per
  menit. Job menyimpan idempotency key, hash permintaan, dan lease; penyedia
  dipanggil **di luar** transaksi DB; lease kedaluwarsa dibereskan satu kali
  dengan tanggal kuota aslinya.
- Mode `mock` adalah simulasi deterministik berlabel, **bukan** model generatif.
  Template yang berasal dari mock tetap `demoOnly` setelah disunting,
  diduplikasi, di-clone, dan diterbitkan, serta tidak dapat ditugaskan ke
  responden nonfiktif.
- Model membaca konteks yang diberikan; bobotnya **tidak** dilatih dari database.
- Deteksi duplikasi disajikan sebagai peringatan yang perlu ditinjau manusia,
  bukan bukti kesetaraan makna.

### Menyiapkan model lokal

1. Jalankan server model yang kompatibel OpenAI di loopback, misalnya
   `http://127.0.0.1:11434/v1`.
2. Di `.env.local`: `AI_MODE=local_endpoint`, `ALLOW_LOCAL_AI_ENDPOINT=true`,
   dan daftarkan origin loopback tersebut pada allowlist.
3. Di **Admin → Pengaturan AI**, simpan endpoint/model/`maxTokens` (batas 2000),
   lalu jalankan **Uji koneksi**. AI tidak bisa diaktifkan sebelum konfigurasi
   yang tersimpan lulus uji; kredensial dienkripsi di server.
4. `LOCAL_ONLY=false`, `DATABASE_URL` non-`file:`, dan `AI_MODE=remote_endpoint`
   ditolak saat startup.

Tanpa model lokal yang benar-benar berjalan, yang terverifikasi hanyalah mode
simulasi — lulusnya test mock **bukan** bukti model nyata berfungsi.

## 8. Skoring dan instrumen tervalidasi

- Tidak ada rumus arbitrer, skor klinis otomatis, cut-off, diagnosis, atau
  skrip skoring yang bisa dikonfigurasi.
- API draft biasa maupun AI **menolak** field `score`, `weights`, `cutoff`,
  `formula`, dan `validated`.
- Bundel instrumen tervalidasi yang dilindungi tidak dapat disunting atau
  dilabeli ulang melalui builder ini.
- Delivery ini tidak memperkenalkan instrumen skoring tervalidasi. Menambahkan
  satu nanti memerlukan bukti terdokumentasi serta definisi skoring immutable
  dan alur validasi yang disetujui terpisah.

## 9. Menambah jenis pertanyaan baru — checklist

1. `src/lib/assessment-builder/definition.ts`
   - tambahkan nilai ke `QUESTION_TYPES`;
   - tambahkan field validasi yang diperlukan ke `validationSchema`;
   - tangani jenis itu di validasi jawaban (nilai sah, batas, wajib/dilewati);
   - tangani di evaluasi kondisi: apakah boleh menjadi sumber, dan bagaimana
     `equals` / `contains` diartikan;
   - tangani di pemformatan jawaban agar hasil terbaca.
2. `src/components/assessment-builder/renderer.tsx`: tambahkan label ke
   `TYPE_LABELS` dan kontrol input beraksesibilitas (label, `aria-describedby`,
   target sentuh ≥44px). Renderer ini dipakai pratinjau **dan** intake.
3. `src/components/assessment-builder/editor.tsx`: tambahkan field properti yang
   relevan (mis. `numericKeys`), dan kebijakan default di `addQuestion`.
4. `src/components/assessment-builder/rule-editor.tsx`: pastikan operator yang
   ditawarkan valid untuk jenis itu.
5. Bila jenis baru menyimpan bentuk nilai baru, sesuaikan `answerSchema` dan
   periksa kembali normalisasi jawaban di `response.service.ts`.
6. Tes: `tests/unit/assessment-builder.test.ts` (nilai sah/tidak sah, batas,
   paritas frontend–backend) dan `tests/integration/dynamic-responses.test.ts`.
7. Tidak perlu migrasi: jenis pertanyaan disimpan di dokumen definisi, bukan
   kolom. Yang perlu diperhatikan adalah kompatibilitas versi yang sudah
   terbit — jangan mengubah arti jenis yang sudah dipakai; buat jenis baru.

## 10. Migrasi, backup, dan pemulihan

`npm run db:migrate` kini memakai `scripts/lib/migration-safety.ts`:

1. Verifikasi integritas database sumber.
2. `VACUUM INTO` → `before.sqlite` (snapshot konsisten, **termasuk isi WAL yang
   sudah di-commit**) di direktori privat `var/backups/migration-<waktu>-<uuid>/`
   (`0700`, file `0600`).
3. Hitung manifest historis: jumlah baris + SHA-256 setiap tabel yang sudah ada
   (internal SQLite dan `__drizzle_migrations` dikecualikan).
4. Clone **rehearsal** terpisah dari backup, migrasikan clone itu lebih dahulu,
   lalu verifikasi integritas + hash historis tidak berubah. Backup pemulihan
   sendiri tidak pernah dimigrasikan.
5. Verifikasi riwayat sumber masih sama, baru migrasikan sumber.
6. Verifikasi ulang `integrity_check`, `foreign_key_check`, dan hash historis;
   tulis `manifest.json` dan `verified.json`.

Prasyarat: **hentikan semua penulis aplikasi** (`npm run dev` / `npm start`)
sebelum menjalankan migrasi. Pemeriksaan hash mendeteksi perubahan bersamaan,
tetapi bukan pengganti lock pemeliharaan.

Pemulihan: hentikan aplikasi, lalu salin `before.sqlite` dari direktori backup
ke lokasi `DATABASE_URL`. Tidak ada rollback destruktif dan tidak ada reset
otomatis — backup dan rehearsal disimpan.

## 11. Pengujian

| Perintah | Cakupan relevan |
| --- | --- |
| `npm test` | definisi, setiap jenis input, tabel kebenaran AND/OR, siklus, hide/reveal, keluaran AI, batas adapter |
| `npm run test:integration` | isolasi multi-organisasi, izin, invalidasi persetujuan, publikasi serentak, trigger SQL, resume versi lama, lineage koreksi, kuota/lease AI, fresh install + upgrade `0006 → 0009` |
| `npm run test:e2e` | admin menyusun & pratinjau → psikolog menyetujui → admin publish → staf menugaskan → peserta bercabang/menyimpan/melanjutkan/mengirim → publish v2 → v1 historis tidak berubah; sorting sentuh & keyboard; aturan gambar; alur A/B/C/W dan chat lama |

Uji migrasi dijalankan pada fixture terisolasi lebih dahulu
(`tests/integration/migration-upgrade.test.ts`), sebelum `npm run db:migrate`
pada instalasi lokal yang sudah dibackup.

## 12. Di luar lingkup delivery ini

Pencarian internet otomatis / integrasi penyedia eksternal, layanan model
eksternal, unggahan dokumen arbitrer, aplikasi mobile native, instrumen skoring
tervalidasi, dan analisis AI otomatis atas jawaban formulir dinamis.
