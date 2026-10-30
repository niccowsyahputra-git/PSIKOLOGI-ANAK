# Asesmen Psikososial Panti — aplikasi lokal (T01–T02)

Implementasi PRD-PANTI-001 v1.1 (`../PRD-ASESMEN-PSIKOSOSIAL-PANTI-LOCAL-FIRST.md`).
Tahap yang sudah ada: fondasi aplikasi (T01) dan autentikasi/peran/audit (T02).

Aplikasi ini **hanya berjalan di komputer panti**: database file SQLite/libSQL,
storage filesystem privat, dan mesin AI dalam mode `mock` (SIMULASI). Tidak ada
panggilan ke Vercel, Turso, Google Drive, atau penyedia AI daring.

## Prasyarat

- Node.js 24 (diuji pada v24.18.0) dan npm 11
- Tidak perlu Docker, tidak perlu akun cloud

## Menjalankan pertama kali

```bash
npm install
npm run generate:env        # membuat .env.local (mode 600) dengan secret acak
npm run db:migrate          # membuat var/db/panti-dev.db
npm run storage:check       # memverifikasi var/storage privat (0700)
npm run bootstrap:admin -- --email admin@panti.local --password "KataSandiMinimal12" --name "Administrator Panti" --org-name "Nama Panti"
npm run dev                 # http://127.0.0.1:3000
```

`npm run generate:env` tidak menimpa `.env.local` yang sudah ada; gunakan
`node scripts/generate-env.mjs --force` bila ingin membuat ulang (file lama
dicadangkan ke `.env.local.bak-*`).

Untuk data uji fiktif (4 peran sekaligus):

```bash
npm run db:seed            # mencetak kata sandi demo satu kali
```

## Perintah harian

| Perintah | Kegunaan |
| --- | --- |
| `npm run dev` | Server pengembangan di 127.0.0.1:3000 |
| `npm run build` / `npm start` | Build dan jalankan produksi lokal |
| `npm run lint` / `npm run typecheck` | ESLint dan TypeScript strict |
| `npm test` | Unit test (Vitest) |
| `npm run test:integration` | Integrasi DB sementara + migrasi nyata |
| `npm run test:e2e` | Playwright pada server lokal |
| `npm run db:generate` | Buat migrasi SQL baru dari skema Drizzle |
| `npm run db:migrate` | Terapkan migrasi ke `var/db` |
| `npm run storage:check` | Cek direktori storage privat |
| `npm run db:generate-auth-schema` | Regenerasi tabel Better Auth |

`npm run db:migrate` membuat backup konsisten (`VACUUM INTO`, termasuk isi WAL
yang sudah di-commit) ke `var/backups/migration-*` dan memverifikasi hash catatan
historis sebelum menyentuh database. **Hentikan `npm run dev` / `npm start`
lebih dahulu** — migrasi mengharapkan tidak ada penulis lain.

## Struktur penting

```
src/app/(staff)/            shell staf + dasbor + panel admin (pengguna, audit)
src/app/api/                route handler JSON (envelope { data } / { error })
src/lib/env.ts              validasi konfigurasi lokal + penjaga LOCAL_ONLY
src/lib/db/                 klien libSQL, skema domain, skema Better Auth
src/lib/permissions.ts      matriks izin 4 peran (PRD 4.2)
src/server/services/        aturan domain (staf, audit)
migrations/                 SQL yang sama untuk lokal maupun fase cloud nanti
var/                        database, storage, backup (diabaikan git)
```

## Formulir asesmen dinamis

Formulir dinamis berjalan **berdampingan** dengan modul asesmen lama A/B/C/W;
modul lama tetap memakai pertanyaan di kode. Rincian schema, API, RBAC, semantik
jawaban tersembunyi, penyiapan model lokal, dan cara menambah jenis pertanyaan
baru ada di [`docs/assessment-builder.md`](docs/assessment-builder.md).

Titik masuk di aplikasi:

| Halaman | Isi |
| --- | --- |
| `/assessment-templates` | katalog template (cari + filter status), buat template baru |
| `/assessment-templates/[id]/history` | daftar versi, riwayat publikasi, dan audit per template |
| `/template-versions/[id]` | editor section/pertanyaan (drag-and-drop), panel properti, editor kondisi, panel AI, pratinjau desktop/mobile, transisi review → publish |
| `/assessment-responses`, `/assessment-responses/[id]` | penugasan formulir, autosave, sesi peserta, koreksi, dan hasil |
| `/intake`, `/intake/[sessionId]` | pengisian oleh peserta pada sesi bercakupan (versi template disematkan) |

Pembagian izin (`src/lib/permissions.ts`): admin menyunting draft, menjalankan
draf AI, dan memublikasikan; psikolog meninjau/menyetujui dan dapat mencabut;
ketua dapat mencabut; pengasuh membaca versi terbit serta menugaskan dan
mengisi response. AI hanya menghasilkan **kandidat draft** — admin menerima,
menyunting, atau menolak tiap kandidat, dan tidak ada publikasi otomatis.

## Aturan yang ditegakkan saat ini

- Tidak ada pendaftaran publik; akun hanya dibuat administrator atau
  `bootstrap:admin`.
- Peran selalu dibaca dari `staff_memberships` di server, tidak dari klien.
- Perubahan peran/status menghapus sesi aktif akun tersebut.
- Administrator aktif terakhir tidak bisa dinonaktifkan; peran sendiri tidak
  bisa diturunkan dari sesi yang sama.
- Peran psikolog wajib referensi kredensial + konfirmasi ketua.
- Audit menyimpan id, peran, dan status saja — bukan jawaban atau kontak.
- `LOCAL_ONLY=false`, `DATABASE_URL` non-`file:`, dan `AI_MODE=remote_endpoint`
  ditolak saat startup.
